/**
 * The presentation log (service records R12–R19): what each workspace showed, one entry per
 * unbroken showing of one piece, as its coordinator uploaded it. An entry is sent when it
 * opens and again when it closes, under the same id, so a repeat changes nothing.
 *
 * The server keeps the log whole where the desktops could not: an entry still open when a
 * later one of the workspace starts is closed at that start, and one still open when the
 * live state expires is closed at its last activity; both are marked as closed by the
 * server (R18). Every change renews the entry's cursor, the order a reader follows.
 */
import { DEFAULT_EXPIRY_MS } from '@worship-q/live-state';
import {
  LogBackgroundSchema,
  LogPartSchema,
  type LogBatch,
  type LogEntry,
  type StoredLogEntry,
} from '@worship-q/protocol';
import { transaction, type SqlValue } from './db';
import type { DeviceRow, Instance } from './instance';
import { offset } from './recordings';

const text = (value: SqlValue | undefined) => (value == null ? '' : String(value));

export class PresentationLog {
  constructor(private readonly instance: Instance) {}

  private get db() {
    return this.instance.db;
  }

  private nextCursor(): number {
    const row = this.db
      .prepare(`UPDATE counter SET value = value + 1 WHERE name = 'log' RETURNING value`)
      .get();
    return Number(row!.value);
  }

  /**
   * Takes a batch from a device of the workspace. Entries of another workspace are ignored.
   * Returns how many entries changed.
   */
  put(device: DeviceRow, batch: LogBatch): number {
    const now = this.instance.now();
    const clockOffsetMs = offset(batch.sentAt, now);
    return transaction(this.db, () => {
      let changed = 0;
      for (const entry of batch.entries) {
        if (this.putOne(device, entry, clockOffsetMs, now)) changed++;
      }
      return changed;
    });
  }

