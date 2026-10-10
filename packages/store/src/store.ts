import { assignLineIds } from '@worship-q/lyrics';
import {
  DEFAULT_PRESENTATION_SETTINGS,
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
    target: target.success ? target.data : null,
    revision: Number(row.revision),
    updatedAt: text(row.updated_at),
  };
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export type OutputProfilePatch = Partial<
  Pick<OutputProfile, 'fontFamily' | 'scale' | 'backgroundColor' | 'backgroundAssetId' | 'target'>
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
      sql: `INSERT INTO song_revision (id, song_id, revision, title, lyrics, line_ids, author, copyright, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        this.env.newId(),
        song.id,
        song.revision,
        song.title,
        song.lyrics,
        JSON.stringify(song.lineIds),
        song.author,
        song.copyright,
        song.updatedAt,
      ],
    };
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
      revision: 1,
      createdAt: now,
      updatedAt: now,
      removedAt: null,
    };
    await this.db.batch([
      {
        sql: `INSERT INTO song (id, workspace_id, title, lyrics, line_ids, author, copyright, revision, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          song.id,
          workspaceId,
          song.title,
          song.lyrics,
          JSON.stringify(song.lineIds),
          song.author,
          song.copyright,
          1,
          now,
          now,
        ],
      },
      this.revisionInsert(song),
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
      next.copyright === current.copyright;
    if (unchanged) return current;

    next.lineIds = assignLineIds(current, next.lyrics, () => this.env.newId());
    next.revision = current.revision + 1;
    next.updatedAt = this.env.now();
    await this.db.batch([
      {
        sql: `UPDATE song SET title = ?, lyrics = ?, line_ids = ?, author = ?, copyright = ?, revision = ?, updated_at = ?
              WHERE id = ?`,
        params: [
          next.title,
          next.lyrics,
          JSON.stringify(next.lineIds),
          next.author,
          next.copyright,
          next.revision,
          next.updatedAt,
          id,
        ],
      },
      this.revisionInsert(next),
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
   * Songs in the library, by title. Every word of `search` must appear in the title or the
   * lyrics; matching is by substring, so it works for text without spaces such as Chinese.
   */
  async listSongs(workspaceId: string, search = ''): Promise<Song[]> {
    const terms = search.trim().split(/\s+/).filter(Boolean);
    const where = terms.map(() => `(title LIKE ? ESCAPE '\\' OR lyrics LIKE ? ESCAPE '\\')`);
    const params: SqlValue[] = [workspaceId];
    for (const term of terms) params.push(likePattern(term), likePattern(term));
    const rows = await this.db.select<Row>(
      `SELECT * FROM song WHERE workspace_id = ? AND removed_at IS NULL
       ${where.map((clause) => `AND ${clause}`).join(' ')}
       ORDER BY title COLLATE NOCASE, created_at`,
      params,
    );
    return rows.map(toSong);
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
              SET font_family = ?, scale = ?, background_color = ?, background_asset_id = ?, target = ?,
                  revision = ?, updated_at = ?
              WHERE id = ?`,
        params: [
          next.fontFamily,
          next.scale,
          next.backgroundColor,
          next.backgroundAssetId,
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
