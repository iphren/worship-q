import { assignLineIds } from '@worship-q/lyrics';
import {
  DEFAULT_PRESENTATION_SETTINGS,
  invalidSongFields,
  LiveStateSchema,
  OutputProfileSchema,
  OutputTargetSchema,
  PresentationSettingsSchema,
  type BackgroundAsset,
  type BackgroundKind,
  type IsoDate,
  type LiveState,
  type OutputProfile,
  type PresentationSettings,
  type RunSheet,
  type RunSheetItem,
  type Song,
  type SongFields,
  type SongRevision,
  type Workspace,
} from '@worship-q/protocol';
import { parseQuery, rankSong, SEARCH_VERSION, songKeys, type SongKeys } from '@worship-q/search';
import type { SqlDriver, SqlValue, Statement } from './driver';

export interface StoreEnv {
  /** Current instant as an ISO 8601 string. */
  now(): string;
  /** A new globally unique identifier. */
  newId(): string;
}

type Row = Record<string, SqlValue>;

const text = (value: SqlValue | undefined) => String(value ?? '');
const optional = (value: SqlValue | undefined) => (value == null ? null : String(value));
const optionalNumber = (value: SqlValue | undefined) => (value == null ? null : Number(value));
const json = <T>(value: SqlValue | undefined, fallback: T): T => {
  try {
    return value == null ? fallback : (JSON.parse(String(value)) as T);
  } catch {
    return fallback;
  }
};

