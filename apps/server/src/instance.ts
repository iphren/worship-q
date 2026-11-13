/**
 * The instance's data: workspaces, enrolled devices, synchronized records, church
 * defaults and backups. Everything the HTTP routes and the admin command do goes through
 * here.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_EXPIRY_MS, isExpired } from '@worship-q/live-state';
import {
  ChurchSettingsSchema,
  LIBRARY_TYPES,
  LiveSnapshotSchema,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  VIDEO_PROTOCOL_VERSION,
  PASSAGE_PROTOCOL_VERSION,
  songBadge,
  OutputKindSchema,
  syncWins,
  wellFormed,
  WorkspaceGrantSchema,
  type AdminAdministrator,
  type AdminLibraryContent,
  type AdminLibraryItem,
  type AdminLibraryPlan,
  type AdminLibraryUsage,
  type AdminPairingRequest,
  type AdminRunSheet,
  type AdminRunSheetDays,
  type ChurchSettings,
  type EnrolledBy,
  type LibraryKind,
  libraryTypeOf,
  libraryTypes,
  type LibraryType,
  type LiveSnapshot,
  type OutputKind,
  type OutputLink,
  type OutputView,
  type PairingPollResponse,
  type SyncRecord,
  type WorkspaceGrant,
} from '@worship-q/protocol';
import { z } from 'zod';
import { transaction, type Database, type SqlValue } from './db';

export interface WorkspaceRow {
  id: string;
  name: string;
  contentId: string | null;
  /**
   * What of the Church Library it manages (“Manage Church Library”, per type): its records
   * of these types are the Church Library's. Empty when it manages none.
   */
  libraryTypes: LibraryType[];
  /** Its connection code works although the instance has administrators (D30). */
  codesEnabled: boolean;
  createdAt: string;
}

/** The first protocol version that receives record origins and shadows (D26, D31). */
export const ORIGINS_PROTOCOL = 3;
/** How long a pairing request waits for an administrator (D29). */
export const PAIRING_TTL_MS = 15 * 60 * 1000;
export const PAIRING_INTERVAL_MS = 5000;
/** Pairing requests that may wait at once, from one address and in all (D29). */
export const PAIRING_MAX_PENDING_PER_ADDRESS = 3;
export const PAIRING_MAX_PENDING = 30;
/** A sign-in session ends after this long without a request (D27). */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
/** A sign-in started but not finished is forgotten after this long. */
export const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** The kinds of record the Church Library holds. */
export const LIBRARY_KINDS: readonly SyncRecord['kind'][] = ['song', 'songRevision', 'background'];

/** What turning on “Manage Church Library” for a workspace does, by title (D36). */
export type LibraryPlan = AdminLibraryPlan;

export interface DeviceRow {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  enrolledBy: EnrolledBy;
  /** The administrator who approved the pairing, by identifier. */
  approvedBy: string | null;
}

export interface AdministratorRow extends AdminAdministrator {
  subject: string | null;
  removedAt: string | null;
}

