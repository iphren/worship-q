/**
 * The instance's data: workspaces, enrolled devices, synchronized records, church
 * defaults and backups. Everything the HTTP routes and the admin command do goes through
 * here.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_EXPIRY_MS, isExpired } from '@worship-q/live-state';
import {
  ChurchSettingsSchema,
  LiveSnapshotSchema,
  OutputKindSchema,
  syncWins,
  wellFormed,
  WorkspaceGrantSchema,
  type ChurchSettings,
  type LiveSnapshot,
  type OutputKind,
  type OutputLink,
  type OutputView,
  type SyncRecord,
  type WorkspaceGrant,
} from '@worship-q/protocol';
import { z } from 'zod';
import { transaction, type Database, type SqlValue } from './db';

export interface WorkspaceRow {
  id: string;
  name: string;
  contentId: string | null;
  /** Its songs and backgrounds are the Church Library's (“Manage Church Library”). */
  manageLibrary: boolean;
}

/** The kinds of record the Church Library holds. */
export const LIBRARY_KINDS: readonly SyncRecord['kind'][] = ['song', 'songRevision', 'background'];

/** What turning on “Manage Church Library” for a workspace does, by title. */
export interface LibraryPlan {
  /** Songs of the workspace that become the church's. */
  songs: string[];
  /** Backgrounds of the workspace that become the church's. */
  backgrounds: string[];
  /** Church songs the workspace changed; its version replaces them for every workspace. */
  overrides: string[];
  /** Church songs and backgrounds the workspace removed, which reappear for it. */
  hidden: string[];
}

export interface DeviceRow {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface OutputLinkRow extends OutputLink {
  workspaceId: string;
  revokedAt: string | null;
}

/** The instance's copy of a workspace's live state (decision D17). */
export interface LiveBackup {
  snapshot: LiveSnapshot;
  grants: WorkspaceGrant[];
  deviceId: string | null;
  updatedAt: string;
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
    const workspace = { id: randomUUID(), name, contentId: null, manageLibrary: false };
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
    return this.db.prepare('SELECT * FROM workspace ORDER BY created_at').all().map(toWorkspace);
  }