  private putOne(device: DeviceRow, entry: LogEntry, clockOffsetMs: number, now: string): boolean {
    const existing = this.get(entry.id);
    if (existing && existing.workspaceId !== device.workspaceId) return false;
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO presentation_log (id, workspace_id, device_id, device_name, run_sheet_id,
             date, item_id, previous, song_id, revision, revision_id, version, part, background,
             started_at, ended_at, closed_by_server, clock_offset_ms, received_at, cursor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          entry.id,
          device.workspaceId,
          device.id,
          device.name,
          entry.runSheetId,
          entry.date,
          entry.itemId,
          entry.previous ? 1 : 0,
          entry.songId,
          entry.revision,
          entry.revisionId,
          entry.version,
          JSON.stringify(entry.part),
          entry.background ? JSON.stringify(entry.background) : null,
          entry.startedAt,
          entry.endedAt,
          clockOffsetMs,
          now,
          this.nextCursor(),
        );
      this.closeOverlaps(device.workspaceId, entry.id, entry.startedAt, entry.endedAt);
      return true;
    }
    // Never reopened by a late repeat of its opening.
    if (entry.endedAt === null) {
      if (existing.revisionId === null && entry.revisionId !== null) {
        this.db
          .prepare('UPDATE presentation_log SET revision_id = ? WHERE id = ?')
          .run(entry.revisionId, entry.id);
      }
      return false;
    }
    if (existing.endedAt !== null) {
      // The coordinator's own end replaces the server's when it is earlier: the server only
      // closed it because a later entry started.
      if (!existing.closedByServer || entry.endedAt >= existing.endedAt) return false;
    }
    this.db
      .prepare(
        `UPDATE presentation_log SET ended_at = ?, closed_by_server = 0, clock_offset_ms = ?,
           revision_id = coalesce(revision_id, ?), cursor = ? WHERE id = ?`,
      )
      .run(entry.endedAt, clockOffsetMs, entry.revisionId, this.nextCursor(), entry.id);
    return true;
  }

  /**
   * Keeps one workspace's entries from overlapping (R18): every other entry still open that
   * started before this one is closed at its start, and this one, if open, is closed at the
   * start of the first entry after it.
   */
  private closeOverlaps(
    workspaceId: string,
    id: string,
    startedAt: string,
    endedAt: string | null,
  ): void {
    const earlier = this.db
      .prepare(
        `SELECT id FROM presentation_log WHERE workspace_id = ? AND id <> ? AND ended_at IS NULL
           AND started_at <= ?`,
      )
      .all(workspaceId, id, startedAt);
    for (const row of earlier) this.closeByServer(text(row.id), startedAt);
    if (endedAt !== null) return;
    const later = this.db
      .prepare(
        `SELECT started_at FROM presentation_log WHERE workspace_id = ? AND id <> ?
           AND started_at > ? ORDER BY started_at LIMIT 1`,
      )
      .get(workspaceId, id, startedAt);
    if (later) this.closeByServer(id, text(later.started_at));
  }

  private closeByServer(id: string, at: string): void {
    this.db
      .prepare(
        `UPDATE presentation_log SET ended_at = ?, closed_by_server = 1, cursor = ? WHERE id = ?`,
      )
      .run(at, this.nextCursor(), id);
  }

  /**
   * Closes entries left open once their workspace's live state has expired (M4.5), at its
   * last activity. Without a live state on the server, as after a service on the venue
   * network alone, an entry is closed when the server last heard of it, once that is longer
   * ago than the live state would last. Returns how many were closed.
   */
  closeExpired(expiryMs = DEFAULT_EXPIRY_MS): number {
    const now = Date.parse(this.instance.now());
    let closed = 0;
    const open = this.db
      .prepare(
        `SELECT id, workspace_id, started_at, received_at FROM presentation_log
         WHERE ended_at IS NULL`,
      )
      .all();
    const lastActive = new Map<string, string | null>();
    for (const row of open) {
      const workspaceId = text(row.workspace_id);
      if (!lastActive.has(workspaceId)) {
        lastActive.set(workspaceId, this.liveLastActive(workspaceId));
      }
      const active = lastActive.get(workspaceId) ?? null;
      const heard = text(row.received_at);
      const last = active && active > heard ? active : heard;
      if (now - Date.parse(last) <= expiryMs) continue;
      const startedAt = text(row.started_at);
      this.closeByServer(text(row.id), last > startedAt ? last : startedAt);
      closed++;
    }
    return closed;
  }

  /** The workspace's live state's last activity, read before it is dropped as expired. */
  private liveLastActive(workspaceId: string): string | null {
    const row = this.db
      .prepare('SELECT snapshot FROM live_snapshot WHERE workspace_id = ?')
      .get(workspaceId);
    if (!row) return null;
    try {
      const snapshot = JSON.parse(text(row.snapshot)) as { state?: { lastActiveAt?: unknown } };
      const at = snapshot.state?.lastActiveAt;
      return typeof at === 'string' ? at : null;
    } catch {
      return null;
    }
  }

  get(id: string): StoredLogEntry | null {
    const row = this.db.prepare('SELECT * FROM presentation_log WHERE id = ?').get(id);
    return row ? toEntry(row) : null;
  }

  /** A workspace's entries that started in `[from, to)`, in order of their start. */
  range(workspaceId: string | null, from: string | null, to: string | null): StoredLogEntry[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (workspaceId) {
      where.push('workspace_id = ?');
      params.push(workspaceId);
    }
    if (from) {
      where.push('started_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('started_at < ?');
      params.push(to);
    }
    return this.db
      .prepare(
        `SELECT * FROM presentation_log${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
         ORDER BY started_at, id`,
      )
      .all(...params)
      .map(toEntry);
  }

  /** Entries changed after `cursor`, in the order they changed, at most `limit`. */
  after(workspaceId: string | null, cursor: number, limit: number): StoredLogEntry[] {
    const params: SqlValue[] = [cursor];
    let where = 'cursor > ?';
    if (workspaceId) {
      where += ' AND workspace_id = ?';
      params.push(workspaceId);
    }
    params.push(limit);
    return this.db
      .prepare(`SELECT * FROM presentation_log WHERE ${where} ORDER BY cursor LIMIT ?`)
      .all(...params)
      .map(toEntry);
  }

  /** The highest cursor given out, so a reader can start from now. */
  latestCursor(): number {
    return Number(
      this.db.prepare(`SELECT value FROM counter WHERE name = 'log'`).get()?.value ?? 0,
    );
  }
}

function toEntry(row: Record<string, SqlValue>): StoredLogEntry {
  const part = LogPartSchema.safeParse(JSON.parse(text(row.part)));
  const background =
    row.background == null ? null : LogBackgroundSchema.safeParse(JSON.parse(text(row.background)));
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    deviceId: text(row.device_id),
    deviceName: text(row.device_name),
    runSheetId: text(row.run_sheet_id),
    date: text(row.date),
    itemId: text(row.item_id),
    previous: Number(row.previous) === 1,
    songId: text(row.song_id),
    revision: Number(row.revision),
    revisionId: row.revision_id == null ? null : text(row.revision_id),
    version: row.version === 'own' || row.version === 'church' ? row.version : null,
    part: part.success ? part.data : { kind: 'website' },
    background: background?.success ? background.data : null,
    startedAt: text(row.started_at),
    endedAt: row.ended_at == null ? null : text(row.ended_at),
    closedByServer: Number(row.closed_by_server) === 1,
    clockOffsetMs: Number(row.clock_offset_ms),
    cursor: Number(row.cursor),
  };
}
