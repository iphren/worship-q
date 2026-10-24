/**
 * Reading and applying synchronized records (see `SyncRecord` in the protocol).
 *
 * Records carry their device-generated identifiers and revisions (decision D3). Both the
 * instance and every device keep a record only when it wins under `syncWins`, so all of
 * them settle on the same content. Run sheets are one per date: two devices that each
 * created one for the same date agree on the instance's identifier, and the device's
 * own is replaced by it.
 */
import {
  DeckSchema,
  syncWins,
  type Deck,
  type SyncKind,
  type SyncRecord,
} from '@worship-q/protocol';
import type { SqlValue, Statement } from './driver';
import type { Store } from './store';

type Row = Record<string, SqlValue>;

/** The order records are applied in, so that what a record refers to exists first. */
const KIND_ORDER: SyncKind[] = [
  'workspace',
  'background',
  'song',
  'songRevision',
  'runSheet',
  'setting',
];

/** This device's connection to a church instance. */
export interface SyncState {
  server: string | null;
  deviceId: string | null;
  deviceToken: string | null;
  /** The instance's own identifier for the workspace. */
  workspaceServerId: string | null;
  workspaceName: string | null;
  /** When the local workspace became part of the church workspace; null until then. */
  joinedAt: string | null;
  /** Position in the instance's change feed reached by the last pull. */
  cursor: number;
  /** Local changes up to this instant have been pushed. */
  pushedThrough: string | null;
  lastSyncAt: string | null;
  lastBackupAt: string | null;
  lastError: string | null;
}

export const EMPTY_SYNC_STATE: SyncState = {
  server: null,
  deviceId: null,
  deviceToken: null,
  workspaceServerId: null,
  workspaceName: null,
  joinedAt: null,
  cursor: 0,
  pushedThrough: null,
  lastSyncAt: null,
  lastBackupAt: null,
  lastError: null,
};

export interface AppliedChanges {
  /** Songs whose content changed. */
  songs: Set<string>;
  /** Run sheets whose items changed, by their identifier after any remapping. */
  runSheets: Set<string>;
  /** Local run sheet identifiers replaced by the instance's: local → instance. */
  remapped: Map<string, string>;
  /** Background files this device does not have yet. */
  backgroundFiles: string[];
  workspace: boolean;
  settings: boolean;
}

const text = (value: SqlValue | undefined) => String(value ?? '');
const optional = (value: SqlValue | undefined) => (value == null ? null : String(value));
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown) => (typeof value === 'string' ? value : null);
const numOrNull = (value: unknown) => (typeof value === 'number' ? value : null);
const parse = (value: SqlValue | undefined): unknown => {
  try {
    return value == null ? null : JSON.parse(String(value));
  } catch {
    return null;
  }
};

export class SyncStore {
  constructor(private readonly store: Store) {}

  private get db() {
    return this.store.db;
  }

  // ── Connection state ─────────────────────────────────────────────────────

  async getState(): Promise<SyncState> {
    const rows = await this.db.select<{ key: string; value: string }>(
      'SELECT key, value FROM sync_state',
    );
    const state: Record<string, unknown> = { ...EMPTY_SYNC_STATE };
    for (const row of rows) {
      if (row.key in EMPTY_SYNC_STATE) state[row.key] = parse(row.value);
    }
    return state as unknown as SyncState;
  }

