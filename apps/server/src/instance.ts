/**
 * The instance's data: workspaces, enrolled devices, synchronized records, church
 * defaults and backups. Everything the HTTP routes and the admin command do goes through
 * here.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ChurchSettingsSchema,
  syncWins,
  type ChurchSettings,
  type SyncRecord,
} from '@worship-q/protocol';
import { transaction, type Database, type SqlValue } from './db';

export interface WorkspaceRow {
  id: string;
  name: string;
  contentId: string | null;
}

export interface DeviceRow {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** A random secret that is easy to read aloud and type: groups of letters and digits. */
export function enrollmentCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/** Codes are compared without spaces, dashes or case. */
export function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

const text = (value: SqlValue | undefined) => (value == null ? '' : String(value));
const optional = (value: SqlValue | undefined) => (value == null ? null : String(value));

export class Instance {
  constructor(
    readonly db: Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  // ── Workspaces ───────────────────────────────────────────────────────────

  createWorkspace(name: string): { workspace: WorkspaceRow; code: string } {
    const code = enrollmentCode();
    const workspace = { id: randomUUID(), name, contentId: null };
    this.db
      .prepare(
        'INSERT INTO workspace (id, name, content_id, enroll_hash, created_at) VALUES (?, ?, NULL, ?, ?)',
      )
      .run(workspace.id, name, hashSecret(normalizeCode(code)), this.now());
    return { workspace, code };
  }

  /** Replaces a workspace's enrollment code; devices already enrolled keep working. */
  rotateCode(workspaceId: string): string {
    const code = enrollmentCode();
    const result = this.db
      .prepare('UPDATE workspace SET enroll_hash = ? WHERE id = ?')
      .run(hashSecret(normalizeCode(code)), workspaceId);
    if (Number(result.changes) === 0) throw new Error(`No workspace ${workspaceId}`);
    return code;
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.db
      .prepare('SELECT * FROM workspace ORDER BY created_at')
      .all()
      .map((row) => ({
        id: text(row.id),
        name: text(row.name),
        contentId: optional(row.content_id),
      }));
  }

  getWorkspace(id: string): WorkspaceRow | null {
    const row = this.db.prepare('SELECT * FROM workspace WHERE id = ?').get(id);
    return row
      ? { id: text(row.id), name: text(row.name), contentId: optional(row.content_id) }
      : null;
  }

  /**
   * Sets the identifier the workspace's content uses, if no device has set it yet. Returns
   * the identifier in effect.
   */
  claimContent(workspaceId: string, contentId: string): string {
    return transaction(this.db, () => {
      const workspace = this.getWorkspace(workspaceId);
      if (!workspace) throw new Error(`No workspace ${workspaceId}`);
      if (workspace.contentId) return workspace.contentId;
      this.db
        .prepare('UPDATE workspace SET content_id = ? WHERE id = ?')
        .run(contentId, workspaceId);
      return contentId;
    });
  }

  // ── Devices ──────────────────────────────────────────────────────────────

  enroll(code: string, name: string): { device: DeviceRow; token: string } | null {
    const row = this.db
      .prepare('SELECT id FROM workspace WHERE enroll_hash = ?')
      .get(hashSecret(normalizeCode(code)));
    if (!row) return null;
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const device: DeviceRow = {
      id: randomUUID(),
      workspaceId: text(row.id),
      name: name.slice(0, 60) || 'Desktop',
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO device (id, workspace_id, name, token_hash, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(device.id, device.workspaceId, device.name, hashSecret(token), now, now);
    return { device, token };
  }

  /** The device a token belongs to, unless it was revoked. Records that it was seen. */
  authenticate(token: string): DeviceRow | null {
    const row = this.db
      .prepare('SELECT * FROM device WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hashSecret(token));
    if (!row) return null;
    const now = this.now();
    this.db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(now, text(row.id));
    return toDevice({ ...row, last_seen_at: now });
  }

  listDevices(workspaceId?: string): DeviceRow[] {
    const rows = workspaceId
      ? this.db
          .prepare('SELECT * FROM device WHERE workspace_id = ? ORDER BY created_at')
          .all(workspaceId)
      : this.db.prepare('SELECT * FROM device ORDER BY created_at').all();
    return rows.map(toDevice);
  }

  isActiveDevice(deviceId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM device WHERE id = ? AND revoked_at IS NULL').get(deviceId) !==
      undefined
    );
  }

  revokeDevice(deviceId: string): boolean {
    const result = this.db
      .prepare('UPDATE device SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(this.now(), deviceId);
    return Number(result.changes) > 0;
  }

  // ── Records ──────────────────────────────────────────────────────────────

  /**
   * Stores the records that win over what the instance has. A run sheet is one per date:
   * one arriving under a new identifier for a date already known keeps the known
   * identifier, and the device is told to adopt it. Returns the remapped identifiers and
   * whether anything was stored.
   */
  push(
    workspaceId: string,
    deviceId: string,
    records: readonly SyncRecord[],
  ): { remap: Record<string, string>; stored: number } {
    const remap: Record<string, string> = {};
    let stored = 0;
    transaction(this.db, () => {
      const find = this.db.prepare(
        'SELECT id, revision, updated_at FROM record WHERE workspace_id = ? AND kind = ? AND key = ?',
      );
      const upsert = this.db.prepare(
        `INSERT INTO record (workspace_id, kind, key, id, revision, updated_at, seq, data, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, kind, key) DO UPDATE SET id = excluded.id,
           revision = excluded.revision, updated_at = excluded.updated_at, seq = excluded.seq,
           data = excluded.data, device_id = excluded.device_id`,
      );
      for (const incoming of records) {
        const existing = find.get(workspaceId, incoming.kind, incoming.key);
        let record = incoming;
        if (existing && text(existing.id) !== incoming.id) {
          if (incoming.kind !== 'runSheet') continue;
          remap[incoming.id] = text(existing.id);
          record = { ...incoming, id: text(existing.id) };
        }
        const current = existing
          ? { revision: Number(existing.revision), updatedAt: text(existing.updated_at) }
          : null;
        if (!syncWins(record, current)) continue;
        upsert.run(
          workspaceId,
          record.kind,
          record.key,
          record.id,
          record.revision,
          record.updatedAt,
          this.nextSeq(),
          JSON.stringify(record.data),
          deviceId,
        );
        stored++;
      }
    });
    return { remap, stored };
  }

  private nextSeq(): number {
    this.db.prepare(`UPDATE counter SET value = value + 1 WHERE name = 'seq'`).run();
    return Number(this.db.prepare(`SELECT value FROM counter WHERE name = 'seq'`).get()!.value);
  }

  /** Records changed after `since` in the change feed, oldest first. */
  pull(
    workspaceId: string,
    since: number,
    limit = 500,
  ): { records: SyncRecord[]; cursor: number; more: boolean } {
    const rows = this.db
      .prepare('SELECT * FROM record WHERE workspace_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(workspaceId, since, limit + 1);
    const page = rows.slice(0, limit);
    return {
      records: page.map((row) => ({
        kind: text(row.kind) as SyncRecord['kind'],
        id: text(row.id),
        key: text(row.key),
        revision: Number(row.revision),
        updatedAt: text(row.updated_at),
        data: JSON.parse(text(row.data)) as Record<string, unknown>,
      })),
      cursor: page.length > 0 ? Number(page[page.length - 1]!.seq) : since,
      more: rows.length > limit,
    };
  }

  /** Whether a workspace's records mention a background file, so devices may fetch it. */
  hasBackground(workspaceId: string, fileName: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM record WHERE workspace_id = ? AND kind = 'background'
           AND json_extract(data, '$.fileName') = ?`,
        )
        .get(workspaceId, fileName) !== undefined
    );
  }

  // ── Church defaults ──────────────────────────────────────────────────────

  churchSettings(): ChurchSettings {
    const stored: Record<string, unknown> = {};
    for (const row of this.db.prepare('SELECT key, value FROM church_setting').all()) {
      stored[text(row.key)] = JSON.parse(text(row.value));
    }
    const parsed = ChurchSettingsSchema.safeParse(stored);
    return parsed.success ? parsed.data : {};
  }

  setChurchSetting(key: string, value: unknown): void {
    const next = ChurchSettingsSchema.parse({ ...this.churchSettings(), [key]: value });
    if (!(key in ChurchSettingsSchema.shape)) throw new Error(`Unknown setting ${key}`);
    this.db
      .prepare(
        `INSERT INTO church_setting (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(next[key as keyof ChurchSettings]));
  }

  unsetChurchSetting(key: string): void {
    this.db.prepare('DELETE FROM church_setting WHERE key = ?').run(key);
  }

  // ── Backups ──────────────────────────────────────────────────────────────

  addBackup(workspaceId: string, deviceId: string, file: string, size: number): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO backup (id, workspace_id, device_id, file, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, workspaceId, deviceId, file, size, this.now());
    return id;
  }

  listBackups(
    workspaceId: string,
  ): { id: string; file: string; size: number; createdAt: string; deviceId: string }[] {
    return this.db
      .prepare('SELECT * FROM backup WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId)
      .map((row) => ({
        id: text(row.id),
        file: text(row.file),
        size: Number(row.size),
        createdAt: text(row.created_at),
        deviceId: text(row.device_id),
      }));
  }

  removeBackup(id: string): void {
    this.db.prepare('DELETE FROM backup WHERE id = ?').run(id);
  }
}

function toDevice(row: Record<string, SqlValue>): DeviceRow {
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    name: text(row.name),
    createdAt: text(row.created_at),
    lastSeenAt: text(row.last_seen_at),
    revokedAt: optional(row.revoked_at),
  };
}