  getWorkspace(id: string): WorkspaceRow | null {
    const row = this.db.prepare('SELECT * FROM workspace WHERE id = ?').get(id);
    return row ? toWorkspace(row) : null;
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

  /**
   * The workspace's active devices with the hash of their token, so a coordinator can accept
   * them on the venue network without the server (plan M5.3). Hashes only: a token itself
   * never leaves the device that holds it.
   */
  lanCredentials(workspaceId: string): { deviceId: string; name: string; tokenHash: string }[] {
    return this.db
      .prepare(
        'SELECT id, name, token_hash FROM device WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at',
      )
      .all(workspaceId)
      .map((row) => ({
        deviceId: text(row.id),
        name: text(row.name),
        tokenHash: text(row.token_hash),
      }));
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
   * identifier, and the device is told to adopt it. Returns the remapped identifiers, how
   * many records were stored, and how many of those went to the Church Library.
   *
   * Songs and backgrounds of a workspace that manages the Church Library go to it. In any
   * other workspace, a change to a church song or background is kept as that workspace's
   * own version of it: an edit replaces the church's in that workspace, a removal hides it
   * there.
   */
  push(
    workspaceId: string,
    deviceId: string,
    records: readonly SyncRecord[],
  ): { remap: Record<string, string>; stored: number; central: number } {
    const remap: Record<string, string> = {};
    let stored = 0;
    let central = 0;
    const manages = this.getWorkspace(workspaceId)?.manageLibrary ?? false;
    transaction(this.db, () => {
      const find = this.db.prepare(
        'SELECT id, revision, updated_at FROM record WHERE workspace_id = ? AND kind = ? AND key = ?',
      );
      const findChurch = this.db.prepare(
        'SELECT revision, updated_at FROM church_record WHERE kind = ? AND key = ?',
      );
      const upsert = this.db.prepare(
        `INSERT INTO record (workspace_id, kind, key, id, revision, updated_at, seq, data, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, kind, key) DO UPDATE SET id = excluded.id,
           revision = excluded.revision, updated_at = excluded.updated_at, seq = excluded.seq,
           data = excluded.data, device_id = excluded.device_id`,
      );
      const version = (row: Record<string, SqlValue> | undefined) =>
        row ? { revision: Number(row.revision), updatedAt: text(row.updated_at) } : null;
      for (const received of records) {
        const incoming = wellFormed(received);
        const existing = find.get(workspaceId, incoming.kind, incoming.key);
        if (isLibraryKind(incoming.kind)) {
          const church = findChurch.get(incoming.kind, incoming.key);
          if (manages && !existing) {
            if (!syncWins(incoming, version(church))) continue;
            this.putChurch(incoming, deviceId, workspaceId);
            stored++;
            central++;
            continue;
          }
          // A church record sent back as it was received is not a change of this
          // workspace's own.
          if (!existing && church && !syncWins(incoming, version(church))) continue;
        }
        let record = incoming;
        if (existing && text(existing.id) !== incoming.id) {
          if (incoming.kind !== 'runSheet') continue;
          remap[incoming.id] = text(existing.id);
          record = { ...incoming, id: text(existing.id) };
        }
        // A run sheet a device only opened, never edited, never replaces a known one. Older
        // apps still send them.
        if (existing && incoming.kind === 'runSheet' && untouchedRunSheet(incoming)) continue;
        if (!syncWins(record, version(existing))) continue;
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
    return { remap, stored, central };
  }

  private putChurch(record: SyncRecord, deviceId: string | null, workspaceId: string): void {
    this.db
      .prepare(
        `INSERT INTO church_record (kind, key, id, revision, updated_at, seq, data, device_id, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (kind, key) DO UPDATE SET id = excluded.id, revision = excluded.revision,
           updated_at = excluded.updated_at, seq = excluded.seq, data = excluded.data,
           device_id = excluded.device_id, workspace_id = excluded.workspace_id`,
      )
      .run(
        record.kind,
        record.key,
        record.id,
        record.revision,
        record.updatedAt,
        this.nextSeq(),
        JSON.stringify(record.data),
        deviceId,
        workspaceId,
      );
  }

  private nextSeq(): number {
    this.db.prepare(`UPDATE counter SET value = value + 1 WHERE name = 'seq'`).run();
    return Number(this.db.prepare(`SELECT value FROM counter WHERE name = 'seq'`).get()!.value);
  }

  /**
   * Records changed after `since` in the change feed, oldest first: the workspace's own,
   * and the Church Library's except where the workspace has its own version.
   */
  pull(
    workspaceId: string,
    since: number,
    limit = 500,
  ): { records: SyncRecord[]; cursor: number; more: boolean } {
    const rows = this.db
      .prepare(
        `SELECT kind, key, id, revision, updated_at, data, seq FROM record
         WHERE workspace_id = ? AND seq > ?
         UNION ALL
         SELECT c.kind, c.key, c.id, c.revision, c.updated_at, c.data, c.seq FROM church_record c
         WHERE c.seq > ? AND NOT EXISTS (SELECT 1 FROM record r
           WHERE r.workspace_id = ? AND r.kind = c.kind AND r.key = c.key)
         ORDER BY seq LIMIT ?`,
      )
      .all(workspaceId, since, since, workspaceId, limit + 1);
    const page = rows.slice(0, limit);
    return {
      records: page.map((row) => {
        const record = toRecord(row);
        // Text stored before broken characters were replaced on the way in is fixed here.
        return { ...record, data: wellFormed(record.data) };
      }),
      cursor: page.length > 0 ? Number(page[page.length - 1]!.seq) : since,
      more: rows.length > limit,
    };
  }

  /**
   * A workspace's records of one kind, each with the device that last stored it. Songs and
   * backgrounds of a workspace that manages the Church Library are the church's.
   */
  records(
    workspaceId: string,
    kind: SyncRecord['kind'],
  ): { record: SyncRecord; deviceId: string }[] {
    const church = isLibraryKind(kind) && this.getWorkspace(workspaceId)?.manageLibrary;
    const rows = church
      ? this.db.prepare('SELECT * FROM church_record WHERE kind = ? ORDER BY seq').all(kind)
      : this.db
          .prepare('SELECT * FROM record WHERE workspace_id = ? AND kind = ? ORDER BY seq')
          .all(workspaceId, kind);
    return rows.map((row) => ({ record: toRecord(row), deviceId: text(row.device_id) }));
  }

  // ── Church Library ───────────────────────────────────────────────────────

  private libraryRows(workspaceId: string) {
    const kinds = LIBRARY_KINDS.map(() => '?').join(', ');
    const findChurch = this.db.prepare('SELECT * FROM church_record WHERE kind = ? AND key = ?');
    return this.db
      .prepare(`SELECT * FROM record WHERE workspace_id = ? AND kind IN (${kinds}) ORDER BY seq`)
      .all(workspaceId, ...LIBRARY_KINDS)
      .map((own) => ({ own, church: findChurch.get(text(own.kind), text(own.key)) }));
  }

  /** What `setManageLibrary(workspaceId, true)` would do. */
  libraryPlan(workspaceId: string): LibraryPlan {
    const plan: LibraryPlan = { songs: [], backgrounds: [], overrides: [], hidden: [] };
    for (const { own, church } of this.libraryRows(workspaceId)) {
      const kind = text(own.kind);
      if (kind === 'songRevision') continue;
      const churchLive = church && !removed(church.data);
      if (removed(own.data)) {
        if (churchLive) plan.hidden.push(titleOf(church.data));
      } else if (churchLive) {
        plan.overrides.push(titleOf(own.data));
      } else {
        (kind === 'song' ? plan.songs : plan.backgrounds).push(titleOf(own.data));
      }
    }
    return plan;
  }

  /**
   * Turns “Manage Church Library” on or off. Turning it on brings the workspace's songs and
   * backgrounds into the Church Library: its own versions of church songs replace them for
   * every workspace, and church songs and backgrounds it removed reappear for it. Turning
   * it off leaves the Church Library as it is.
   *
   * Background files are not moved here; see `moveFilesToChurch`.
   */
  setManageLibrary(workspaceId: string, on: boolean): void {
    transaction(this.db, () => {
      const result = this.db
        .prepare('UPDATE workspace SET manage_library = ? WHERE id = ?')
        .run(on ? 1 : 0, workspaceId);
      if (Number(result.changes) === 0) throw new Error(`No workspace ${workspaceId}`);
      if (!on) return;
      const drop = this.db.prepare(
        'DELETE FROM record WHERE workspace_id = ? AND kind = ? AND key = ?',
      );
      for (const { own, church } of this.libraryRows(workspaceId)) {
        const record = toRecord(own);
        if (church) {
          const churchRecord = toRecord(church);
          const hidden = removed(own.data) && !removed(church.data);
          // Newer than any copy a device has, so every device takes it.
          this.putChurch(
            {
              ...(hidden ? churchRecord : record),
              revision: Math.max(record.revision, churchRecord.revision) + 1,
              updatedAt: this.now(),
            },
            hidden ? optional(church.device_id) : optional(own.device_id),
            hidden ? text(church.workspace_id) : workspaceId,
          );
        } else {
          this.putChurch(record, optional(own.device_id), workspaceId);
        }
        drop.run(workspaceId, record.kind, record.key);
      }
    });
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

  // ── Live state backup (M4.1) ─────────────────────────────────────────────

  /**
   * Keeps the coordinator's latest snapshot and the workspace's grant list. An older
   * revision from the same coordinator never replaces a newer one; another coordinator's
   * snapshot always does, since the relay made it the coordinator.
   */
  putLive(
    workspaceId: string,
    deviceId: string,
    snapshot: LiveSnapshot,
    grants: readonly WorkspaceGrant[],
  ): boolean {
    const current = this.getLive(workspaceId);
    if (
      current &&
      current.snapshot.coordinatorId === snapshot.coordinatorId &&
      current.snapshot.revision > snapshot.revision
    ) {
      return false;
    }
    this.db
      .prepare(
        `INSERT INTO live_snapshot (workspace_id, revision, snapshot, grants, device_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id) DO UPDATE SET revision = excluded.revision,
           snapshot = excluded.snapshot, grants = excluded.grants, device_id = excluded.device_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        workspaceId,
        snapshot.revision,
        JSON.stringify(wellFormed(snapshot)),
        JSON.stringify(grants),
        deviceId,
        this.now(),
      );
    return true;
  }

  /** The kept snapshot, or null when there is none or it has expired (D6, four hours). */
  getLive(workspaceId: string, expiryMs = DEFAULT_EXPIRY_MS): LiveBackup | null {
    const row = this.db
      .prepare('SELECT * FROM live_snapshot WHERE workspace_id = ?')
      .get(workspaceId);
    if (!row) return null;
    const snapshot = LiveSnapshotSchema.safeParse(JSON.parse(text(row.snapshot)));
    if (!snapshot.success || isExpired(snapshot.data.state, this.now(), expiryMs)) {
      this.db.prepare('DELETE FROM live_snapshot WHERE workspace_id = ?').run(workspaceId);
      return null;
    }
    const grants = z.array(WorkspaceGrantSchema).safeParse(JSON.parse(text(row.grants)));
    return {
      snapshot: snapshot.data,
      grants: grants.success ? grants.data : [],
      deviceId: optional(row.device_id),
      updatedAt: text(row.updated_at),
    };
  }

  // ── Browser output links (M7.1) ──────────────────────────────────────────

  /** Makes an output link. The token is returned once and only its hash is kept. */
  createOutputLink(
    workspaceId: string,
    kind: OutputKind,
    name: string,
  ): { link: OutputLinkRow; token: string } {
    if (!this.getWorkspace(workspaceId)) throw new Error(`No workspace ${workspaceId}`);
    const token = randomBytes(24).toString('base64url');
    const link: OutputLinkRow = {
      id: randomUUID(),
      workspaceId,
      kind: OutputKindSchema.parse(kind),
      name: name.trim().slice(0, 60) || (kind === 'subtitle' ? 'Subtitle overlay' : 'Slideshow'),
      createdAt: this.now(),
      revokedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO output_link (id, workspace_id, kind, token_hash, name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(link.id, workspaceId, link.kind, hashSecret(token), link.name, link.createdAt);
    return { link, token };
  }

  listOutputLinks(workspaceId: string): OutputLinkRow[] {
    return this.db
      .prepare(
        'SELECT * FROM output_link WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at',
      )
      .all(workspaceId)
      .map(toOutputLink);
  }

  /** Revokes one link of a workspace, or every link when `id` is omitted. Returns what was revoked. */
  revokeOutputLinks(workspaceId: string, id?: string): string[] {
    const rows = this.listOutputLinks(workspaceId).filter((link) => !id || link.id === id);
    const revoke = this.db.prepare('UPDATE output_link SET revoked_at = ? WHERE id = ?');
    for (const link of rows) revoke.run(this.now(), link.id);
    return rows.map((link) => link.id);
  }

  /** The link a token belongs to, unless it was revoked. */
  authenticateOutputLink(token: string): OutputLinkRow | null {
    const row = this.db
      .prepare('SELECT * FROM output_link WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hashSecret(token));
    return row ? toOutputLink(row) : null;
  }

  isActiveOutputLink(id: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM output_link WHERE id = ? AND revoked_at IS NULL').get(id) !==
      undefined
    );
  }

  /**
   * How a workspace's output looks, from its synchronized settings and the church defaults,
   * for browser output pages that have no database of their own (M7.2).
   */
  outputLook(workspaceId: string, kind: OutputKind): OutputView['look'] {
    const settings = new Map<string, unknown>();
    for (const { record } of this.records(workspaceId, 'setting')) {
      settings.set(record.key, record.data.value);
    }
    const church = this.churchSettings();
    const look = (settings.get(`outputLook.${kind}`) ?? {}) as Record<string, unknown>;
    const churchFont =
      kind === 'slideshow' ? church.slideshowFontFamily : church.subtitleFontFamily;
    const number = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const assetId = typeof look.backgroundAssetId === 'string' ? look.backgroundAssetId : null;
    let backgroundFile: NonNullable<OutputView['look']>['backgroundFile'] = null;
    if (assetId) {
      const asset = [
        ...this.records(workspaceId, 'background'),
        ...this.churchRecords('background'),
      ].find(({ record }) => record.id === assetId && !record.data.removedAt);
      if (asset) {
        backgroundFile = {
          kind: asset.record.data.kind === 'video' ? 'video' : 'image',
          fileName: String(asset.record.data.fileName),
        };
      }
    }
    return {
      fontFamily: typeof look.fontFamily === 'string' ? look.fontFamily : (churchFont ?? null),
      scale: number(look.scale, 1),
      backgroundColor: typeof look.backgroundColor === 'string' ? look.backgroundColor : '#000000',
      backgroundFile,
      linesPerPiece: number(settings.get('linesPerPiece'), church.linesPerPiece ?? 2),
      wrapLongLines:
        typeof settings.get('wrapLongLines') === 'boolean'
          ? (settings.get('wrapLongLines') as boolean)
          : (church.wrapLongLines ?? true),
    };
  }

  private churchRecords(kind: SyncRecord['kind']): { record: SyncRecord; deviceId: string }[] {
    return this.db
      .prepare('SELECT * FROM church_record WHERE kind = ? ORDER BY seq')
      .all(kind)
      .map((row) => ({ record: toRecord(row), deviceId: text(row.device_id) }));
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

function toWorkspace(row: Record<string, SqlValue>): WorkspaceRow {
  return {
    id: text(row.id),
    name: text(row.name),
    contentId: optional(row.content_id),
    manageLibrary: Number(row.manage_library ?? 0) === 1,
  };
}

function toRecord(row: Record<string, SqlValue>): SyncRecord {
  return {
    kind: text(row.kind) as SyncRecord['kind'],
    id: text(row.id),
    key: text(row.key),
    revision: Number(row.revision),
    updatedAt: text(row.updated_at),
    data: JSON.parse(text(row.data)) as Record<string, unknown>,
  };
}

const isLibraryKind = (kind: string) => (LIBRARY_KINDS as readonly string[]).includes(kind);
const removed = (data: SqlValue | undefined) =>
  (JSON.parse(text(data)) as { removedAt?: unknown }).removedAt != null;
const titleOf = (data: SqlValue | undefined) => {
  const parsed = JSON.parse(text(data)) as { title?: unknown; originalName?: unknown };
  return String(parsed.title ?? parsed.originalName ?? '');
};

function toOutputLink(row: Record<string, SqlValue>): OutputLinkRow {
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    kind: text(row.kind) as OutputKind,
    name: text(row.name),
    createdAt: text(row.created_at),
    revokedAt: optional(row.revoked_at),
  };
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

/** A run sheet created when a device opened its date, with nothing ever added. */
function untouchedRunSheet(record: SyncRecord): boolean {
  const items = record.data.items;
  return record.revision <= 1 && (!Array.isArray(items) || items.length === 0);
}