/** A song or background deleted from the Church Library or a workspace, for the sweep (D34). */
export interface DeletedItem {
  /** Null for the Church Library's. */
  workspaceId: string | null;
  kind: LibraryKind;
  key: string;
  removedAt: string;
  fileNames: string[];
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
    readonly now: () => string = () => new Date().toISOString(),
  ) {}

  // ── Workspaces ───────────────────────────────────────────────────────────

  createWorkspace(name: string): { workspace: WorkspaceRow; code: string } {
    const code = enrollmentCode();
    const workspace: WorkspaceRow = {
      id: randomUUID(),
      name: name.trim().slice(0, 80),
      contentId: null,
      libraryTypes: [],
      codesEnabled: false,
      createdAt: this.now(),
    };
    if (!workspace.name) throw new Error('A workspace needs a name');
    this.db
      .prepare(
        'INSERT INTO workspace (id, name, content_id, enroll_hash, created_at) VALUES (?, ?, NULL, ?, ?)',
      )
      .run(workspace.id, workspace.name, hashSecret(normalizeCode(code)), workspace.createdAt);
    return { workspace, code };
  }

  renameWorkspace(workspaceId: string, name: string): void {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) throw new Error('A workspace needs a name');
    const result = this.db
      .prepare('UPDATE workspace SET name = ? WHERE id = ?')
      .run(trimmed, workspaceId);
    if (Number(result.changes) === 0) throw new Error(`No workspace ${workspaceId}`);
  }

  /** Whether the workspace's connection code may be used while administrators exist (D30). */
  setCodesEnabled(workspaceId: string, on: boolean): void {
    const result = this.db
      .prepare('UPDATE workspace SET codes_enabled = ? WHERE id = ?')
      .run(on ? 1 : 0, workspaceId);
    if (Number(result.changes) === 0) throw new Error(`No workspace ${workspaceId}`);
  }

  /**
   * Whether a workspace's connection code works right now: always until the instance has
   * an administrator, then only when turned on for the workspace (D30).
   */
  codesWork(workspace: WorkspaceRow): boolean {
    return !this.hasAdministrators() || workspace.codesEnabled;
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

  /**
   * Enrolls a device with a workspace's connection code. Null when the code matches no
   * workspace, or matches one whose code is off (D30); `codeRefusal` tells which.
   */
  enroll(code: string, name: string): { device: DeviceRow; token: string } | null {
    const workspace = this.workspaceByCode(code);
    if (!workspace || !this.codesWork(workspace)) return null;
    return this.addDevice(workspace.id, name, 'code', null);
  }

  /** Why `enroll` refused a code, for the message shown on the device. */
  codeRefusal(code: string): 'invalid-code' | 'codes-off' {
    const workspace = this.workspaceByCode(code);
    return workspace && !this.codesWork(workspace) ? 'codes-off' : 'invalid-code';
  }

  private workspaceByCode(code: string): WorkspaceRow | null {
    const row = this.db
      .prepare('SELECT * FROM workspace WHERE enroll_hash = ?')
      .get(hashSecret(normalizeCode(code)));
    return row ? toWorkspace(row) : null;
  }

  private addDevice(
    workspaceId: string,
    name: string,
    enrolledBy: EnrolledBy,
    approvedBy: string | null,
  ): { device: DeviceRow; token: string } {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const device: DeviceRow = {
      id: randomUUID(),
      workspaceId,
      name: name.trim().slice(0, 60) || 'Desktop',
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
      enrolledBy,
      approvedBy,
    };
    this.db
      .prepare(
        `INSERT INTO device (id, workspace_id, name, token_hash, created_at, last_seen_at, enrolled_by, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        device.id,
        device.workspaceId,
        device.name,
        hashSecret(token),
        now,
        now,
        enrolledBy,
        approvedBy,
      );
    return { device, token };
  }

  renameDevice(deviceId: string, name: string): void {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) throw new Error('A device needs a name');
    const result = this.db
      .prepare('UPDATE device SET name = ? WHERE id = ?')
      .run(trimmed, deviceId);
    if (Number(result.changes) === 0) throw new Error(`No device ${deviceId}`);
  }

  getDevice(deviceId: string): DeviceRow | null {
    const row = this.db.prepare('SELECT * FROM device WHERE id = ?').get(deviceId);
    return row ? toDevice(row) : null;
  }

  // ── Pairing (D29) ────────────────────────────────────────────────────────

  /**
   * Starts a pairing: the device shows the code and polls with the secret. Null when too
   * many requests are waiting, from `from` or in all, so nobody can fill the list an
   * administrator reads (D29).
   */
  startPairing(
    deviceName: string,
    from: string | null = null,
  ): { secret: string; code: string; expiresAt: string } | null {
    this.sweepPairing();
    const pending = (sql: string, ...params: SqlValue[]) =>
      Number(this.db.prepare(sql).get(...params)?.count ?? 0);
    if (
      pending(`SELECT count(*) AS count FROM pairing_request WHERE status = 'pending'`) >=
        PAIRING_MAX_PENDING ||
      (from !== null &&
        pending(
          `SELECT count(*) AS count FROM pairing_request WHERE status = 'pending' AND requested_from = ?`,
          from,
        ) >= PAIRING_MAX_PENDING_PER_ADDRESS)
    ) {
      return null;
    }
    const secret = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + PAIRING_TTL_MS).toISOString();
    // Codes are short, so one may clash with a pending one; try again then.
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = pairingCode();
      try {
        this.db
          .prepare(
            `INSERT INTO pairing_request (id, secret_hash, code, device_name, status, created_at, expires_at, requested_from)
             VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            hashSecret(secret),
            normalizeCode(code),
            deviceName.trim().slice(0, 60) || 'Desktop',
            now,
            expiresAt,
            from,
          );
        return { secret, code, expiresAt };
      } catch (error) {
        if (!String(error).includes('UNIQUE')) throw error;
      }
    }
    throw new Error('Could not make a pairing code');
  }

  /**
   * What the device learns when it polls. An approval is handed over until the device first
   * uses its token, or the request expires, so an answer lost on the way can be asked for
   * again; then the token is forgotten here.
   */
  pollPairing(secret: string): PairingPollResponse {
    this.sweepPairing();
    const row = this.db
      .prepare('SELECT * FROM pairing_request WHERE secret_hash = ?')
      .get(hashSecret(secret));
    if (!row) return { status: 'expired' };
    const status = text(row.status);
    if (status === 'pending') return { status: 'pending' };
    if (status === 'refused') return { status: 'refused' };
    if (status === 'approved' && row.token && row.device_id) {
      const device = this.getDevice(text(row.device_id));
      const workspace = device ? this.getWorkspace(device.workspaceId) : null;
      if (device && !device.revokedAt && workspace) {
        return {
          status: 'approved',
          deviceId: device.id,
          deviceToken: text(row.token),
          workspace: { id: workspace.id, name: workspace.name, contentId: workspace.contentId },
          allowMerge: row.allow_merge !== 0,
        };
      }
    }
    return { status: 'expired' };
  }

  /** Requests waiting for an administrator, oldest first. */
  listPairingRequests(): AdminPairingRequest[] {
    this.sweepPairing();
    return this.db
      .prepare(`SELECT * FROM pairing_request WHERE status = 'pending' ORDER BY created_at`)
      .all()
      .map((row) => ({
        code: text(row.code),
        deviceName: text(row.device_name),
        createdAt: text(row.created_at),
        expiresAt: text(row.expires_at),
      }));
  }

  /** The pending request a code names, or null. */
  getPairingRequest(code: string): AdminPairingRequest | null {
    return this.listPairingRequests().find((r) => r.code === normalizeCode(code)) ?? null;
  }

  /**
   * Approves a pending request into a workspace. The device is named as the administrator
   * chose, else as it proposed. `allowMerge` says whether it may keep its own songs and run
   * sheets alongside the workspace's when it joins. Returns the device, or null when the code
   * is not pending.
   */
  approvePairing(
    code: string,
    workspaceId: string,
    name: string | null,
    administratorId: string,
    allowMerge: boolean,
  ): DeviceRow | null {
    this.sweepPairing();
    if (!this.getWorkspace(workspaceId)) throw new Error(`No workspace ${workspaceId}`);
    return transaction(this.db, () => {
      const row = this.db
        .prepare(`SELECT * FROM pairing_request WHERE code = ? AND status = 'pending'`)
        .get(normalizeCode(code));
      if (!row) return null;
      const { device, token } = this.addDevice(
        workspaceId,
        name?.trim() || text(row.device_name),
        'pairing',
        administratorId,
      );
      this.db
        .prepare(
          `UPDATE pairing_request SET status = 'approved', device_id = ?, token = ?, decided_at = ?, decided_by = ?,
             allow_merge = ?
           WHERE id = ?`,
        )
        .run(device.id, token, this.now(), administratorId, allowMerge ? 1 : 0, text(row.id));
      return device;
    });
  }

  refusePairing(code: string, administratorId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE pairing_request SET status = 'refused', decided_at = ?, decided_by = ?
         WHERE code = ? AND status = 'pending'`,
      )
      .run(this.now(), administratorId, normalizeCode(code));
    return Number(result.changes) > 0;
  }

  /** Forgets requests past their time, and decided ones a while after they were polled. */
  private sweepPairing(): void {
    const now = this.now();
    this.db
      .prepare(
        `DELETE FROM pairing_request WHERE expires_at < ?
         OR (status <> 'pending' AND token IS NULL AND decided_at < ?)`,
      )
      .run(now, new Date(Date.parse(now) - PAIRING_TTL_MS).toISOString());
  }

  // ── Administrators and sessions (D27, D28) ───────────────────────────────

  hasAdministrators(): boolean {
    return (
      this.db.prepare('SELECT 1 FROM administrator WHERE removed_at IS NULL LIMIT 1').get() !==
      undefined
    );
  }

  listAdministrators(): AdministratorRow[] {
    return this.db
      .prepare('SELECT * FROM administrator WHERE removed_at IS NULL ORDER BY created_at')
      .all()
      .map(toAdministrator);
  }

  getAdministrator(id: string): AdministratorRow | null {
    const row = this.db.prepare('SELECT * FROM administrator WHERE id = ?').get(id);
    return row ? toAdministrator(row) : null;
  }

  /** The administrator an e-mail address names, unless removed. */
  findAdministrator(email: string): AdministratorRow | null {
    const row = this.db
      .prepare('SELECT * FROM administrator WHERE email = ? AND removed_at IS NULL')
      .get(normalizeEmail(email));
    return row ? toAdministrator(row) : null;
  }

  /**
   * Adds an administrator by e-mail address. Adding one already there changes nothing and
   * returns it. `addedBy` is the administrator doing it, or null at deployment.
   */
  addAdministrator(email: string, addedBy: string | null): AdministratorRow {
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error(`Not an e-mail address: ${email}`);
    }
    const existing = this.findAdministrator(normalized);
    if (existing) return existing;
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO administrator (id, email, added_by, created_at) VALUES (?, ?, ?, ?)')
      .run(id, normalized, addedBy, this.now());
    return this.getAdministrator(id)!;
  }

  /**
   * Adds an administrator named at deployment (`WORSHIP_Q_ADMINS`), read at every start.
   * An address that was ever an administrator is left as it is, so one removed in the app
   * stays removed; `admin add` on the command line brings it back. Returns whether added.
   */
  seedAdministrator(email: string): boolean {
    const known = this.db
      .prepare('SELECT 1 FROM administrator WHERE email = ? LIMIT 1')
      .get(normalizeEmail(email));
    if (known) return false;
    this.addAdministrator(email, null);
    return true;
  }

  /** Removes an administrator and ends their sessions. The last one cannot be removed. */
  removeAdministrator(id: string): boolean {
    return transaction(this.db, () => {
      const admins = this.listAdministrators();
      if (!admins.some((a) => a.id === id)) return false;
      if (admins.length === 1) throw new Error('The last administrator cannot be removed');
      this.db.prepare('UPDATE administrator SET removed_at = ? WHERE id = ?').run(this.now(), id);
      this.db.prepare('DELETE FROM admin_session WHERE administrator_id = ?').run(id);
      return true;
    });
  }

  /**
   * Signs an administrator in after the provider vouched for the e-mail address: binds the
   * provider's subject on the first sign-in, and starts a session. Null when the address is
   * not an administrator's, or the provider's subject does not match the one bound before.
   */
  signIn(
    email: string,
    subject: string,
    name: string | null,
  ): { admin: AdministratorRow; token: string } | null {
    const admin = this.findAdministrator(email);
    if (!admin) return null;
    if (admin.subject && admin.subject !== subject) return null;
    const now = this.now();
    this.db
      .prepare('UPDATE administrator SET subject = ?, name = ?, last_sign_in_at = ? WHERE id = ?')
      .run(subject, name ?? admin.name, now, admin.id);
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare(
        'INSERT INTO admin_session (token_hash, administrator_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
      )
      .run(hashSecret(token), admin.id, now, now);
    return { admin: this.getAdministrator(admin.id)!, token };
  }

  /** The administrator a session token belongs to; the session slides with each request. */
  authenticateSession(token: string): AdministratorRow | null {
    if (!token) return null;
    const now = this.now();
    this.db
      .prepare('DELETE FROM admin_session WHERE last_seen_at < ?')
      .run(new Date(Date.parse(now) - SESSION_IDLE_MS).toISOString());
    const row = this.db
      .prepare(
        `SELECT a.* FROM admin_session s JOIN administrator a ON a.id = s.administrator_id
         WHERE s.token_hash = ? AND a.removed_at IS NULL`,
      )
      .get(hashSecret(token));
    if (!row) return null;
    this.db
      .prepare('UPDATE admin_session SET last_seen_at = ? WHERE token_hash = ?')
      .run(now, hashSecret(token));
    return toAdministrator(row);
  }

  signOut(token: string): void {
    this.db.prepare('DELETE FROM admin_session WHERE token_hash = ?').run(hashSecret(token));
  }

  /** Remembers a sign-in under way, to check the provider's answer against. */
  putAuthState(state: string, verifier: string, nonce: string, returnTo: string): void {
    const now = this.now();
    this.db
      .prepare('DELETE FROM auth_state WHERE created_at < ?')
      .run(new Date(Date.parse(now) - AUTH_STATE_TTL_MS).toISOString());
    this.db
      .prepare(
        'INSERT INTO auth_state (state, verifier, nonce, return_to, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(state, verifier, nonce, returnTo, now);
  }

  /** Takes a sign-in under way, once; null when unknown or too old. */
  takeAuthState(state: string): { verifier: string; nonce: string; returnTo: string } | null {
    const row = this.db.prepare('SELECT * FROM auth_state WHERE state = ?').get(state);
    if (!row) return null;
    this.db.prepare('DELETE FROM auth_state WHERE state = ?').run(state);
    if (Date.parse(text(row.created_at)) < Date.parse(this.now()) - AUTH_STATE_TTL_MS) return null;
    return { verifier: text(row.verifier), nonce: text(row.nonce), returnTo: text(row.return_to) };
  }

  /** The device a token belongs to, unless it was revoked. Records that it was seen. */
  authenticate(token: string): DeviceRow | null {
    const row = this.db
      .prepare('SELECT * FROM device WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hashSecret(token));
    if (!row) return null;
    const now = this.now();
    this.db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(now, text(row.id));
    if (text(row.enrolled_by) === 'pairing') {
      // The device has its token, so the pairing request need not keep it (D29).
      this.db
        .prepare(
          'UPDATE pairing_request SET token = NULL WHERE device_id = ? AND token IS NOT NULL',
        )
        .run(text(row.id));
    }
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
   * A workspace's records of the types it manages in the Church Library go to it. Otherwise,
   * a change to a church song or background is kept as that workspace's own version of it: an
   * edit replaces the church's in that workspace, a removal hides it there.
   */
  push(
    workspaceId: string,
    deviceId: string,
    records: readonly SyncRecord[],
    protocol: number = PROTOCOL_VERSION,
  ): { remap: Record<string, string>; stored: number; central: number } {
    const remap: Record<string, string> = {};
    let stored = 0;
    let central = 0;
    const managed = this.managedTypes(workspaceId);
    transaction(this.db, () => {
      const find = this.db.prepare(
        'SELECT id, revision, updated_at, data FROM record WHERE workspace_id = ? AND kind = ? AND key = ?',
      );
      const findChurch = this.db.prepare(
        'SELECT revision, updated_at, data FROM church_record WHERE kind = ? AND key = ?',
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
        let incoming = wellFormed(received);
        const existing = find.get(workspaceId, incoming.kind, incoming.key);
        const church = isLibraryKind(incoming.kind)
          ? findChurch.get(incoming.kind, incoming.key)
          : undefined;
        // A desktop older than videos drops a song's `video` when it saves the song, as it
        // does not know the field; the stored video is kept (U20).
        // Likewise a desktop older than passages drops a song's `passage` (P3.5).
        for (const [field, since] of [
          ['video', VIDEO_PROTOCOL_VERSION],
          ['passage', PASSAGE_PROTOCOL_VERSION],
        ] as const) {
          if (protocol >= since || incoming.kind !== 'song' || field in incoming.data) continue;
          const stored = (existing ?? church)?.data;
          const kept = stored ? (JSON.parse(text(stored)) as Record<string, unknown>)[field] : null;
          if (kept) incoming = { ...incoming, data: { ...incoming.data, [field]: kept } };
        }
        if (isLibraryKind(incoming.kind)) {
          if (!existing && managed.has(libraryTypeOf(incoming.kind, incoming.data)!)) {
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

  /**
   * Stores a Church Library record. `removedBy` names who deletes it when this write is a
   * deletion by an administrator; otherwise the workspace writing it is named (D34).
   */
  private putChurch(
    record: SyncRecord,
    deviceId: string | null,
    workspaceId: string | null,
    removedBy?: string,
  ): void {
    // Which version a workspace uses is the workspace's choice, never the church's (D32).
    if ('useChurchVersion' in record.data) {
      const data = { ...record.data };
      delete data.useChurchVersion;
      record = { ...record, data };
    }
    const previous = this.db
      .prepare('SELECT data, removed_by FROM church_record WHERE kind = ? AND key = ?')
      .get(record.kind, record.key);
    const wasRemoved = previous ? removed(previous.data) : false;
    const isRemoved = typeof record.data.removedAt === 'string' && record.data.removedAt !== '';
    let removedByNow: string | null = null;
    if (isRemoved) {
      removedByNow = wasRemoved
        ? optional(previous?.removed_by)
        : (removedBy ?? (workspaceId ? `workspace:${workspaceId}` : null));
    }
    this.db
      .prepare(
        `INSERT INTO church_record (kind, key, id, revision, updated_at, seq, data, device_id, workspace_id, removed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (kind, key) DO UPDATE SET id = excluded.id, revision = excluded.revision,
           updated_at = excluded.updated_at, seq = excluded.seq, data = excluded.data,
           device_id = excluded.device_id, workspace_id = excluded.workspace_id,
           removed_by = excluded.removed_by`,
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
        removedByNow,
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
    protocol = MIN_PROTOCOL_VERSION,
  ): { records: SyncRecord[]; cursor: number; more: boolean } {
    const origins = protocol >= ORIGINS_PROTOCOL;
    // A version 3 device also receives the church's record for a song the workspace has its
    // own version of, marked as a shadow (D31). An older device would take it for the song
    // itself, so it is left out for it as before (D26).
    const rows = origins
      ? this.db
          .prepare(
            `SELECT kind, key, id, revision, updated_at, data, seq, 'workspace' AS origin, 0 AS shadow
             FROM record WHERE workspace_id = ? AND seq > ?
             UNION ALL
             SELECT c.kind, c.key, c.id, c.revision, c.updated_at, c.data, c.seq, 'church' AS origin,
               r.key IS NOT NULL AS shadow
             FROM church_record c LEFT JOIN record r
               ON r.workspace_id = ? AND r.kind = c.kind AND r.key = c.key
             WHERE c.seq > ? AND (c.kind = 'song' OR r.key IS NULL)
             ORDER BY seq LIMIT ?`,
          )
          .all(workspaceId, since, workspaceId, since, limit + 1)
      : this.db
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
    const records = page.map((row) => {
      const record = toRecord(row);
      // Text stored before broken characters were replaced on the way in is fixed here.
      const fixed = { ...record, data: wellFormed(record.data) };
      if (!origins) return fixed;
      if (Number(row.shadow) === 1) return shadowOf(fixed);
      return { ...fixed, origin: text(row.origin) === 'church' ? 'church' : 'workspace' } as const;
    });
    if (origins) records.push(...this.shadowsFor(workspaceId, page));
    return {
      records,
      cursor: page.length > 0 ? Number(page[page.length - 1]!.seq) : since,
      more: rows.length > limit,
    };
  }

  /**
   * The church's record beside each of the workspace's own songs in a page, unless the page
   * already has it. A device that never held the song, such as a computer joining now, may
   * have passed the church's record in the feed before the workspace's version reached it,
   * and the two only make sense together (D31).
   */
  private shadowsFor(workspaceId: string, page: Record<string, SqlValue>[]): SyncRecord[] {
    const inPage = new Set(
      page.filter((row) => text(row.origin) === 'church').map((row) => text(row.key)),
    );
    const keys = page
      .filter((row) => text(row.origin) === 'workspace' && text(row.kind) === 'song')
      .map((row) => text(row.key))
      .filter((key) => !inPage.has(key));
    if (keys.length === 0) return [];
    return this.db
      .prepare(
        `SELECT c.* FROM church_record c
         JOIN record r ON r.workspace_id = ? AND r.kind = c.kind AND r.key = c.key
         WHERE c.kind = 'song' AND c.key IN (SELECT value FROM json_each(?))`,
      )
      .all(workspaceId, JSON.stringify(keys))
      .map((row) => {
        const record = toRecord(row);
        return shadowOf({ ...record, data: wellFormed(record.data) });
      });
  }

  /**
   * Drops a workspace's own version of a church song or background, so the church's is the
   * workspace's again (D32, “Delete our version”). The church's record is given a new place
   * in the change feed so the workspace's other devices receive it, and is returned for the
   * device that asked. Null when the workspace has no version of its own, or the church has
   * no live record to go back to.
   */
  dropOwnVersion(workspaceId: string, kind: LibraryKind, key: string): SyncRecord | null {
    return transaction(this.db, () => {
      const own = this.db
        .prepare('SELECT 1 FROM record WHERE workspace_id = ? AND kind = ? AND key = ?')
        .get(workspaceId, kind, key);
      const church = this.db
        .prepare('SELECT * FROM church_record WHERE kind = ? AND key = ?')
        .get(kind, key);
      if (!own || !church || removed(church.data)) return null;
      this.db
        .prepare('DELETE FROM record WHERE workspace_id = ? AND kind = ? AND key = ?')
        .run(workspaceId, kind, key);
      const seq = this.nextSeq();
      this.db
        .prepare('UPDATE church_record SET seq = ? WHERE kind = ? AND key = ?')
        .run(seq, kind, key);
      const record = toRecord(church);
      return { ...record, data: wellFormed(record.data), origin: 'church' };
    });
  }

  /**
   * A workspace's records of one kind, each with the device that last stored it. Those of
   * the types it manages in the Church Library are the church's.
   */
  records(
    workspaceId: string,
    kind: SyncRecord['kind'],
  ): { record: SyncRecord; deviceId: string }[] {
    const managed = isLibraryKind(kind) ? this.managedTypes(workspaceId) : new Set();
    const own = this.db
      .prepare('SELECT * FROM record WHERE workspace_id = ? AND kind = ? ORDER BY seq')
      .all(workspaceId, kind)
      .filter((row) => !managed.has(rowType(row)));
    const church =
      managed.size > 0
        ? this.db
            .prepare('SELECT * FROM church_record WHERE kind = ? ORDER BY seq')
            .all(kind)
            .filter((row) => managed.has(rowType(row)))
        : [];
    return [...own, ...church]
      .sort((a, b) => Number(a.seq) - Number(b.seq))
      .map((row) => ({ record: toRecord(row), deviceId: text(row.device_id) }));
  }

  /** The Church Library types a workspace manages. */
  managedTypes(workspaceId: string): Set<LibraryType | null> {
    return new Set(this.getWorkspace(workspaceId)?.libraryTypes ?? []);
  }

  // ── Church Library ───────────────────────────────────────────────────────

  /** The workspace's own records of some Church Library types, each with the church's. */
  private libraryRows(workspaceId: string, types: readonly LibraryType[]) {
    const kinds = LIBRARY_KINDS.map(() => '?').join(', ');
    const findChurch = this.db.prepare('SELECT * FROM church_record WHERE kind = ? AND key = ?');
    return this.db
      .prepare(`SELECT * FROM record WHERE workspace_id = ? AND kind IN (${kinds}) ORDER BY seq`)
      .all(workspaceId, ...LIBRARY_KINDS)
      .filter((own) => types.includes(rowType(own)!))
      .map((own) => ({ own, church: findChurch.get(text(own.kind), text(own.key)) }));
  }

  /**
   * What turning on management of some Church Library types would do (D36). Types the
   * workspace manages already are left out.
   */
  libraryPlan(workspaceId: string, types: readonly LibraryType[]): LibraryPlan {
    const plan: LibraryPlan = {
      songs: [],
      slides: [],
      websites: [],
      backgrounds: [],
      overrides: [],
      hidden: [],
    };
    const managed = this.managedTypes(workspaceId);
    const adding = types.filter((type) => !managed.has(type));
    for (const { own, church } of this.libraryRows(workspaceId, adding)) {
      const kind = text(own.kind);
      if (kind === 'songRevision') continue;
      const churchLive = church && !removed(church.data);
      if (removed(own.data)) {
        if (churchLive) plan.hidden.push(titleOf(church.data));
      } else if (churchLive) {
        plan.overrides.push({
          title: titleOf(own.data),
          // The church's record changed after the workspace last edited its version, so the
          // version does not include that change.
          churchChangedSince: text(church.updated_at) > text(own.updated_at),
          usesChurchVersion: usesChurchVersion(own.data),
        });
      } else {
        plan[rowType(own)!].push(titleOf(own.data));
      }
    }
    return plan;
  }

  /** Manages every Church Library type, or none; see `setLibraryTypes`. */
  setManageLibrary(workspaceId: string, on: boolean): string[] {
    return this.setLibraryTypes(workspaceId, on ? LIBRARY_TYPES : []);
  }

  /**
   * Sets which Church Library types the workspace manages (“Manage Church Library”, per
   * type). A type turned on brings the workspace's records of it into the Church Library: its
   * own versions of church items replace them for every workspace, and church items it
   * removed reappear for it. A type turned off leaves the Church Library as it is.
   *
   * Files are not moved here: the names of the files of the records brought into the Church
   * Library are returned, for `moveFilesToChurch`.
   */
  setLibraryTypes(workspaceId: string, types: readonly LibraryType[]): string[] {
    return transaction(this.db, () => {
      const workspace = this.getWorkspace(workspaceId);
      if (!workspace) throw new Error(`No workspace ${workspaceId}`);
      const next = libraryTypes(types);
      this.db
        .prepare('UPDATE workspace SET library_types = ? WHERE id = ?')
        .run(JSON.stringify(next), workspaceId);
      const added = next.filter((type) => !workspace.libraryTypes.includes(type));
      const files = new Set<string>();
      if (added.length === 0) return [];
      const drop = this.db.prepare(
        'DELETE FROM record WHERE workspace_id = ? AND kind = ? AND key = ?',
      );
      for (const { own, church } of this.libraryRows(workspaceId, added)) {
        const record = toRecord(own);
        for (const name of fileNamesOf(record.kind, record.data)) files.add(name);
        if (church) {
          const churchRecord = toRecord(church);
          const hidden = removed(own.data) && !removed(church.data);
          // A version the workspace had set aside for the church's is dropped, not promoted
          // (D36); the church's record stands as it is.
          const keepChurch = !hidden && !removed(church.data) && usesChurchVersion(own.data);
          if (keepChurch) {
            // A new place in the feed, so the workspace's devices let go of the dropped
            // version and hold the church's as the song.
            this.db
              .prepare('UPDATE church_record SET seq = ? WHERE kind = ? AND key = ?')
              .run(this.nextSeq(), record.kind, record.key);
          } else {
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
          }
        } else {
          this.putChurch(record, optional(own.device_id), workspaceId);
        }
        drop.run(workspaceId, record.kind, record.key);
      }
      return [...files];
    });
  }

  /**
   * Takes the Church Library's live items of some types into one workspace's own library,
   * with their history: the reverse of managing them. Every other workspace sees them deleted
   * from the Church Library; a version of its own it made of one stays, as its own item. An
   * item the workspace already has a record of (its own version, or one it hid) keeps that
   * record. The church's record stays deleted, without its files, so it cannot be restored.
   *
   * With `apply` false nothing is changed: what would be taken is returned. Files are not
   * moved here; `files` names them, and `sharedFiles` those another record still uses, which
   * must be copied rather than moved (see `moveFilesToWorkspace`).
   */
  takeFromChurch(
    workspaceId: string,
    types: readonly LibraryType[],
    apply = true,
  ): {
    items: { type: LibraryType; title: string; ownVersion: boolean }[];
    files: string[];
    sharedFiles: string[];
  } {
    return transaction(this.db, () => {
      if (!this.getWorkspace(workspaceId)) throw new Error(`No workspace ${workspaceId}`);
      const taken = this.db
        .prepare(`SELECT * FROM church_record WHERE kind IN ('song', 'background') ORDER BY seq`)
        .all()
        .filter((row) => !removed(row.data) && types.includes(rowType(row)!));
      const takenKeys = new Set(taken.map((row) => `${text(row.kind)}:${text(row.key)}`));
      const findOwn = this.db.prepare(
        'SELECT 1 FROM record WHERE workspace_id = ? AND kind = ? AND key = ?',
      );
      const insert = this.db.prepare(
        `INSERT INTO record (workspace_id, kind, key, id, revision, updated_at, seq, data, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const revisionsOf = this.db.prepare(
        `SELECT * FROM church_record WHERE kind = 'songRevision'
         AND json_extract(data, '$.songId') = ? ORDER BY seq`,
      );
      const now = this.now();
      const items: { type: LibraryType; title: string; ownVersion: boolean }[] = [];
      const files = new Set<string>();
      for (const row of taken) {
        const record = toRecord(row);
        const ownVersion = findOwn.get(workspaceId, record.kind, record.key) !== undefined;
        items.push({ type: rowType(row)!, title: titleOf(row.data), ownVersion });
        for (const name of fileNamesOf(record.kind, record.data)) files.add(name);
        if (!apply) continue;
        if (!ownVersion) {
          // Newer than the church's copy every device holds, so the workspace's devices take
          // it as the workspace's own.
          insert.run(
            workspaceId,
            record.kind,
            record.key,
            record.id,
            record.revision + 1,
            now,
            this.nextSeq(),
            JSON.stringify(record.data),
            optional(row.device_id),
          );
          if (record.kind === 'song') {
            for (const revision of revisionsOf.all(record.id)) {
              const history = toRecord(revision);
              if (findOwn.get(workspaceId, history.kind, history.key)) continue;
              insert.run(
                workspaceId,
                history.kind,
                history.key,
                history.id,
                history.revision,
                history.updatedAt,
                this.nextSeq(),
                JSON.stringify(history.data),
                optional(revision.device_id),
              );
            }
          }
        }
        this.putChurch(
          {
            ...record,
            revision: record.revision + 1,
            updatedAt: now,
            data: { ...record.data, removedAt: now },
          },
          optional(row.device_id),
          optional(row.workspace_id),
          `workspace:${workspaceId}`,
        );
        // Its files go with the workspace's record, so the church's cannot come back.
        this.db
          .prepare('UPDATE church_record SET files_removed_at = ? WHERE kind = ? AND key = ?')
          .run(now, record.kind, record.key);
      }
      // Files other workspaces' records still use, or church items not taken.
      const sharedFiles = new Set<string>();
      if (files.size > 0) {
        const others = [
          ...this.db
            .prepare(
              `SELECT kind, key, data, 0 AS church FROM record
               WHERE workspace_id != ? AND kind IN ('song', 'background')`,
            )
            .all(workspaceId),
          ...this.db
            .prepare(
              `SELECT kind, key, data, 1 AS church FROM church_record
               WHERE kind IN ('song', 'background')`,
            )
            .all(),
        ];
        for (const row of others) {
          if (Number(row.church) === 1 && takenKeys.has(`${text(row.kind)}:${text(row.key)}`)) {
            continue;
          }
          const data = JSON.parse(text(row.data)) as Record<string, unknown>;
          for (const name of fileNamesOf(text(row.kind), data)) {
            if (files.has(name)) sharedFiles.add(name);
          }
        }
      }
      return { items, files: [...files], sharedFiles: [...sharedFiles] };
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

  // ── The Church Library for administrators (D34, D37) ─────────────────────

  /** Whether the Church Library has no item of any type, deleted ones aside. */
  churchLibraryEmpty(): boolean {
    return this.db
      .prepare('SELECT data FROM church_record')
      .all()
      .every((row) => removed(row.data));
  }

  /** The Church Library's songs or backgrounds, deleted ones included, newest change first. */
  listChurch(kind: LibraryKind): AdminLibraryItem[] {
    const names = new Map(this.listWorkspaces().map((w) => [w.id, w.name]));
    /** Who deleted an item, for the Deleted list (D34); null when not known. */
    const deletedBy = (by: string | null): AdminLibraryItem['deletedBy'] => {
      const [type, id] = by ? [by.slice(0, by.indexOf(':')), by.slice(by.indexOf(':') + 1)] : [];
      if (type === 'administrator' && id) {
        const admin = this.getAdministrator(id);
        return admin ? { administrator: admin.email } : null;
      }
      if (type === 'workspace' && id && names.has(id)) {
        return { workspace: { id, name: names.get(id)! } };
      }
      return null;
    };
    return this.db
      .prepare('SELECT * FROM church_record WHERE kind = ? ORDER BY updated_at DESC')
      .all(kind)
      .map((row) => {
        const from = optional(row.workspace_id);
        const item = libraryItem(kind, row);
        return {
          ...item,
          fromWorkspace: from && names.has(from) ? { id: from, name: names.get(from)! } : null,
          deletedBy: item.removedAt ? deletedBy(optional(row.removed_by)) : null,
        };
      });
  }

  /**
   * How one workspace's songs or backgrounds differ from the Church Library, newest change
   * first: its own items, its versions of church items, and the church items it hid. Empty
   * for a workspace that manages the Church Library, whose items are the church's.
   */
  listWorkspaceLibrary(workspaceId: string, kind: LibraryKind): AdminLibraryItem[] {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) return [];
    const managed = new Set<LibraryType | null>(workspace.libraryTypes);
    const self = { id: workspace.id, name: workspace.name };
    const findChurch = this.db.prepare('SELECT * FROM church_record WHERE kind = ? AND key = ?');
    const items: AdminLibraryItem[] = [];
    for (const own of this.db
      .prepare('SELECT * FROM record WHERE workspace_id = ? AND kind = ?')
      .all(workspaceId, kind)) {
      // A passage lives only in its run sheet, never in a library (B7).
      if (rowType(own) === null || managed.has(rowType(own))) continue;
      const church = findChurch.get(kind, text(own.key));
      const churchLive = church !== undefined && !removed(church.data);
      if (churchLive && removed(own.data)) {
        // Shown as the church has it, which is what the workspace no longer sees.
        items.push({
          ...libraryItem(kind, church),
          id: text(own.id),
          updatedAt: text(own.updated_at),
          fromWorkspace: self,
          deletedBy: null,
          change: { type: 'hidden', churchId: text(church.id) },
        });
        continue;
      }
      const item = libraryItem(kind, own);
      items.push({
        ...item,
        fromWorkspace: self,
        deletedBy: item.removedAt ? { workspace: self } : null,
        change: churchLive
          ? {
              type: 'override',
              churchId: text(church.id),
              churchChangedSince: text(church.updated_at) > text(own.updated_at),
              usesChurchVersion: usesChurchVersion(own.data),
            }
          : { type: 'own' },
      });
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** The dates a workspace has run sheets for, for the admin app's view-only calendar. */
  runSheetDays(workspaceId: string): AdminRunSheetDays | null {
    if (!this.getWorkspace(workspaceId)) return null;
    const dates: AdminRunSheetDays['dates'] = [];
    const liveId = this.getLive(workspaceId)?.snapshot.state.runSheetId ?? null;
    let liveDate: string | null = null;
    for (const row of this.db
      .prepare(`SELECT id, data FROM record WHERE workspace_id = ? AND kind = 'runSheet'`)
      .all(workspaceId)) {
      const data = JSON.parse(text(row.data)) as { date?: unknown; items?: unknown };
      if (typeof data.date !== 'string') continue;
      if (text(row.id) === liveId) liveDate = data.date;
      const items = Array.isArray(data.items) ? data.items.length : 0;
      if (items > 0) dates.push({ date: data.date, items });
    }
    const workspace = this.db
      .prepare(`SELECT data FROM record WHERE workspace_id = ? AND kind = 'workspace'`)
      .get(workspaceId);
    const meeting = workspace
      ? (JSON.parse(text(workspace.data)) as { meetingDays?: unknown }).meetingDays
      : null;
    return {
      dates: dates.sort((a, b) => a.date.localeCompare(b.date)),
      meetingDays: Array.isArray(meeting)
        ? meeting.filter((d): d is number => Number.isInteger(d))
        : [0],
      liveDate,
    };
  }

  /** One date's run sheet, its items named from the songs they point to; null when none. */
  runSheet(workspaceId: string, date: string): AdminRunSheet | null {
    const row = this.db
      .prepare(`SELECT data FROM record WHERE workspace_id = ? AND kind = 'runSheet' AND key = ?`)
      .get(workspaceId, date);
    if (!row) return null;
    const data = JSON.parse(text(row.data)) as { items?: unknown };
    const entries = Array.isArray(data.items)
      ? (data.items as { id?: unknown; songId?: unknown }[])
      : [];
    const own = this.db.prepare(
      `SELECT data FROM record WHERE workspace_id = ? AND kind = 'song' AND id = ?`,
    );
    const church = this.db.prepare(`SELECT data FROM church_record WHERE kind = 'song' AND id = ?`);
    return {
      date,
      items: entries.map((entry) => {
        const songId = String(entry.songId ?? '');
        const song = own.get(workspaceId, songId) ?? church.get(songId);
        const fields = song
          ? (JSON.parse(text(song.data)) as Parameters<typeof songBadge>[0] & { title?: unknown })
          : null;
        return {
          id: String(entry.id ?? songId),
          title: fields ? String(fields.title ?? '') : '',
          badge: fields ? songBadge(fields) : null,
          removed: !song || removed(song.data),
        };
      }),
    };
  }

  /** What a workspace's own song or background shows, deleted ones included. */
  workspaceContent(workspaceId: string, kind: LibraryKind, id: string): AdminLibraryContent | null {
    const row = this.db
      .prepare('SELECT data FROM record WHERE workspace_id = ? AND kind = ? AND id = ?')
      .get(workspaceId, kind, id);
    return row ? contentOf(kind, row) : null;
  }

  /** What a Church Library item shows, deleted ones included; null when there is none. */
  churchContent(kind: LibraryKind, id: string): AdminLibraryContent | null {
    const row = this.db
      .prepare('SELECT data FROM church_record WHERE kind = ? AND id = ?')
      .get(kind, id);
    return row ? contentOf(kind, row) : null;
  }

  /**
   * Deletes a song or background from the Church Library, recoverably: the record stays with
   * `removedAt` set, as a managing workspace's removal leaves it (D34). Workspace versions of a
   * deleted song are untouched and so become those workspaces' own (spec §5).
   */
  deleteChurch(kind: LibraryKind, key: string, administratorId: string | null = null): boolean {
    const row = this.db
      .prepare('SELECT * FROM church_record WHERE kind = ? AND key = ?')
      .get(kind, key);
    if (!row || removed(row.data)) return false;
    const record = toRecord(row);
    const now = this.now();
    this.putChurch(
      {
        ...record,
        revision: record.revision + 1,
        updatedAt: now,
        data: { ...record.data, removedAt: now },
      },
      optional(row.device_id),
      optional(row.workspace_id),
      administratorId ? `administrator:${administratorId}` : undefined,
    );
    return true;
  }

  /**
   * Brings a deleted song or background back to every workspace, unless the retention sweep
   * has already removed its files (D34). Versions made independent by the deletion stay so.
   */
  restoreChurch(kind: LibraryKind, key: string): 'restored' | 'files-removed' | 'not-deleted' {
    const row = this.db
      .prepare('SELECT * FROM church_record WHERE kind = ? AND key = ?')
      .get(kind, key);
    if (!row || !removed(row.data)) return 'not-deleted';
    if (row.files_removed_at) return 'files-removed';
    const record = toRecord(row);
    this.putChurch(
      {
        ...record,
        revision: record.revision + 1,
        updatedAt: this.now(),
        data: { ...record.data, removedAt: null },
      },
      optional(row.device_id),
      optional(row.workspace_id),
    );
    return 'restored';
  }

  /**
   * Which workspaces use a Church Library item (D37): for a song, the run sheets that list
   * it; for a background, the workspaces whose songs or output settings choose it.
   */
  churchUsage(kind: LibraryKind, id: string): AdminLibraryUsage {
    const names = new Map(this.listWorkspaces().map((w) => [w.id, w.name]));
    const found = new Map<string, Set<string>>();
    const note = (workspaceId: string, date?: string) => {
      if (!names.has(workspaceId)) return;
      const dates = found.get(workspaceId) ?? new Set<string>();
      if (date) dates.add(date);
      found.set(workspaceId, dates);
    };
    if (kind === 'song') {
      for (const row of this.db.prepare(`SELECT * FROM record WHERE kind = 'runSheet'`).all()) {
        const data = JSON.parse(text(row.data)) as { date?: unknown; items?: unknown };
        const items = Array.isArray(data.items) ? (data.items as { songId?: unknown }[]) : [];
        if (items.some((item) => item.songId === id)) {
          note(text(row.workspace_id), typeof data.date === 'string' ? data.date : undefined);
        }
      }
    } else {
      for (const row of this.db
        .prepare(`SELECT * FROM record WHERE kind = 'song' OR kind = 'setting'`)
        .all()) {
        const data = JSON.parse(text(row.data)) as Record<string, unknown>;
        const background = data.background as { assetId?: unknown } | null | undefined;
        const value = data.value as { backgroundAssetId?: unknown } | null | undefined;
        if (background?.assetId === id || value?.backgroundAssetId === id) {
          note(text(row.workspace_id));
        }
      }
      for (const row of this.db.prepare(`SELECT * FROM church_record WHERE kind = 'song'`).all()) {
        const data = JSON.parse(text(row.data)) as { background?: { assetId?: unknown } | null };
        if (data.background?.assetId === id) {
          // A church song's background is used wherever the song is; name every workspace.
          for (const workspaceId of names.keys()) note(workspaceId);
        }
      }
    }
    return {
      workspaces: [...found.entries()]
        .map(([workspaceId, dates]) => ({
          id: workspaceId,
          name: names.get(workspaceId)!,
          dates: [...dates].sort(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * Songs and backgrounds deleted before `before` whose files are still kept: the Church
   * Library's, and workspaces' own (a workspace's hidden church item is not a deletion and
   * has no files of its own). For the retention sweep (D34).
   */
  deletedItems(before: string): DeletedItem[] {
    const items: DeletedItem[] = [];
    const collect = (row: Record<string, SqlValue>, workspaceId: string | null) => {
      const data = JSON.parse(text(row.data)) as Record<string, unknown>;
      const removedAt = typeof data.removedAt === 'string' ? data.removedAt : null;
      if (!removedAt || removedAt >= before) return;
      const fileNames = fileNamesOf(text(row.kind), data);
      if (fileNames.length === 0) return;
      items.push({
        workspaceId,
        kind: text(row.kind) as LibraryKind,
        key: text(row.key),
        removedAt,
        fileNames,
      });
    };
    for (const row of this.db
      .prepare(
        `SELECT * FROM church_record WHERE kind IN ('song', 'background') AND files_removed_at IS NULL`,
      )
      .all()) {
      collect(row, null);
    }
    for (const row of this.db
      .prepare(
        `SELECT r.* FROM record r WHERE r.kind IN ('song', 'background') AND r.files_removed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM church_record c WHERE c.kind = r.kind AND c.key = r.key)`,
      )
      .all()) {
      collect(row, text(row.workspace_id));
    }
    return items;
  }

  /**
   * File names still in use by songs and backgrounds, the church's and every workspace's:
   * those not deleted, and those deleted at or after `before`, whose own retention has not
   * run out. A workspace's version of a church deck shares the church's images, and must
   * keep them after the church's is deleted (spec §5, D34).
   */
  filesInUse(before: string): Set<string> {
    const names = new Set<string>();
    for (const table of ['church_record', 'record']) {
      for (const row of this.db
        .prepare(`SELECT kind, data FROM ${table} WHERE kind IN ('song', 'background')`)
        .all()) {
        const data = JSON.parse(text(row.data)) as Record<string, unknown>;
        const removedAt =
          typeof data.removedAt === 'string' && data.removedAt ? data.removedAt : null;
        if (removedAt && removedAt < before) continue;
        for (const name of fileNamesOf(text(row.kind), data)) names.add(name);
      }
    }
    return names;
  }

  /** Records that an item's files are gone, so it is not swept again and cannot be restored. */
  markFilesRemoved(item: Pick<DeletedItem, 'workspaceId' | 'kind' | 'key'>): void {
    if (item.workspaceId === null) {
      this.db
        .prepare('UPDATE church_record SET files_removed_at = ? WHERE kind = ? AND key = ?')
        .run(this.now(), item.kind, item.key);
    } else {
      this.db
        .prepare(
          'UPDATE record SET files_removed_at = ? WHERE workspace_id = ? AND kind = ? AND key = ?',
        )
        .run(this.now(), item.workspaceId, item.kind, item.key);
    }
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
    const backgroundFile = assetId ? this.backgroundFile(workspaceId, assetId) : null;
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

  /** The file of a background the workspace can use, its own or the church's. */
  backgroundFile(
    workspaceId: string,
    assetId: string,
  ): NonNullable<OutputView['look']>['backgroundFile'] {
    const asset = [
      ...this.records(workspaceId, 'background'),
      ...this.churchRecords('background'),
    ].find(({ record }) => record.id === assetId && !record.data.removedAt);
    if (!asset) return null;
    return {
      kind: asset.record.data.kind === 'video' ? 'video' : 'image',
      fileName: String(asset.record.data.fileName),
    };
  }

  /** Every record of a kind across the instance: each workspace's own and the church's. */
  allRecords(kind: SyncRecord['kind']): { record: SyncRecord; workspaceId: string | null }[] {
    return [
      ...this.db
        .prepare('SELECT * FROM record WHERE kind = ? ORDER BY seq')
        .all(kind)
        .map((row) => ({ record: toRecord(row), workspaceId: text(row.workspace_id) })),
      ...this.db
        .prepare('SELECT * FROM church_record WHERE kind = ? ORDER BY seq')
        .all(kind)
        .map((row) => ({ record: toRecord(row), workspaceId: null })),
    ];
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
    libraryTypes: parseLibraryTypes(row.library_types),
    codesEnabled: Number(row.codes_enabled ?? 0) === 1,
    createdAt: text(row.created_at),
  };
}

function parseLibraryTypes(value: SqlValue | undefined): LibraryType[] {
  try {
    const parsed: unknown = JSON.parse(text(value) || '[]');
    return Array.isArray(parsed) ? libraryTypes(parsed) : [];
  } catch {
    return [];
  }
}

function toAdministrator(row: Record<string, SqlValue>): AdministratorRow {
  return {
    id: text(row.id),
    email: text(row.email),
    name: optional(row.name),
    subject: optional(row.subject),
    addedBy: optional(row.added_by),
    createdAt: text(row.created_at),
    lastSignInAt: optional(row.last_sign_in_at),
    removedAt: optional(row.removed_at),
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Eight characters from the connection-code alphabet, shown as `ABCD-2345` (D29). */
export function pairingCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Shows a stored pairing code as the device shows it. */
export function formatPairingCode(code: string): string {
  const plain = normalizeCode(code);
  return plain.length === 8 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : plain;
}

/** The church's record of a song the workspace has its own version of, as a shadow (D31). */
function shadowOf(record: SyncRecord): SyncRecord {
  return { ...record, origin: 'church', shadow: true };
}

const usesChurchVersion = (data: SqlValue | undefined) =>
  (JSON.parse(text(data)) as { useChurchVersion?: unknown }).useChurchVersion === true;

/** The files a deleted song or background leaves behind: its own, never another's. */
export function fileNamesOf(kind: string, data: Record<string, unknown>): string[] {
  if (kind === 'background') {
    return typeof data.fileName === 'string' && data.fileName ? [data.fileName] : [];
  }
  if (kind !== 'song') return [];
  const names = new Set<string>();
  // A video song's file (U14).
  const video = data.video as { file?: unknown } | null | undefined;
  if (typeof video?.file === 'string' && video.file) names.add(video.file);
  const deck = data.deck as { pages?: { image?: unknown; thumbnail?: unknown }[] } | null;
  if (!deck || !Array.isArray(deck.pages)) return [...names];
  for (const page of deck.pages) {
    if (typeof page.image === 'string') names.add(page.image);
    if (typeof page.thumbnail === 'string') names.add(page.thumbnail);
  }
  return [...names];
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

/** Which Church Library type a stored record is. */
const rowType = (row: Record<string, SqlValue>) =>
  libraryTypeOf(text(row.kind), JSON.parse(text(row.data)) as Record<string, unknown>);

const isLibraryKind = (kind: string) => (LIBRARY_KINDS as readonly string[]).includes(kind);
const removed = (data: SqlValue | undefined) =>
  (JSON.parse(text(data)) as { removedAt?: unknown }).removedAt != null;
/** What a song or background record shows, for the admin app's preview. */
function contentOf(kind: LibraryKind, row: Record<string, SqlValue>): AdminLibraryContent {
  const data = JSON.parse(text(row.data)) as Record<string, unknown>;
  const type = libraryType(kind, data);
  if (type === 'image' || type === 'video') {
    return { type, fileName: String(data.fileName ?? '') };
  }
  if (type === 'videoItem') {
    const video = data.video as { file?: unknown } | null | undefined;
    return { type, fileName: typeof video?.file === 'string' ? video.file : '' };
  }
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  const deck = data.deck as
    { width?: unknown; height?: unknown; pages?: Record<string, unknown>[] } | null | undefined;
  const website = data.website as { url?: unknown } | null | undefined;
  return {
    type,
    lyrics: str(data.lyrics),
    author: str(data.author),
    copyright: str(data.copyright),
    ccli: typeof data.ccli === 'string' ? data.ccli : null,
    year: typeof data.year === 'number' ? data.year : null,
    deck:
      (type === 'deck' || type === 'imageItem') && deck
        ? {
            width: Number(deck.width) || 16,
            height: Number(deck.height) || 9,
            pages: (Array.isArray(deck.pages) ? deck.pages : []).map((page) => ({
              image: str(page.image),
              thumbnail: typeof page.thumbnail === 'string' ? page.thumbnail : null,
              slide: Number(page.slide) || 1,
              step: Number(page.step) || 0,
            })),
          }
        : null,
    websiteUrl: type === 'website' && typeof website?.url === 'string' ? website.url : null,
  };
}

/** A song or background record as the admin app lists it, before who it came from. */
function libraryItem(
  kind: LibraryKind,
  row: Record<string, SqlValue>,
): Omit<AdminLibraryItem, 'fromWorkspace' | 'deletedBy'> {
  const data = JSON.parse(text(row.data)) as Record<string, unknown>;
  const deck = data.deck as { source?: unknown } | null | undefined;
  const video = data.video as { source?: unknown } | null | undefined;
  return {
    kind,
    id: text(row.id),
    title: titleOf(row.data),
    revision: Number(row.revision),
    updatedAt: text(row.updated_at),
    removedAt: typeof data.removedAt === 'string' ? data.removedAt : null,
    filesRemovedAt: optional(row.files_removed_at),
    fileName:
      kind === 'background'
        ? String(data.fileName ?? '') || null
        : deck && typeof deck.source === 'string'
          ? deck.source
          : video && typeof video.source === 'string'
            ? video.source
            : null,
    type: libraryType(kind, data),
  };
}

/** A song by what it shows, or a background by its file. */
function libraryType(kind: LibraryKind, data: Record<string, unknown>): AdminLibraryItem['type'] {
  if (kind === 'background') return data.kind === 'video' ? 'video' : 'image';
  if (data.video) return 'videoItem';
  if (data.deck) return (data.deck as { kind?: unknown }).kind === 'image' ? 'imageItem' : 'deck';
  if (data.website) return 'website';
  return 'lyrics';
}

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
    enrolledBy: text(row.enrolled_by) === 'pairing' ? 'pairing' : 'code',
    approvedBy: optional(row.approved_by),
  };
}

/** A run sheet created when a device opened its date, with nothing ever added. */
function untouchedRunSheet(record: SyncRecord): boolean {
  const items = record.data.items;
  return record.revision <= 1 && (!Array.isArray(items) || items.length === 0);
}
