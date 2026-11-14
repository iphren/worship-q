/**
 * Recordings of each workspace's live audio broadcast (service records R1, R5, R8–R11). The
 * broadcasting desktop records its own capture track and uploads it here in short chunks,
 * one at a time and in order; each chunk is appended to the recording's file. The server
 * stores the bytes as they come and never transcodes.
 *
 * The file and its row agree on what is certain: the row's `bytes` and `next_seq` are written
 * after the chunk is on disk, so a file longer than its row holds a chunk that was being
 * written when the server stopped. It is cut back before the next chunk, and at start.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  RECORDING_CHUNK_MAX_BYTES,
  RECORDING_ID,
  RECORDING_IDLE_MS,
  recordingExtension,
  type RecordingComplete,
  type RecordingContainer,
  type RecordingOpen,
  type RecordingRefusal,
  type RecordingView,
} from '@worship-q/protocol';
import type { SqlValue } from './db';
import type { DeviceRow, Instance } from './instance';

export const DEFAULT_RECORDING_DAYS = 90;

/** Days recordings are kept, from the environment; 0 keeps them for ever (R10). */
export function recordingDaysFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.WORSHIP_Q_RECORDING_DAYS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_RECORDING_DAYS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_RECORDING_DAYS;
}

/** The type a recording's file is served as. */
export function recordingFileType(container: RecordingContainer): string {
  return container === 'webm' ? 'audio/webm' : 'audio/mp4';
}

export function recordingsDir(dataDir: string, workspaceId: string): string {
  return join(dataDir, 'recordings', workspaceId);
}

export type RecordingError =
  RecordingRefusal | 'not-found' | 'conflict' | { gap: true; expected: number };

const text = (value: SqlValue | undefined) => (value == null ? '' : String(value));

export class Recordings {
  constructor(
    private readonly instance: Instance,
    private readonly dataDir: string,
  ) {}

  private get db() {
    return this.instance.db;
  }

  /** Whether the church records live audio: on unless an administrator turned it off (R3). */
  enabled(): boolean {
    return this.instance.churchSettings().recordLiveAudio !== false;
  }

  /** The file a recording's chunks are appended to. */
  path(row: { workspaceId: string; id: string; container: RecordingContainer }): string {
    return join(
      recordingsDir(this.dataDir, row.workspaceId),
      `${row.id}.${recordingExtension(row.container)}`,
    );
  }

