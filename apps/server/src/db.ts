/** The instance database: one SQLite file in the data directory. */
import { createRequire } from 'node:module';

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface Database {
  prepare(sql: string): {
    all(...params: SqlValue[]): Record<string, SqlValue>[];
    get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
    run(...params: SqlValue[]): { changes: number | bigint };
  };
  exec(sql: string): void;
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => Database;
};

const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE workspace (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content_id TEXT UNIQUE,
      enroll_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE device (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    )`,
    // One row per synchronized record; `seq` orders the change feed.
    `CREATE TABLE record (
      workspace_id TEXT NOT NULL REFERENCES workspace(id),
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      device_id TEXT,
      PRIMARY KEY (workspace_id, kind, key)
    )`,
    `CREATE INDEX record_feed ON record(workspace_id, seq)`,
    `CREATE TABLE counter (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
    `INSERT INTO counter (name, value) VALUES ('seq', 0)`,
    `CREATE TABLE church_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE backup (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id),
      device_id TEXT NOT NULL,
      file TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`,
  ],
  [
    // A workspace that manages the Church Library keeps its songs and backgrounds there.
    `ALTER TABLE workspace ADD COLUMN manage_library INTEGER NOT NULL DEFAULT 0`,
    // The Church Library: songs, their history and backgrounds every workspace sees. A
    // workspace record with the same kind and key overrides one of these in that workspace.
    // `workspace_id` is where the record came from. Shares `seq` with `record`.
    `CREATE TABLE church_record (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      device_id TEXT,
      workspace_id TEXT,
      PRIMARY KEY (kind, key)
    )`,
    `CREATE INDEX church_record_feed ON church_record(seq)`,
  ],
  [
    // Phase 2. The coordinator's latest live snapshot per workspace, kept until the live
    // state expires, so another device can carry on from it (decisions D17, D18). `grants`
    // is the workspace's remote-control grant list (D25), mirrored with it.
    `CREATE TABLE live_snapshot (
      workspace_id TEXT PRIMARY KEY REFERENCES workspace(id),
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      grants TEXT NOT NULL DEFAULT '[]',
      device_id TEXT,
      updated_at TEXT NOT NULL
    )`,
    // Browser output links (decision D22): the token is in the link and only its hash here.
    `CREATE TABLE output_link (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id),
      kind TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    )`,
  ],
  [
    // Phase 3. Connection codes work for a workspace only until the instance has an
    // administrator, unless turned on again for it (decision D30).
    `ALTER TABLE workspace ADD COLUMN codes_enabled INTEGER NOT NULL DEFAULT 0`,
    // How a device joined, and which administrator approved it (D29).
    `ALTER TABLE device ADD COLUMN enrolled_by TEXT NOT NULL DEFAULT 'code'`,
    `ALTER TABLE device ADD COLUMN approved_by TEXT`,
    // Set once the retention sweep removed a deleted item's files (D34).
    `ALTER TABLE record ADD COLUMN files_removed_at TEXT`,
    `ALTER TABLE church_record ADD COLUMN files_removed_at TEXT`,
    // Administrators are an allowlist of e-mail addresses, bound to the provider's subject
    // on first sign-in (D28). A removed administrator keeps its row for attribution.
    `CREATE TABLE administrator (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      subject TEXT,
      name TEXT,
      added_by TEXT,
      created_at TEXT NOT NULL,
      last_sign_in_at TEXT,
      removed_at TEXT
    )`,
    `CREATE UNIQUE INDEX administrator_email ON administrator(email) WHERE removed_at IS NULL`,
    // Sign-in sessions; only the hash of the cookie's token is kept (D27).
    `CREATE TABLE admin_session (
      token_hash TEXT PRIMARY KEY,
      administrator_id TEXT NOT NULL REFERENCES administrator(id),
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
    // A sign-in under way: the state the provider sends back, and what it must match.
    `CREATE TABLE auth_state (
      state TEXT PRIMARY KEY,
      verifier TEXT NOT NULL,
      nonce TEXT NOT NULL,
      return_to TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    // A device waiting for an administrator (D29). The device token is kept here only until
    // the device first uses it, or the request expires.
    `CREATE TABLE pairing_request (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      device_name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      device_id TEXT,
      token TEXT,
      decided_at TEXT,
      decided_by TEXT
    )`,
  ],
  [
    // Who deleted a Church Library item: `administrator:<id>` or `workspace:<id>` (D34).
    `ALTER TABLE church_record ADD COLUMN removed_by TEXT`,
    // Where a pairing request came from, so one address cannot fill the pending list (D29).
    `ALTER TABLE pairing_request ADD COLUMN requested_from TEXT`,
  ],
  [
    // What a workspace manages in the Church Library, each type on its own: a JSON list of
    // `songs`, `backgrounds`, `slides` and `websites`. A workspace that managed the whole
    // Church Library manages every type. `manage_library` is no longer read.
    `ALTER TABLE workspace ADD COLUMN library_types TEXT NOT NULL DEFAULT '[]'`,
    `UPDATE workspace SET library_types = '["songs","backgrounds","slides","websites"]'
     WHERE manage_library = 1`,
  ],
  [
    // Whether the approving administrator let the device merge its own content into the
    // workspace when it joins (1) or only take the workspace's copy (0) (D29).
    `ALTER TABLE pairing_request ADD COLUMN allow_merge INTEGER`,
  ],
  [
    // Service records (R9). One row per recording of a live audio broadcast; its file is
    // `recordings/<workspace>/<id>.<webm or m4a>`, the chunks appended in order. `bytes` and
    // `next_seq` say what the file holds for certain: anything past `bytes` is a chunk that
    // was being written when the server stopped, and is cut off.
    `CREATE TABLE audio_recording (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id),
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      input_name TEXT NOT NULL,
      container TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      cut_short INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0,
      next_seq INTEGER NOT NULL DEFAULT 0,
      last_chunk_at TEXT,
      clock_offset_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX audio_recording_time ON audio_recording(workspace_id, started_at)`,
    // The presentation log (R13–R19): one row per unbroken showing of one piece, as the
    // coordinator uploaded it. `part` and `background` are JSON. `cursor` is the server's
    // order of arrival, renewed on every change, which the local API's readers follow.
    `CREATE TABLE presentation_log (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace(id),
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      run_sheet_id TEXT NOT NULL,
      date TEXT NOT NULL,
      item_id TEXT NOT NULL,
      previous INTEGER NOT NULL,
      song_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      revision_id TEXT,
      version TEXT,
      part TEXT NOT NULL,
      background TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      closed_by_server INTEGER NOT NULL DEFAULT 0,
      clock_offset_ms INTEGER NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL,
      cursor INTEGER NOT NULL
    )`,
    `CREATE INDEX presentation_log_time ON presentation_log(workspace_id, started_at)`,
    `CREATE INDEX presentation_log_cursor ON presentation_log(cursor)`,
    `INSERT OR IGNORE INTO counter (name, value) VALUES ('log', 0)`,
  ],
  [
    // Uploads stored once (media U28). One row per stored video, slide deck or image: the
    // SHA-256 of the file as uploaded, and what the upload answered. `ref` is the video's
    // file name, or `deck-<id>`. A row is only a hint: the files are checked on every match.
    `CREATE TABLE stored_upload (
      ref TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      hash TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX stored_upload_hash ON stored_upload(hash, kind)`,
  ],
];

export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  MIGRATIONS.forEach((statements, index) => {
    if (index < version) return;
    transaction(db, () => {
      for (const sql of statements) db.exec(sql);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    });
  });
  return db;
}

export function transaction<T>(db: Database, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