function toWorkspace(row: Row): Workspace {
  return {
    id: text(row.id),
    name: text(row.name),
    timezone: text(row.timezone),
    meetingDays: json<number[]>(row.meeting_days, []),
    revision: Number(row.revision),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function toSong(row: Row): Song {
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    title: text(row.title),
    lyrics: text(row.lyrics),
    lineIds: json<string[]>(row.line_ids, []),
    author: text(row.author),
    copyright: text(row.copyright),
    ccli: optional(row.ccli),
    year: optionalNumber(row.year),
    revision: Number(row.revision),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    removedAt: optional(row.removed_at),
  };
}

function toSongRevision(row: Row): SongRevision {
  return {
    id: text(row.id),
    songId: text(row.song_id),
    revision: Number(row.revision),
    title: text(row.title),
    lyrics: text(row.lyrics),
    lineIds: json<string[]>(row.line_ids, []),
    author: text(row.author),
    copyright: text(row.copyright),
    ccli: optional(row.ccli),
    year: optionalNumber(row.year),
    createdAt: text(row.created_at),
  };
}

function toRunSheet(row: Row): RunSheet {
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    date: text(row.date),
    revision: Number(row.revision),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function toItem(row: Row): RunSheetItem {
  return {
    id: text(row.id),
    runSheetId: text(row.run_sheet_id),
    songId: text(row.song_id),
    position: Number(row.position),
    revision: Number(row.revision),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function toBackground(row: Row): BackgroundAsset {
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    kind: text(row.kind) as BackgroundKind,
    fileName: text(row.file_name),
    originalName: text(row.original_name),
    createdAt: text(row.created_at),
    removedAt: optional(row.removed_at),
  };
}

function toOutputProfile(row: Row): OutputProfile {
  const target = OutputTargetSchema.safeParse(json<unknown>(row.target, null));
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    kind: 'slideshow',
    fontFamily: optional(row.font_family),
    scale: Number(row.scale),
    backgroundColor: text(row.background_color),
    backgroundAssetId: optional(row.background_asset_id),
    hideCursor: Number(row.hide_cursor) === 1,
    target: target.success ? target.data : null,
    revision: Number(row.revision),
    updatedAt: text(row.updated_at),
  };
}

function toSongKeys(row: Row): SongKeys {
  return {
    title: {
      text: text(row.title_text),
      pinyin: text(row.title_pinyin),
      initials: text(row.title_initials),
    },
    lyrics: {
      text: text(row.lyrics_text),
      pinyin: text(row.lyrics_pinyin),
      initials: text(row.lyrics_initials),
    },
  };
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export type OutputProfilePatch = Partial<
  Pick<
    OutputProfile,
    'fontFamily' | 'scale' | 'backgroundColor' | 'backgroundAssetId' | 'hideCursor' | 'target'
  >
>;

export type CopyMode = 'append' | 'replace';

/** Data access for one local database. Every write in the app goes through here. */
export class Store {
  constructor(
    readonly db: SqlDriver,
    private readonly env: StoreEnv,
  ) {}

  newId(): string {
    return this.env.newId();
  }

  // ── Workspace ────────────────────────────────────────────────────────────

  async getWorkspace(): Promise<Workspace | null> {
    const rows = await this.db.select<Row>('SELECT * FROM workspace ORDER BY created_at LIMIT 1');
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  /**
   * Returns the local workspace, creating it on first run with Sunday as the meeting day
   * and the given timezone.
   */
  async ensureWorkspace(timezone: string): Promise<Workspace> {
    const existing = await this.getWorkspace();
    if (existing) return existing;
    const now = this.env.now();
    const workspace: Workspace = {
      id: this.env.newId(),
      name: '',
      timezone,
      meetingDays: [0],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.batch([
      {
        sql: `INSERT INTO workspace (id, name, timezone, meeting_days, revision, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [workspace.id, workspace.name, timezone, '[0]', 1, now, now],
      },
    ]);
    return workspace;
  }

  async setMeetingDays(workspaceId: string, days: readonly number[]): Promise<Workspace> {
    const normalized = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    await this.db.batch([
      {
        sql: `UPDATE workspace SET meeting_days = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
        params: [JSON.stringify(normalized), this.env.now(), workspaceId],
      },
    ]);
    return (await this.getWorkspace())!;
  }

  // ── Songs ────────────────────────────────────────────────────────────────

  private revisionInsert(song: Song): Statement {
    return {
      sql: `INSERT INTO song_revision (id, song_id, revision, title, lyrics, line_ids, author, copyright, ccli, year, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        this.env.newId(),
        song.id,
        song.revision,
        song.title,
        song.lyrics,
        JSON.stringify(song.lineIds),
        song.author,
        song.copyright,
        song.ccli,
        song.year,
        song.updatedAt,
      ],
    };
  }

  /** Stores the search keys of a song, replacing earlier ones. */
  private searchUpsert(song: Pick<Song, 'id' | 'title' | 'lyrics'>): Statement {
    const keys = songKeys(song);
    return {
      sql: `INSERT OR REPLACE INTO song_search (song_id, version, title_text, title_pinyin, title_initials,
              lyrics_text, lyrics_pinyin, lyrics_initials)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        song.id,
        SEARCH_VERSION,
        keys.title.text,
        keys.title.pinyin,
        keys.title.initials,
        keys.lyrics.text,
        keys.lyrics.pinyin,
        keys.lyrics.initials,
      ],
    };
  }

  private validate(song: Song): void {
    const invalid = invalidSongFields(song, new Date(this.env.now()));
    if (invalid.length > 0) throw new Error(`Invalid song ${invalid.join(' and ')}`);
  }

  async createSong(workspaceId: string, fields: Partial<SongFields>): Promise<Song> {
    const now = this.env.now();
    const lyrics = fields.lyrics ?? '';
    const song: Song = {
      id: this.env.newId(),
      workspaceId,
      title: fields.title ?? '',
      lyrics,
      lineIds: assignLineIds(null, lyrics, () => this.env.newId()),
      author: fields.author ?? '',
      copyright: fields.copyright ?? '',
      ccli: fields.ccli ?? null,
      year: fields.year ?? null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      removedAt: null,
    };
    this.validate(song);
    await this.db.batch([
      {
        sql: `INSERT INTO song (id, workspace_id, title, lyrics, line_ids, author, copyright, ccli, year, revision, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          song.id,
          workspaceId,
          song.title,
          song.lyrics,
          JSON.stringify(song.lineIds),
          song.author,
          song.copyright,
          song.ccli,
          song.year,
          1,
          now,
          now,
        ],
      },
      this.revisionInsert(song),
      this.searchUpsert(song),
    ]);
    return song;
  }

  /**
   * Saves an edit as a new revision. Line identifiers are carried over so pieces keep their
   * identity. Saving without any change creates no revision.
   */
  async updateSong(id: string, fields: Partial<SongFields>): Promise<Song> {
    const current = await this.getSong(id);
    if (!current) throw new Error(`Song ${id} does not exist`);
    const next: Song = { ...current, ...fields };
    const unchanged =
      next.title === current.title &&
      next.lyrics === current.lyrics &&
      next.author === current.author &&
      next.copyright === current.copyright &&
      next.ccli === current.ccli &&
      next.year === current.year;
    if (unchanged) return current;
    this.validate(next);

    next.lineIds = assignLineIds(current, next.lyrics, () => this.env.newId());
    next.revision = current.revision + 1;
    next.updatedAt = this.env.now();
    await this.db.batch([
      {
        sql: `UPDATE song SET title = ?, lyrics = ?, line_ids = ?, author = ?, copyright = ?, ccli = ?, year = ?,
                revision = ?, updated_at = ?
              WHERE id = ?`,
        params: [
          next.title,
          next.lyrics,
          JSON.stringify(next.lineIds),
          next.author,
          next.copyright,
          next.ccli,
          next.year,
          next.revision,
          next.updatedAt,
          id,
        ],
      },
      this.revisionInsert(next),
      this.searchUpsert(next),
    ]);
    return next;
  }

  /**
   * Removes a song from the library. Run sheets that use it keep their item, which still
   * resolves to the song's last saved lyrics.
   */
  async removeSong(id: string): Promise<void> {
    const now = this.env.now();
    await this.db.batch([
      {
        sql: `UPDATE song SET removed_at = ?, revision = revision + 1, updated_at = ?
              WHERE id = ? AND removed_at IS NULL`,
        params: [now, now, id],
      },
    ]);
  }

  /** Any song by identifier, including one removed from the library. */
  async getSong(id: string): Promise<Song | null> {
    const rows = await this.db.select<Row>('SELECT * FROM song WHERE id = ?', [id]);
    return rows[0] ? toSong(rows[0]) : null;
  }

  /**
   * Songs in the library. With a search, every term must match the title or the lyrics by
   * Chinese characters in either script, by sound, by pinyin or by pinyin initials; songs are
   * ordered by how well they match (see `rankSong`), then by title.
   */
  async listSongs(workspaceId: string, search = ''): Promise<Song[]> {
    const terms = parseQuery(search);
    const where: string[] = [];
    const params: SqlValue[] = [workspaceId];
    for (const term of terms) {
      if (term.chinese) {
        where.push(`(s.title_text LIKE ? ESCAPE '\\' OR s.lyrics_text LIKE ? ESCAPE '\\'
          OR s.title_pinyin LIKE ? ESCAPE '\\' OR s.lyrics_pinyin LIKE ? ESCAPE '\\')`);
        const text = likePattern(term.text);
        const pinyin = likePattern(term.pinyin);
        params.push(text, text, pinyin, pinyin);
      } else {
        where.push(`(s.title_pinyin LIKE ? ESCAPE '\\' OR s.title_initials LIKE ? ESCAPE '\\'
          OR s.lyrics_pinyin LIKE ? ESCAPE '\\' OR s.lyrics_initials LIKE ? ESCAPE '\\')`);
        const pattern = likePattern(term.pinyin);
        params.push(pattern, pattern, pattern, pattern);
      }
    }
    const rows = await this.db.select<Row>(
      `SELECT song.*, s.title_text, s.title_pinyin, s.title_initials,
              s.lyrics_text, s.lyrics_pinyin, s.lyrics_initials
       FROM song ${terms.length > 0 ? 'JOIN' : 'LEFT JOIN'} song_search s ON s.song_id = song.id
       WHERE song.workspace_id = ? AND song.removed_at IS NULL
       ${where.map((clause) => `AND ${clause}`).join(' ')}
       ORDER BY song.title COLLATE NOCASE, song.created_at`,
      params,
    );
    if (terms.length === 0) return rows.map(toSong);
    return rows
      .map((row) => ({ song: toSong(row), rank: rankSong(terms, toSongKeys(row)) ?? Infinity }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ song }) => song);
  }

  /**
   * Builds search keys for songs that have none, or whose keys an older search version made.
   * Run at startup, after migrating.
   */
  async refreshSearchIndex(): Promise<number> {
    const rows = await this.db.select<{ id: string; title: string; lyrics: string }>(
      `SELECT song.id, song.title, song.lyrics FROM song
       LEFT JOIN song_search s ON s.song_id = song.id
       WHERE s.song_id IS NULL OR s.version <> ?`,
      [SEARCH_VERSION],
    );
    const BATCH = 200;
    for (let start = 0; start < rows.length; start += BATCH) {
      await this.db.batch(rows.slice(start, start + BATCH).map((row) => this.searchUpsert(row)));
    }
    return rows.length;
  }

  async listSongRevisions(songId: string): Promise<SongRevision[]> {
    const rows = await this.db.select<Row>(
      'SELECT * FROM song_revision WHERE song_id = ? ORDER BY revision',
      [songId],
    );
    return rows.map(toSongRevision);
  }

  /** Dates of the run sheets that use a song. */
  async songUsage(songId: string): Promise<IsoDate[]> {
    const rows = await this.db.select<{ date: string }>(
      `SELECT DISTINCT run_sheet.date AS date FROM run_sheet_item
       JOIN run_sheet ON run_sheet.id = run_sheet_item.run_sheet_id
       WHERE run_sheet_item.song_id = ? ORDER BY run_sheet.date`,
      [songId],
    );
    return rows.map((row) => row.date);
  }

  // ── Run sheets ───────────────────────────────────────────────────────────

  async getRunSheet(id: string): Promise<RunSheet | null> {
    const rows = await this.db.select<Row>('SELECT * FROM run_sheet WHERE id = ?', [id]);
    return rows[0] ? toRunSheet(rows[0]) : null;
  }

  async getRunSheetByDate(workspaceId: string, date: IsoDate): Promise<RunSheet | null> {
    const rows = await this.db.select<Row>(
      'SELECT * FROM run_sheet WHERE workspace_id = ? AND date = ?',
      [workspaceId, date],
    );
    return rows[0] ? toRunSheet(rows[0]) : null;
  }

  /** The run sheet for a date, created empty if the date has none yet. */
  async ensureRunSheet(workspaceId: string, date: IsoDate): Promise<RunSheet> {
    const existing = await this.getRunSheetByDate(workspaceId, date);
    if (existing) return existing;
    const now = this.env.now();
    const sheet: RunSheet = {
      id: this.env.newId(),
      workspaceId,
      date,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.batch([
      {
        sql: `INSERT INTO run_sheet (id, workspace_id, date, revision, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        params: [sheet.id, workspaceId, date, 1, now, now],
      },
    ]);
    return sheet;
  }

  /** The run sheet for a date if it has at least one item; an empty plan counts as none. */
  async getPlannedRunSheet(workspaceId: string, date: IsoDate): Promise<RunSheet | null> {
    const sheet = await this.getRunSheetByDate(workspaceId, date);
    if (!sheet) return null;
    return (await this.listItems(sheet.id)).length > 0 ? sheet : null;
  }

  async listItems(runSheetId: string): Promise<RunSheetItem[]> {
    const rows = await this.db.select<Row>(
      'SELECT * FROM run_sheet_item WHERE run_sheet_id = ? ORDER BY position, created_at',
      [runSheetId],
    );
    return rows.map(toItem);
  }

  /** Dates in the inclusive range that have at least one planned item. */
  async datesWithItems(workspaceId: string, from: IsoDate, to: IsoDate): Promise<IsoDate[]> {
    const rows = await this.db.select<{ date: string }>(
      `SELECT date FROM run_sheet
       WHERE workspace_id = ? AND date >= ? AND date <= ?
         AND EXISTS (SELECT 1 FROM run_sheet_item WHERE run_sheet_id = run_sheet.id)
       ORDER BY date`,
      [workspaceId, from, to],
    );
    return rows.map((row) => row.date);
  }

  private touchRunSheet(runSheetId: string, now: string): Statement {
    return {
      sql: 'UPDATE run_sheet SET revision = revision + 1, updated_at = ? WHERE id = ?',
      params: [now, runSheetId],
    };
  }

  private itemInsert(item: RunSheetItem): Statement {
    return {
      sql: `INSERT INTO run_sheet_item (id, run_sheet_id, song_id, position, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        item.id,
        item.runSheetId,
        item.songId,
        item.position,
        item.revision,
        item.createdAt,
        item.updatedAt,
      ],
    };
  }

  private newItem(runSheetId: string, songId: string, position: number, now: string): RunSheetItem {
    return {
      id: this.env.newId(),
      runSheetId,
      songId,
      position,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Adds a song to the end of a run sheet. The same song may be added more than once. */
  async addItem(runSheetId: string, songId: string): Promise<RunSheetItem> {
    const now = this.env.now();
    const items = await this.listItems(runSheetId);
    const item = this.newItem(runSheetId, songId, items.length, now);
    await this.db.batch([this.itemInsert(item), this.touchRunSheet(runSheetId, now)]);
    return item;
  }

  private reposition(ordered: RunSheetItem[], now: string): Statement[] {
    return ordered.flatMap((item, position) =>
      item.position === position
        ? []
        : [
            {
              sql: 'UPDATE run_sheet_item SET position = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
              params: [position, now, item.id] as SqlValue[],
            },
          ],
    );
  }

  /** Moves an item to `toIndex` within its run sheet. */
  async moveItem(itemId: string, toIndex: number): Promise<void> {
    const rows = await this.db.select<Row>('SELECT * FROM run_sheet_item WHERE id = ?', [itemId]);
    if (!rows[0]) return;
    const item = toItem(rows[0]);
    const items = await this.listItems(item.runSheetId);
    const from = items.findIndex((candidate) => candidate.id === itemId);
    const to = Math.max(0, Math.min(items.length - 1, toIndex));
    if (from === to) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved!);
    const now = this.env.now();
    await this.db.batch([...this.reposition(items, now), this.touchRunSheet(item.runSheetId, now)]);
  }

  async removeItem(itemId: string): Promise<void> {
    const rows = await this.db.select<Row>('SELECT * FROM run_sheet_item WHERE id = ?', [itemId]);
    if (!rows[0]) return;
    const item = toItem(rows[0]);
    const remaining = (await this.listItems(item.runSheetId)).filter((i) => i.id !== itemId);
    const now = this.env.now();
    await this.db.batch([
      { sql: 'DELETE FROM run_sheet_item WHERE id = ?', params: [itemId] },
      ...this.reposition(remaining, now),
      this.touchRunSheet(item.runSheetId, now),
    ]);
  }

  /**
   * Copies the items of one run sheet into another. The copies are new items pointing at
   * the same songs; the source run sheet is never changed and no song is duplicated.
   */
  async copyItems(sourceId: string, targetId: string, mode: CopyMode): Promise<RunSheetItem[]> {
    if (sourceId === targetId) return [];
    const now = this.env.now();
    const source = await this.listItems(sourceId);
    const existing = mode === 'append' ? await this.listItems(targetId) : [];
    const copies = source.map((item, index) =>
      this.newItem(targetId, item.songId, existing.length + index, now),
    );
    const statements: Statement[] = [];
    if (mode === 'replace') {
      statements.push({
        sql: 'DELETE FROM run_sheet_item WHERE run_sheet_id = ?',
        params: [targetId],
      });
    }
    statements.push(
      ...copies.map((copy) => this.itemInsert(copy)),
      this.touchRunSheet(targetId, now),
    );
    await this.db.batch(statements);
    return copies;
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  async getPresentationSettings(workspaceId: string): Promise<PresentationSettings> {
    const rows = await this.db.select<{ key: string; value: string }>(
      'SELECT key, value FROM setting WHERE workspace_id = ?',
      [workspaceId],
    );
    const stored: Record<string, unknown> = {};
    for (const row of rows) stored[row.key] = json<unknown>(row.value, undefined);
    const merged: Record<string, unknown> = { ...DEFAULT_PRESENTATION_SETTINGS };
    for (const key of Object.keys(
      DEFAULT_PRESENTATION_SETTINGS,
    ) as (keyof PresentationSettings)[]) {
      const candidate = PresentationSettingsSchema.shape[key].safeParse(stored[key]);
      if (candidate.success) merged[key] = candidate.data;
    }
    return merged as PresentationSettings;
  }

  async updatePresentationSettings(
    workspaceId: string,
    patch: Partial<PresentationSettings>,
  ): Promise<PresentationSettings> {
    const valid = PresentationSettingsSchema.partial().parse(patch);
    const now = this.env.now();
    const statements = Object.entries(valid)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({
        sql: `INSERT INTO setting (workspace_id, key, value, revision, updated_at) VALUES (?, ?, ?, 1, ?)
              ON CONFLICT (workspace_id, key) DO UPDATE
              SET value = excluded.value, revision = setting.revision + 1, updated_at = excluded.updated_at`,
        params: [workspaceId, key, JSON.stringify(value), now] as SqlValue[],
      }));
    if (statements.length > 0) await this.db.batch(statements);
    return this.getPresentationSettings(workspaceId);
  }

  // ── Backgrounds ──────────────────────────────────────────────────────────

  /** Records a background whose file has already been copied into the app's storage. */
  async addBackground(
    workspaceId: string,
    asset: { id: string; kind: BackgroundKind; fileName: string; originalName: string },
  ): Promise<BackgroundAsset> {
    const now = this.env.now();
    await this.db.batch([
      {
        sql: `INSERT INTO background_asset (id, workspace_id, kind, file_name, original_name, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        params: [asset.id, workspaceId, asset.kind, asset.fileName, asset.originalName, now],
      },
    ]);
    return { ...asset, workspaceId, createdAt: now, removedAt: null };
  }

  async listBackgrounds(workspaceId: string): Promise<BackgroundAsset[]> {
    const rows = await this.db.select<Row>(
      'SELECT * FROM background_asset WHERE workspace_id = ? AND removed_at IS NULL ORDER BY created_at',
      [workspaceId],
    );
    return rows.map(toBackground);
  }

  /** Removes a background; an output that had it selected falls back to its solid color. */
  async removeBackground(id: string): Promise<void> {
    const now = this.env.now();
    await this.db.batch([
      {
        sql: 'UPDATE background_asset SET removed_at = ? WHERE id = ? AND removed_at IS NULL',
        params: [now, id],
      },
      {
        sql: `UPDATE output_profile SET background_asset_id = NULL, revision = revision + 1, updated_at = ?
              WHERE background_asset_id = ?`,
        params: [now, id],
      },
    ]);
  }

  // ── Output profile ───────────────────────────────────────────────────────

  /** The slideshow output's settings, created with defaults on first use. */
  async getOutputProfile(workspaceId: string): Promise<OutputProfile> {
    const query = `SELECT * FROM output_profile WHERE workspace_id = ? AND kind = 'slideshow'`;
    let rows = await this.db.select<Row>(query, [workspaceId]);
    if (!rows[0]) {
      await this.db.batch([
        {
          sql: `INSERT INTO output_profile (id, workspace_id, kind, font_family, scale, background_color, revision, updated_at)
                VALUES (?, ?, 'slideshow', NULL, 1, '#000000', 1, ?)
                ON CONFLICT (workspace_id, kind) DO NOTHING`,
          params: [this.env.newId(), workspaceId, this.env.now()],
        },
      ]);
      rows = await this.db.select<Row>(query, [workspaceId]);
    }
    return toOutputProfile(rows[0]!);
  }

  async updateOutputProfile(
    workspaceId: string,
    patch: OutputProfilePatch,
  ): Promise<OutputProfile> {
    const current = await this.getOutputProfile(workspaceId);
    const next = OutputProfileSchema.parse({
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: this.env.now(),
    });
    await this.db.batch([
      {
        sql: `UPDATE output_profile
              SET font_family = ?, scale = ?, background_color = ?, background_asset_id = ?,
                  hide_cursor = ?, target = ?, revision = ?, updated_at = ?
              WHERE id = ?`,
        params: [
          next.fontFamily,
          next.scale,
          next.backgroundColor,
          next.backgroundAssetId,
          next.hideCursor ? 1 : 0,
          next.target ? JSON.stringify(next.target) : null,
          next.revision,
          next.updatedAt,
          next.id,
        ],
      },
    ]);
    return next;
  }

  // ── Live state ───────────────────────────────────────────────────────────

  async loadLiveState(workspaceId: string): Promise<LiveState | null> {
    const rows = await this.db.select<{ state: string }>(
      'SELECT state FROM live_state WHERE workspace_id = ?',
      [workspaceId],
    );
    const parsed = LiveStateSchema.safeParse(json<unknown>(rows[0]?.state, null));
    return parsed.success ? parsed.data : null;
  }

  async saveLiveState(workspaceId: string, state: LiveState): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO live_state (workspace_id, state, updated_at) VALUES (?, ?, ?)
              ON CONFLICT (workspace_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
        params: [workspaceId, JSON.stringify(state), this.env.now()],
      },
    ]);
  }

  async clearLiveState(workspaceId: string): Promise<void> {
    await this.db.batch([
      { sql: 'DELETE FROM live_state WHERE workspace_id = ?', params: [workspaceId] },
    ]);
  }
}