  /**
   * Opens a recording. Opening one again from the same device changes nothing, so the desktop
   * can repeat it after a lost answer; the same id from another device is refused.
   */
  open(
    device: DeviceRow,
    body: RecordingOpen,
  ): { recording: RecordingView } | { error: RecordingError } {
    const existing = this.row(body.id);
    if (existing) {
      if (existing.workspaceId !== device.workspaceId || existing.deviceId !== device.id) {
        return { error: 'conflict' };
      }
      return { recording: existing };
    }
    if (!this.enabled()) return { error: 'recording-off' };
    const now = this.instance.now();
    const view: RecordingView = {
      id: body.id,
      workspaceId: device.workspaceId,
      deviceId: device.id,
      deviceName: device.name,
      inputName: body.inputName,
      container: body.container,
      mimeType: body.mimeType,
      startedAt: body.startedAt,
      endedAt: null,
      bytes: 0,
      chunks: 0,
      lastChunkAt: null,
      status: 'receiving',
      cutShort: false,
      clockOffsetMs: offset(body.sentAt, now),
    };
    mkdirSync(recordingsDir(this.dataDir, device.workspaceId), { recursive: true });
    closeSync(openSync(this.path(view), 'a'));
    this.db
      .prepare(
        `INSERT INTO audio_recording (id, workspace_id, device_id, device_name, input_name,
           container, mime_type, started_at, clock_offset_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        view.id,
        view.workspaceId,
        view.deviceId,
        view.deviceName,
        view.inputName,
        view.container,
        view.mimeType,
        view.startedAt,
        view.clockOffsetMs,
        now,
      );
    return { recording: view };
  }

  /**
   * Appends chunk `seq`. Only the next one is taken: a chunk already stored is answered as a
   * duplicate, and one past the next is refused with the number expected (R8).
   */
  append(
    device: DeviceRow,
    id: string,
    seq: number,
    bytes: Uint8Array,
  ): { next: number; duplicate: boolean } | { error: RecordingError } {
    const row = this.row(id);
    if (!row || row.workspaceId !== device.workspaceId) return { error: 'not-found' };
    if (row.deviceId !== device.id) return { error: 'not-owner' };
    if (seq < row.chunks) return { next: row.chunks, duplicate: true };
    if (row.status === 'complete') return { error: 'completed' };
    if (!this.enabled()) return { error: 'recording-off' };
    if (seq > row.chunks) return { error: { gap: true, expected: row.chunks } };
    if (bytes.length > RECORDING_CHUNK_MAX_BYTES) throw new Error('Chunk over the limit');
    const path = this.path(row);
    mkdirSync(recordingsDir(this.dataDir, row.workspaceId), { recursive: true });
    const fd = openSync(path, existsSync(path) ? 'r+' : 'w+');
    try {
      // A chunk half-written before a stop is cut off first.
      if (fstatSync(fd).size !== row.bytes) ftruncateSync(fd, row.bytes);
      let written = 0;
      while (written < bytes.length) {
        written += writeSync(fd, bytes, written, bytes.length - written, row.bytes + written);
      }
    } finally {
      closeSync(fd);
    }
    this.db
      .prepare(`UPDATE audio_recording SET bytes = ?, next_seq = ?, last_chunk_at = ? WHERE id = ?`)
      .run(row.bytes + bytes.length, row.chunks + 1, this.instance.now(), id);
    return { next: row.chunks + 1, duplicate: false };
  }

  /** Closes a recording with its end time; a chunk after it is refused. */
  complete(
    device: DeviceRow,
    id: string,
    body: RecordingComplete,
  ): { recording: RecordingView } | { error: RecordingError } {
    const row = this.row(id);
    if (!row || row.workspaceId !== device.workspaceId) return { error: 'not-found' };
    if (row.deviceId !== device.id) return { error: 'not-owner' };
    if (row.status !== 'complete') {
      this.db
        .prepare(
          `UPDATE audio_recording SET ended_at = ?, completed = 1, cut_short = ? WHERE id = ?`,
        )
        .run(body.endedAt, body.cutShort ? 1 : 0, id);
    }
    return { recording: this.row(id)! };
  }

  /** One recording, or null. */
  get(id: string): RecordingView | null {
    return RECORDING_ID.test(id) ? this.row(id) : null;
  }

  /**
   * A workspace's recordings that overlap `[from, to)`, oldest first; either end may be open.
   * A recording not yet complete runs to its last chunk.
   */
  list(
    workspaceId: string | null,
    range: { from?: string | null; to?: string | null } = {},
  ): RecordingView[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (workspaceId) {
      where.push('workspace_id = ?');
      params.push(workspaceId);
    }
    if (range.to) {
      where.push('started_at < ?');
      params.push(range.to);
    }
    if (range.from) {
      where.push('coalesce(ended_at, last_chunk_at, started_at) >= ?');
      params.push(range.from);
    }
    const sql = `SELECT * FROM audio_recording${
      where.length ? ` WHERE ${where.map((w) => `(${w})`).join(' AND ')}` : ''
    } ORDER BY started_at, id`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => this.toView(row));
  }

  /** Removes a recording and its file. */
  remove(id: string): boolean {
    const row = this.get(id);
    if (!row) return false;
    rmSync(this.path(row), { force: true });
    this.db.prepare('DELETE FROM audio_recording WHERE id = ?').run(id);
    return true;
  }

  /**
   * Removes recordings that started more than `days` before now (R10); 0 keeps them for ever.
   * Returns how many were removed.
   */
  sweep(days: number, now: string = this.instance.now()): number {
    if (days <= 0) return 0;
    const before = new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
    const old = this.db
      .prepare('SELECT id FROM audio_recording WHERE started_at < ?')
      .all(before)
      .map((row) => text(row.id));
    for (const id of old) this.remove(id);
    return old.length;
  }

  /**
   * At start: cuts every file back to what its row says it holds, so a chunk half-written
   * when the server stopped is dropped, and the desktop sends it again (M2.2).
   */
  repair(): number {
    let cut = 0;
    for (const row of this.list(null)) {
      const path = this.path(row);
      if (!existsSync(path)) continue;
      if (statSync(path).size > row.bytes) {
        const fd = openSync(path, 'r+');
        try {
          ftruncateSync(fd, row.bytes);
        } finally {
          closeSync(fd);
        }
        cut++;
      }
    }
    return cut;
  }

  /** Bytes and files of recordings, by workspace, for the storage report. */
  usage(): Map<string, { bytes: number; files: number }> {
    const usage = new Map<string, { bytes: number; files: number }>();
    const root = join(this.dataDir, 'recordings');
    if (!existsSync(root)) return usage;
    for (const workspaceId of readdirSync(root)) {
      const dir = join(root, workspaceId);
      if (!statSync(dir).isDirectory()) continue;
      const total = { bytes: 0, files: 0 };
      for (const name of readdirSync(dir)) {
        const stat = statSync(join(dir, name), { throwIfNoEntry: false });
        if (!stat?.isFile()) continue;
        total.bytes += stat.size;
        total.files += 1;
      }
      usage.set(workspaceId, total);
    }
    return usage;
  }

  private row(id: string): RecordingView | null {
    const row = this.db.prepare('SELECT * FROM audio_recording WHERE id = ?').get(id);
    return row ? this.toView(row) : null;
  }

  private toView(row: Record<string, SqlValue>): RecordingView {
    const lastChunkAt = row.last_chunk_at == null ? null : text(row.last_chunk_at);
    const completed = Number(row.completed) === 1;
    const since = Date.parse(lastChunkAt ?? text(row.created_at));
    const idle = Date.parse(this.instance.now()) - since > RECORDING_IDLE_MS;
    return {
      id: text(row.id),
      workspaceId: text(row.workspace_id),
      deviceId: text(row.device_id),
      deviceName: text(row.device_name),
      inputName: text(row.input_name),
      container: text(row.container) as RecordingContainer,
      mimeType: text(row.mime_type),
      startedAt: text(row.started_at),
      endedAt: row.ended_at == null ? null : text(row.ended_at),
      bytes: Number(row.bytes),
      chunks: Number(row.next_seq),
      lastChunkAt,
      status: completed ? 'complete' : idle ? 'interrupted' : 'receiving',
      cutShort: Number(row.cut_short) === 1,
      clockOffsetMs: Number(row.clock_offset_ms),
    };
  }
}

/** The sender's clock minus ours, in whole milliseconds; 0 when the time is unreadable. */
export function offset(sentAt: string, now: string): number {
  const sent = Date.parse(sentAt);
  const here = Date.parse(now);
  return Number.isFinite(sent) && Number.isFinite(here) ? Math.round(sent - here) : 0;
}
