import type { SqlDriver, Statement } from './driver';

export interface Migration {
  /** Schema version this migration produces; versions are consecutive from 1. */
  version: number;
  statements: string[];
}

/**
 * Every record carries an identifier generated on the device and a revision counter
 * (decision D3), so local data can move into a church instance later. Removal of songs and
 * backgrounds is recorded with `removed_at` rather than by deleting the row.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE workspace (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL,
        meeting_days TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE song (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id),
        title TEXT NOT NULL,
        lyrics TEXT NOT NULL,
        line_ids TEXT NOT NULL,
        author TEXT NOT NULL,
        copyright TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        removed_at TEXT
      )`,
      `CREATE INDEX song_workspace ON song(workspace_id, removed_at)`,
      `CREATE TABLE song_revision (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL REFERENCES song(id),
        revision INTEGER NOT NULL,
        title TEXT NOT NULL,
        lyrics TEXT NOT NULL,
        line_ids TEXT NOT NULL,
        author TEXT NOT NULL,
        copyright TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (song_id, revision)
      )`,
      `CREATE TABLE run_sheet (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id),
        date TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, date)
      )`,
      `CREATE TABLE run_sheet_item (
        id TEXT PRIMARY KEY,
        run_sheet_id TEXT NOT NULL REFERENCES run_sheet(id),
        song_id TEXT NOT NULL REFERENCES song(id),
        position INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX run_sheet_item_sheet ON run_sheet_item(run_sheet_id, position)`,
      `CREATE INDEX run_sheet_item_song ON run_sheet_item(song_id)`,
      `CREATE TABLE setting (
        workspace_id TEXT NOT NULL REFERENCES workspace(id),
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, key)
      )`,
      `CREATE TABLE background_asset (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id),
        kind TEXT NOT NULL,
        file_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        removed_at TEXT
      )`,
      `CREATE TABLE output_profile (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id),
        kind TEXT NOT NULL,
        font_family TEXT,
        scale REAL NOT NULL,
        background_color TEXT NOT NULL,
        background_asset_id TEXT,
        target TEXT,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, kind)
      )`,
      `CREATE TABLE live_state (
        workspace_id TEXT PRIMARY KEY REFERENCES workspace(id),
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    statements: [`ALTER TABLE output_profile ADD COLUMN hide_cursor INTEGER NOT NULL DEFAULT 0`],
  },
  {
    version: 3,
    statements: [
      `ALTER TABLE song ADD COLUMN ccli TEXT`,
      `ALTER TABLE song ADD COLUMN year INTEGER`,
      `ALTER TABLE song_revision ADD COLUMN ccli TEXT`,
      `ALTER TABLE song_revision ADD COLUMN year INTEGER`,
      // Search keys derived from each song; every device builds its own, so they are not
      // part of revisions. `version` is the search version that produced the row.
      `CREATE TABLE song_search (
        song_id TEXT PRIMARY KEY REFERENCES song(id),
        version INTEGER NOT NULL,
        title_text TEXT NOT NULL,
        title_pinyin TEXT NOT NULL,
        title_initials TEXT NOT NULL,
        lyrics_text TEXT NOT NULL,
        lyrics_pinyin TEXT NOT NULL,
        lyrics_initials TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 4,
    statements: [
      // A song's own background; no color means the slideshow background is used.
      `ALTER TABLE song ADD COLUMN background_color TEXT`,
      `ALTER TABLE song ADD COLUMN background_asset_id TEXT`,
      `ALTER TABLE song_revision ADD COLUMN background_color TEXT`,
      `ALTER TABLE song_revision ADD COLUMN background_asset_id TEXT`,
    ],
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export class NewerDatabaseError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`Database schema ${found} is newer than this app supports (${supported}).`);
  }
}

export async function schemaVersion(db: SqlDriver): Promise<number> {
  const rows = await db.select<{ user_version: number }>('PRAGMA user_version');
  return rows[0]?.user_version ?? 0;
}

/**
 * Brings a database up to the latest schema. Each migration and its version bump are
 * applied together, so an interrupted upgrade resumes where it stopped.
 */
export async function migrate(
  db: SqlDriver,
  migrations: Migration[] = MIGRATIONS,
): Promise<number> {
  const current = await schemaVersion(db);
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  if (current > latest) throw new NewerDatabaseError(current, latest);
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    const statements: Statement[] = migration.statements.map((sql) => ({ sql }));
    statements.push({ sql: `PRAGMA user_version = ${migration.version}` });
    await db.batch(statements);
  }
  return latest;
}