  async setState(patch: Partial<SyncState>): Promise<SyncState> {
    const statements: Statement[] = Object.entries(patch)
      .filter(([key, value]) => key in EMPTY_SYNC_STATE && value !== undefined)
      .map(([key, value]) => ({
        sql: `INSERT INTO sync_state (key, value) VALUES (?, ?)
              ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        params: [key, JSON.stringify(value)],
      }));
    if (statements.length > 0) await this.db.batch(statements);
    return this.getState();
  }

  /** Forgets the connection; the workspace's content stays on this device. */
  async forget(): Promise<void> {
    await this.db.batch([{ sql: 'DELETE FROM sync_state' }]);
  }

  // ── Reading local changes ────────────────────────────────────────────────

  /** True when the workspace has songs or planned run sheets worth keeping. */
  async hasContent(workspaceId: string): Promise<boolean> {
    const rows = await this.db.select<{ n: number }>(
      `SELECT (SELECT count(*) FROM song WHERE workspace_id = ? AND removed_at IS NULL)
            + (SELECT count(*) FROM run_sheet_item i JOIN run_sheet r ON r.id = i.run_sheet_id
               WHERE r.workspace_id = ?) AS n`,
      [workspaceId, workspaceId],
    );
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /** Every record changed after `since`, or every record when `since` is null. */
  async localChanges(workspaceId: string, since: string | null): Promise<SyncRecord[]> {
    const after = since ?? '';
    const records: SyncRecord[] = [];

    for (const row of await this.db.select<Row>(
      'SELECT * FROM workspace WHERE id = ? AND updated_at > ?',
      [workspaceId, after],
    )) {
      records.push({
        kind: 'workspace',
        id: text(row.id),
        key: text(row.id),
        revision: Number(row.revision),
        updatedAt: text(row.updated_at),
        data: {
          name: text(row.name),
          timezone: text(row.timezone),
          meetingDays: parse(row.meeting_days) ?? [],
        },
      });
    }

    for (const row of await this.db.select<Row>(
      `SELECT * FROM background_asset WHERE workspace_id = ? AND coalesce(removed_at, created_at) > ?`,
      [workspaceId, after],
    )) {
      const removedAt = optional(row.removed_at);
      records.push({
        kind: 'background',
        id: text(row.id),
        key: text(row.id),
        revision: removedAt ? 2 : 1,
        updatedAt: removedAt ?? text(row.created_at),
        data: {
          kind: text(row.kind),
          fileName: text(row.file_name),
          originalName: text(row.original_name),
          createdAt: text(row.created_at),
          removedAt,
        },
      });
    }

    for (const row of await this.db.select<Row>(
      'SELECT * FROM song WHERE workspace_id = ? AND updated_at > ?',
      [workspaceId, after],
    )) {
      records.push({
        kind: 'song',
        id: text(row.id),
        key: text(row.id),
        revision: Number(row.revision),
        updatedAt: text(row.updated_at),
        data: songData(row),
      });
    }

    for (const row of await this.db.select<Row>(
      `SELECT r.* FROM song_revision r JOIN song s ON s.id = r.song_id
       WHERE s.workspace_id = ? AND r.created_at > ?`,
      [workspaceId, after],
    )) {
      records.push({
        kind: 'songRevision',
        id: text(row.id),
        key: text(row.id),
        revision: 1,
        updatedAt: text(row.created_at),
        data: { ...songData(row), songId: text(row.song_id), revision: Number(row.revision) },
      });
    }

    for (const row of await this.db.select<Row>(
      'SELECT * FROM run_sheet WHERE workspace_id = ? AND updated_at > ?',
      [workspaceId, after],
    )) {
      const items = await this.db.select<Row>(
        'SELECT * FROM run_sheet_item WHERE run_sheet_id = ? ORDER BY position, created_at',
        [text(row.id)],
      );
      records.push({
        kind: 'runSheet',
        id: text(row.id),
        key: text(row.date),
        revision: Number(row.revision),
        updatedAt: text(row.updated_at),
        data: {
          date: text(row.date),
          createdAt: text(row.created_at),
          items: items.map((item) => ({
            id: text(item.id),
            songId: text(item.song_id),
            revision: Number(item.revision),
            createdAt: text(item.created_at),
            updatedAt: text(item.updated_at),
          })),
        },
      });
    }

    for (const row of await this.db.select<Row>(
      'SELECT * FROM setting WHERE workspace_id = ? AND updated_at > ?',
      [workspaceId, after],
    )) {
      records.push({
        kind: 'setting',
        id: text(row.key),
        key: text(row.key),
        revision: Number(row.revision),
        updatedAt: text(row.updated_at),
        data: { value: parse(row.value) },
      });
    }

    return records;
  }

  // ── Applying records from the instance ───────────────────────────────────

  /**
   * Applies records received from the instance to the workspace, keeping only those that
   * win over what is here. Everything is applied in one transaction.
   */
  async applyRemote(workspaceId: string, records: readonly SyncRecord[]): Promise<AppliedChanges> {
    const changes: AppliedChanges = {
      songs: new Set(),
      runSheets: new Set(),
      remapped: new Map(),
      backgroundFiles: [],
      workspace: false,
      settings: false,
    };
    // Only the latest of several records for the same thing matters.
    const latest = new Map<string, SyncRecord>();
    for (const record of records) {
      const id = `${record.kind}:${record.key}`;
      const known = latest.get(id);
      if (!known || syncWins(record, known)) latest.set(id, record);
    }
    const ordered = [...latest.values()].sort(
      (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );

    // Records may refer to songs that never reached the instance; those references are left
    // out rather than failing the whole transaction.
    const incomingSongs = new Set(ordered.filter((r) => r.kind === 'song').map((r) => r.id));
    const known = async (songId: string) =>
      incomingSongs.has(songId) ||
      (await this.db.select('SELECT 1 FROM song WHERE id = ?', [songId])).length > 0;

    // Foreign keys are checked when the transaction commits, once everything is in place.
    const statements: Statement[] = [{ sql: 'PRAGMA defer_foreign_keys = ON' }];
    for (const record of ordered) {
      switch (record.kind) {
        case 'workspace':
          statements.push(...(await this.applyWorkspace(workspaceId, record, changes)));
          break;
        case 'background':
          statements.push(...(await this.applyBackground(workspaceId, record, changes)));
          break;
        case 'song':
          statements.push(...(await this.applySong(workspaceId, record, changes)));
          break;
        case 'songRevision':
          if (await known(str(record.data.songId))) statements.push(applySongRevision(record));
          break;
        case 'runSheet':
          statements.push(...(await this.applyRunSheet(workspaceId, record, changes, known)));
          break;
        case 'setting':
          statements.push(...(await this.applySetting(workspaceId, record, changes)));
          break;
      }
    }
    if (statements.length > 1) await this.db.batch(statements);
    return changes;
  }

  private async current(sql: string, params: SqlValue[]) {
    const rows = await this.db.select<Row>(sql, params);
    const row = rows[0];
    return row ? { row, revision: Number(row.revision), updatedAt: text(row.updated_at) } : null;
  }

  private async applyWorkspace(
    workspaceId: string,
    record: SyncRecord,
    changes: AppliedChanges,
  ): Promise<Statement[]> {
    if (record.id !== workspaceId) return [];
    const current = await this.current('SELECT * FROM workspace WHERE id = ?', [workspaceId]);
    if (!syncWins(record, current)) return [];
    changes.workspace = true;
    const { data } = record;
    return [
      {
        sql: `UPDATE workspace SET name = ?, timezone = ?, meeting_days = ?, revision = ?, updated_at = ?
              WHERE id = ?`,
        params: [
          str(data.name),
          str(data.timezone) || 'UTC',
          JSON.stringify(Array.isArray(data.meetingDays) ? data.meetingDays : [0]),
          record.revision,
          record.updatedAt,
          workspaceId,
        ],
      },
    ];
  }

  private async applyBackground(
    workspaceId: string,
    record: SyncRecord,
    changes: AppliedChanges,
  ): Promise<Statement[]> {
    const rows = await this.db.select<Row>('SELECT * FROM background_asset WHERE id = ?', [
      record.id,
    ]);
    const row = rows[0];
    const current = row
      ? {
          revision: row.removed_at ? 2 : 1,
          updatedAt: optional(row.removed_at) ?? text(row.created_at),
        }
      : null;
    if (!syncWins(record, current)) return [];
    const { data } = record;
    const fileName = str(data.fileName);
    const removedAt = strOrNull(data.removedAt);
    if (!row && !removedAt) changes.backgroundFiles.push(fileName);
    return [
      {
        sql: `INSERT INTO background_asset (id, workspace_id, kind, file_name, original_name, created_at, removed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET removed_at = excluded.removed_at`,
        params: [
          record.id,
          workspaceId,
          str(data.kind) === 'video' ? 'video' : 'image',
          fileName,
          str(data.originalName),
          str(data.createdAt) || record.updatedAt,
          removedAt,
        ],
      },
    ];
  }

  private async applySong(
    workspaceId: string,
    record: SyncRecord,
    changes: AppliedChanges,
  ): Promise<Statement[]> {
    const current = await this.current('SELECT * FROM song WHERE id = ?', [record.id]);
    if (!syncWins(record, current)) return [];
    changes.songs.add(record.id);
    const d = record.data;
    const background = (d.background ?? null) as { color?: unknown; assetId?: unknown } | null;
    const lineIds = Array.isArray(d.lineIds) ? d.lineIds : [];
    const deck = deckOf(d.deck);
    // A deck's slide images are fetched like background files, also for a deck removed from
    // the library: run sheets that use it still present it.
    if (deck) changes.backgroundFiles.push(...deck.pages.map((page) => page.image));
    return [
      {
        sql: `INSERT INTO song (id, workspace_id, title, lyrics, line_ids, author, copyright, ccli, year,
                background_color, background_asset_id, deck, revision, created_at, updated_at, removed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET title = excluded.title, lyrics = excluded.lyrics,
                line_ids = excluded.line_ids, author = excluded.author, copyright = excluded.copyright,
                ccli = excluded.ccli, year = excluded.year, background_color = excluded.background_color,
                background_asset_id = excluded.background_asset_id, deck = excluded.deck,
                revision = excluded.revision, updated_at = excluded.updated_at,
                removed_at = excluded.removed_at`,
        params: [
          record.id,
          workspaceId,
          str(d.title),
          str(d.lyrics),
          JSON.stringify(lineIds),
          str(d.author),
          str(d.copyright),
          strOrNull(d.ccli),
          numOrNull(d.year),
          background ? strOrNull(background.color) : null,
          background ? strOrNull(background.assetId) : null,
          deck ? JSON.stringify(deck) : null,
          record.revision,
          str(d.createdAt) || record.updatedAt,
          record.updatedAt,
          strOrNull(d.removedAt),
        ],
      },
      this.store.searchUpsert({ id: record.id, title: str(d.title), lyrics: str(d.lyrics) }),
    ];
  }

  private async applyRunSheet(
    workspaceId: string,
    record: SyncRecord,
    changes: AppliedChanges,
    known: (songId: string) => Promise<boolean>,
  ): Promise<Statement[]> {
    const date = str(record.data.date);
    const statements: Statement[] = [];
    const current = await this.current(
      'SELECT * FROM run_sheet WHERE workspace_id = ? AND date = ?',
      [workspaceId, date],
    );
    const localId = current ? text(current.row.id) : null;
    if (localId && localId !== record.id) {
      // The instance knows this date's run sheet by another identifier; adopt it.
      statements.push(...remapRunSheetStatements(localId, record.id));
      changes.remapped.set(localId, record.id);
      changes.runSheets.add(record.id);
    }
    if (current && !syncWins(record, current)) return statements;

    changes.runSheets.add(record.id);
    const items: Row[] = [];
    for (const item of Array.isArray(record.data.items) ? (record.data.items as Row[]) : []) {
      if (await known(str(item.songId))) items.push(item);
    }
    statements.push(
      {
        sql: `INSERT INTO run_sheet (id, workspace_id, date, revision, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`,
        params: [
          record.id,
          workspaceId,
          date,
          record.revision,
          str(record.data.createdAt) || record.updatedAt,
          record.updatedAt,
        ],
      },
      { sql: 'DELETE FROM run_sheet_item WHERE run_sheet_id = ?', params: [record.id] },
      ...items.map((item, position) => ({
        sql: `INSERT INTO run_sheet_item (id, run_sheet_id, song_id, position, revision, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET run_sheet_id = excluded.run_sheet_id,
                position = excluded.position, revision = excluded.revision, updated_at = excluded.updated_at`,
        params: [
          str(item.id),
          record.id,
          str(item.songId),
          position,
          Number(item.revision ?? 1),
          str(item.createdAt) || record.updatedAt,
          str(item.updatedAt) || record.updatedAt,
        ],
      })),
    );
    return statements;
  }

  private async applySetting(
    workspaceId: string,
    record: SyncRecord,
    changes: AppliedChanges,
  ): Promise<Statement[]> {
    const current = await this.current('SELECT * FROM setting WHERE workspace_id = ? AND key = ?', [
      workspaceId,
      record.key,
    ]);
    if (!syncWins(record, current)) return [];
    changes.settings = true;
    return [
      {
        sql: `INSERT INTO setting (workspace_id, key, value, revision, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (workspace_id, key) DO UPDATE
              SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
        params: [
          workspaceId,
          record.key,
          JSON.stringify(record.data.value ?? null),
          record.revision,
          record.updatedAt,
        ],
      },
    ];
  }

  /** Gives a run sheet the identifier the instance knows it by. */
  async remapRunSheet(from: string, to: string): Promise<void> {
    if (from === to) return;
    await this.db.batch([
      { sql: 'PRAGMA defer_foreign_keys = ON' },
      ...remapRunSheetStatements(from, to),
    ]);
  }

  // ── Joining a church workspace ───────────────────────────────────────────

  /**
   * Moves everything in the local workspace to the workspace identifier used by the church
   * instance, so this device's content becomes part of it.
   */
  async rehomeWorkspace(fromId: string, toId: string): Promise<void> {
    if (fromId === toId) return;
    const tables = [
      'song',
      'run_sheet',
      'setting',
      'background_asset',
      'output_profile',
      'live_state',
      'remote_grant',
    ];
    await this.db.batch([
      { sql: 'PRAGMA defer_foreign_keys = ON' },
      {
        sql: `INSERT INTO workspace (id, name, timezone, meeting_days, revision, created_at, updated_at)
              SELECT ?, name, timezone, meeting_days, revision, created_at, updated_at
              FROM workspace WHERE id = ?`,
        params: [toId, fromId],
      },
      ...tables.map((table) => ({
        sql: `UPDATE ${table} SET workspace_id = ? WHERE workspace_id = ?`,
        params: [toId, fromId],
      })),
      { sql: 'DELETE FROM workspace WHERE id = ?', params: [fromId] },
    ]);
  }

  /** Makes the workspace's own settings lose to any copy from the instance. */
  async yieldWorkspace(workspaceId: string): Promise<void> {
    await this.db.batch([
      {
        sql: `UPDATE workspace SET revision = 0, updated_at = '' WHERE id = ?`,
        params: [workspaceId],
      },
    ]);
  }

  /**
   * Removes the workspace's songs, run sheets, settings and backgrounds before taking the
   * church's copy instead. Output settings stay: they belong to this device.
   */
  async clearContent(workspaceId: string): Promise<void> {
    await this.db.batch([
      {
        sql: `DELETE FROM run_sheet_item WHERE run_sheet_id IN
              (SELECT id FROM run_sheet WHERE workspace_id = ?)`,
        params: [workspaceId],
      },
      { sql: 'DELETE FROM run_sheet WHERE workspace_id = ?', params: [workspaceId] },
      {
        sql: `DELETE FROM song_search WHERE song_id IN (SELECT id FROM song WHERE workspace_id = ?)`,
        params: [workspaceId],
      },
      {
        sql: `DELETE FROM song_revision WHERE song_id IN (SELECT id FROM song WHERE workspace_id = ?)`,
        params: [workspaceId],
      },
      { sql: 'DELETE FROM song WHERE workspace_id = ?', params: [workspaceId] },
      { sql: 'DELETE FROM setting WHERE workspace_id = ?', params: [workspaceId] },
      { sql: 'DELETE FROM background_asset WHERE workspace_id = ?', params: [workspaceId] },
      { sql: 'DELETE FROM live_state WHERE workspace_id = ?', params: [workspaceId] },
      {
        sql: `UPDATE output_profile SET background_asset_id = NULL WHERE workspace_id = ?`,
        params: [workspaceId],
      },
    ]);
  }
}

function songData(row: Row): Record<string, unknown> {
  return {
    title: text(row.title),
    lyrics: text(row.lyrics),
    lineIds: parse(row.line_ids) ?? [],
    author: text(row.author),
    copyright: text(row.copyright),
    ccli: optional(row.ccli),
    year: row.year == null ? null : Number(row.year),
    background:
      row.background_color == null
        ? null
        : { color: text(row.background_color), assetId: optional(row.background_asset_id) },
    deck: parse(row.deck) ?? null,
    createdAt: text(row.created_at),
    removedAt: optional(row.removed_at),
  };
}

function applySongRevision(record: SyncRecord): Statement {
  const d = record.data;
  const background = (d.background ?? null) as { color?: unknown; assetId?: unknown } | null;
  return {
    // A revision another device numbered the same as one here is kept out; the song itself
    // still settles on the winning content.
    sql: `INSERT OR IGNORE INTO song_revision (id, song_id, revision, title, lyrics, line_ids, author,
            copyright, ccli, year, background_color, background_asset_id, deck, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      record.id,
      str(d.songId),
      Number(d.revision ?? 1),
      str(d.title),
      str(d.lyrics),
      JSON.stringify(Array.isArray(d.lineIds) ? d.lineIds : []),
      str(d.author),
      str(d.copyright),
      strOrNull(d.ccli),
      numOrNull(d.year),
      background ? strOrNull(background.color) : null,
      background ? strOrNull(background.assetId) : null,
      deckOf(d.deck) ? JSON.stringify(d.deck) : null,
      record.updatedAt,
    ],
  };
}

/** A deck received from another device, or null when there is none or it is unreadable. */
function deckOf(value: unknown): Deck | null {
  const parsed = DeckSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function remapRunSheetStatements(from: string, to: string): Statement[] {
  return [
    // Make room in case the instance's identifier already exists here under another date.
    {
      sql: 'DELETE FROM run_sheet_item WHERE run_sheet_id = ?',
      params: [to],
    },
    { sql: 'DELETE FROM run_sheet WHERE id = ?', params: [to] },
    { sql: 'UPDATE run_sheet SET id = ? WHERE id = ?', params: [to, from] },
    {
      sql: 'UPDATE run_sheet_item SET run_sheet_id = ? WHERE run_sheet_id = ?',
      params: [to, from],
    },
    {
      // The saved live state refers to run sheets by identifier.
      sql: `UPDATE live_state SET state = replace(state, ?, ?)`,
      params: [`"${from}"`, `"${to}"`],
    },
  ];
}
