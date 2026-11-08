import { assignLineIds } from '@worship-q/lyrics';
import {
  ChurchSettingsSchema,
  DEFAULT_PRESENTATION_SETTINGS,
  invalidSongFields,
  libraryTypeOf,
  LiveStateSchema,
  OutputProfileSchema,
  OutputTargetSchema,
  PresentationSettingsSchema,
  type BackgroundAsset,
  type BackgroundKind,
  type ChurchSettings,
  type Deck,
  type IsoDate,
  type LibraryType,
  type LiveState,
  type OutputKind,
  type OutputProfile,
  type PresentationSettings,
  type RunSheet,
  type RunSheetItem,
  type Song,
  type SongBackground,
  type SongFields,
  type SongRevision,
  type Video,
  type Website,
  type Workspace,
  VideoSchema,
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
const songBackground = (row: Row) =>
  row.background_color == null
    ? null
    : { color: String(row.background_color), assetId: optional(row.background_asset_id) };
const json = <T>(value: SqlValue | undefined, fallback: T): T => {
  try {
    return value == null ? fallback : (JSON.parse(String(value)) as T);
  } catch {
    return fallback;
  }
};

/**
 * A video stored as JSON, or received from another device; null when there is none or it is
 * unreadable. One saved before Autoplay existed has it off (U23).
 */
export function videoOf(value: unknown): Video | null {
  let data = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = VideoSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

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

/** The columns that make up a song's content, shared by `song`, `song_revision` and `church_version`. */
const CONTENT_COLUMNS = [
  'title',
  'lyrics',
  'line_ids',
  'author',
  'copyright',
  'ccli',
  'year',
  'background_color',
  'background_asset_id',
  'deck',
  'website',
  'video',
] as const;

/**
 * A song with the church's version beside it, when the workspace has its own (D31). The
 * `cv_` columns are null for a song with one version.
 */
const SONG_SELECT = `SELECT song.*, cv.revision AS cv_revision, cv.updated_at AS cv_updated_at,
    ${CONTENT_COLUMNS.map((column) => `cv.${column} AS cv_${column}`).join(', ')}
  FROM song LEFT JOIN church_version cv ON cv.song_id = song.id`;

function songContent(row: Row, prefix = ''): SongFields & { lineIds: string[] } {
  const at = (column: string) => row[`${prefix}${column}`];
  return {
    title: text(at('title')),
    lyrics: text(at('lyrics')),
    lineIds: json<string[]>(at('line_ids'), []),
    author: text(at('author')),
    copyright: text(at('copyright')),
    ccli: optional(at('ccli')),
    year: optionalNumber(at('year')),
    background:
      at('background_color') == null
        ? null
        : { color: text(at('background_color')), assetId: optional(at('background_asset_id')) },
    deck: json<Deck | null>(at('deck'), null),
    website: json<Website | null>(at('website'), null),
    video: videoOf(at('video')),
  };
}

const originOf = (value: SqlValue | undefined): Song['origin'] =>
  value === 'church' || value === 'workspace' ? value : null;

/**
 * The song as the workspace presents it: its own content, or the church's version when the
 * workspace chose that (D32). The identity, dates and removal are always the song's own.
 */
function toSong(row: Row): Song {
  const hasChurch = row.cv_revision != null;
  const useChurch = hasChurch && Number(row.use_church_version) === 1;
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    ...songContent(row, useChurch ? 'cv_' : ''),
    revision: Number(row.revision),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    removedAt: optional(row.removed_at),
    origin: originOf(row.origin),
    useChurchVersion: useChurch,
    versions: hasChurch
      ? {
          own: { revision: Number(row.revision), updatedAt: text(row.updated_at) },
          church: { revision: Number(row.cv_revision), updatedAt: text(row.cv_updated_at) },
        }
      : null,
  };
}

/** The church's version of a two-version song, as a song of its own for showing. */
function toChurchVersion(row: Row): Song | null {
  if (row.cv_revision == null) return null;
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    ...songContent(row, 'cv_'),
    revision: Number(row.cv_revision),
    createdAt: text(row.created_at),
    updatedAt: text(row.cv_updated_at),
    removedAt: null,
    origin: 'church',
    useChurchVersion: false,
    versions: null,
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
    background: songBackground(row),
    deck: json<Deck | null>(row.deck, null),
    website: json<Website | null>(row.website, null),
    video: videoOf(row.video),
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
    origin: originOf(row.origin),
  };
}

function toOutputProfile(row: Row): OutputProfile {
  const target = OutputTargetSchema.safeParse(json<unknown>(row.target, null));
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id),
    kind: text(row.kind) === 'subtitle' ? 'subtitle' : 'slideshow',
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

/** What an output looks like. Synchronized as a workspace setting, unlike its screen. */
const OUTPUT_LOOK_KEYS = ['fontFamily', 'scale', 'backgroundColor', 'backgroundAssetId'] as const;
const OutputLookSchema = OutputProfileSchema.pick({
  fontFamily: true,
  scale: true,
  backgroundColor: true,
  backgroundAssetId: true,
});
const outputLookKey = (kind: OutputKind) => `outputLook.${kind}`;

/**
 * A song's background is the workspace's choice, kept as a setting rather than in the
 * song, so choosing one never makes a version of a church song. The value is
 * `{ backgroundColor, backgroundAssetId }`, or null for the slideshow background.
 */
export const songBackgroundKey = (songId: string) => `songBackground.${songId}`;

/** A stored song background setting: undefined when there is none, else the background. */
function parseSongBackground(value: SqlValue | undefined): SongBackground | null | undefined {
  if (value === undefined) return undefined;
  const parsed = json<unknown>(value, null);
  if (parsed === null || typeof parsed !== 'object') return null;
  const { backgroundColor, backgroundAssetId } = parsed as Record<string, unknown>;
  if (typeof backgroundColor !== 'string') return null;
  return {
    color: backgroundColor,
    assetId: typeof backgroundAssetId === 'string' ? backgroundAssetId : null,
  };
}

function songBackgroundStatement(
  workspaceId: string,
  songId: string,
  background: SongBackground | null,
  now: string,
): Statement {
  const value = background
    ? { backgroundColor: background.color, backgroundAssetId: background.assetId }
    : null;
  return {
    sql: `INSERT INTO setting (workspace_id, key, value, revision, updated_at) VALUES (?, ?, ?, 1, ?)
          ON CONFLICT (workspace_id, key) DO UPDATE
          SET value = excluded.value, revision = setting.revision + 1, updated_at = excluded.updated_at`,
    params: [workspaceId, songBackgroundKey(songId), JSON.stringify(value), now],
  };
}

/** The setting that pins a song to the top of the library for the whole workspace. */
export const songPinKey = (songId: string) => `songPin.${songId}`;
const SONG_PIN_PREFIX = songPinKey('');

export type CopyMode = 'append' | 'replace';

/** Data access for one local database. Every write in the app goes through here. */
export class Store {
  /**
   * The Church Library types this workspace manages, as the instance last said. Its items of
   * these types are the church's, and editing one edits the church's rather than making a
   * version of the workspace's own (D31). Set from the sync state; empty without a church.
   */
  managedLibraryTypes: ReadonlySet<LibraryType> = new Set();

  /** Whether the workspace manages a song's or background's type in the Church Library. */
  managesChurch(
    kind: 'song' | 'background',
    data?: { deck?: unknown; website?: unknown; video?: unknown } | null,
  ): boolean {
    const type = libraryTypeOf(kind, data);
    return type !== null && this.managedLibraryTypes.has(type);
  }

  constructor(
    readonly db: SqlDriver,
    readonly env: StoreEnv,
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

  async setWorkspaceName(workspaceId: string, name: string): Promise<Workspace> {
    await this.db.batch([
      {
        sql: `UPDATE workspace SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND name <> ?`,
        params: [name, this.env.now(), workspaceId, name],
      },
    ]);
    return (await this.getWorkspace())!;
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
      sql: `INSERT INTO song_revision (id, song_id, revision, title, lyrics, line_ids, author, copyright, ccli, year,
              background_color, background_asset_id, deck, website, video, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        song.background?.color ?? null,
        song.background?.assetId ?? null,
        song.deck ? JSON.stringify(song.deck) : null,
        song.website ? JSON.stringify(song.website) : null,
        song.video ? JSON.stringify(song.video) : null,
        song.updatedAt,
      ],
    };
  }

  /** Stores the search keys of a song, replacing earlier ones. */
  searchUpsert(song: Pick<Song, 'id' | 'title' | 'lyrics'>): Statement {
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
      background: fields.background ?? null,
      deck: fields.deck ?? null,
      website: fields.website ?? null,
      video: fields.video ?? null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      removedAt: null,
      // A new song of a type the workspace manages is the church's; elsewhere the instance
      // says.
      origin: this.managesChurch('song', fields) ? 'church' : null,
      useChurchVersion: false,
      versions: null,
    };
    this.validate(song);
    await this.db.batch([
      {
        sql: `INSERT INTO song (id, workspace_id, title, lyrics, line_ids, author, copyright, ccli, year,
                background_color, background_asset_id, deck, website, video, revision, created_at, updated_at, origin)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          song.background?.color ?? null,
          song.background?.assetId ?? null,
          song.deck ? JSON.stringify(song.deck) : null,
          song.website ? JSON.stringify(song.website) : null,
          song.video ? JSON.stringify(song.video) : null,
          1,
          now,
          now,
          song.origin,
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
    // What the operator sees and edits: the version in use (D32).
    const current = await this.getSong(id);
    if (!current) throw new Error(`Song ${id} does not exist`);
    const next: Song = { ...current, ...fields };
    const unchanged =
      next.title === current.title &&
      next.lyrics === current.lyrics &&
      next.author === current.author &&
      next.copyright === current.copyright &&
      next.ccli === current.ccli &&
      next.year === current.year &&
      next.background?.color === current.background?.color &&
      next.background?.assetId === current.background?.assetId &&
      JSON.stringify(next.deck) === JSON.stringify(current.deck) &&
      JSON.stringify(next.website) === JSON.stringify(current.website) &&
      JSON.stringify(next.video) === JSON.stringify(current.video);
    if (unchanged) return current;
    this.validate(next);

    next.lineIds = assignLineIds(current, next.lyrics, () => this.env.newId());
    next.revision = current.revision + 1;
    next.updatedAt = this.env.now();
    const statements: Statement[] = [];
    // Editing a church song in a workspace that does not manage the Church Library makes
    // the workspace's own version of it; the church's is kept beside it (D31). An edit made
    // while the church's version was in use goes into the workspace's version, which is
    // then the one in use (D32).
    const makesVersion = current.origin === 'church' && !this.managesChurch('song', current);
    if (makesVersion) statements.push(this.keepChurchVersion(id));
    // Moving from the church's version to the workspace's keeps the background shown, as
    // switching versions does.
    if (
      current.useChurchVersion &&
      (await this.getSongBackgroundSetting(current.workspaceId, id)) === undefined
    ) {
      statements.push(
        songBackgroundStatement(current.workspaceId, id, current.background, next.updatedAt),
      );
    }
    next.origin = makesVersion ? 'workspace' : current.origin;
    next.useChurchVersion = false;
    next.versions = makesVersion
      ? {
          own: { revision: next.revision, updatedAt: next.updatedAt },
          church: { revision: current.revision, updatedAt: current.updatedAt },
        }
      : current.versions && {
          ...current.versions,
          own: { revision: next.revision, updatedAt: next.updatedAt },
        };
    statements.push(
      {
        sql: `UPDATE song SET title = ?, lyrics = ?, line_ids = ?, author = ?, copyright = ?, ccli = ?, year = ?,
                background_color = ?, background_asset_id = ?, deck = ?, website = ?, video = ?, revision = ?,
                updated_at = ?, origin = ?, use_church_version = 0
              WHERE id = ?`,
        params: [
          next.title,
          next.lyrics,
          JSON.stringify(next.lineIds),
          next.author,
          next.copyright,
          next.ccli,
          next.year,
          next.background?.color ?? null,
          next.background?.assetId ?? null,
          next.deck ? JSON.stringify(next.deck) : null,
          next.website ? JSON.stringify(next.website) : null,
          next.video ? JSON.stringify(next.video) : null,
          next.revision,
          next.updatedAt,
          next.origin,
          id,
        ],
      },
      this.revisionInsert(next),
      this.searchUpsert(next),
    );
    await this.db.batch(statements);
    return next;
  }

  /** Copies the song's row, which holds the church's content, into `church_version`. */
  keepChurchVersionStatement(id: string): Statement {
    return this.keepChurchVersion(id);
  }

  private keepChurchVersion(id: string): Statement {
    const columns = CONTENT_COLUMNS.join(', ');
    return {
      sql: `INSERT OR REPLACE INTO church_version (song_id, ${columns}, revision, updated_at)
            SELECT id, ${columns}, revision, updated_at FROM song WHERE id = ?`,
      params: [id],
    };
  }

  /**
   * On a song with two versions, chooses which one this workspace presents (D32). The
   * choice synchronizes like an edit, so every device of the workspace agrees.
   */
  async setUseChurchVersion(id: string, useChurchVersion: boolean): Promise<Song> {
    const current = await this.getSong(id);
    if (!current) throw new Error(`Song ${id} does not exist`);
    if (!current.versions) throw new Error(`Song ${id} has one version`);
    if (current.useChurchVersion === useChurchVersion) return current;
    const now = this.env.now();
    // The background stays as it is: with none chosen yet, the one of the version in use is
    // kept as the workspace's choice, so switching does not bring the other's.
    const pin =
      (await this.getSongBackgroundSetting(current.workspaceId, id)) === undefined
        ? [songBackgroundStatement(current.workspaceId, id, current.background, now)]
        : [];
    await this.db.batch([
      ...pin,
      {
        sql: `UPDATE song SET use_church_version = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
        params: [useChurchVersion ? 1 : 0, now, id],
      },
    ]);
    const next = (await this.getSong(id))!;
    await this.db.batch([this.searchUpsert(next)]);
    return next;
  }

  /** The workspace's chosen background for a song: undefined when it has chosen none. */
  async getSongBackgroundSetting(
    workspaceId: string,
    songId: string,
  ): Promise<SongBackground | null | undefined> {
    const rows = await this.db.select<{ value: string }>(
      'SELECT value FROM setting WHERE workspace_id = ? AND key = ?',
      [workspaceId, songBackgroundKey(songId)],
    );
    return parseSongBackground(rows[0]?.value);
  }

  /**
   * The background a song is shown on: the workspace's choice, else the one the song itself
   * carries from before backgrounds were the workspace's; null is the slideshow background.
   */
  async getSongBackground(song: Song): Promise<SongBackground | null> {
    const chosen = await this.getSongBackgroundSetting(song.workspaceId, song.id);
    return chosen === undefined ? song.background : chosen;
  }

  /** Chooses a song's background for the workspace; null is the slideshow background. */
  async setSongBackground(
    workspaceId: string,
    songId: string,
    background: SongBackground | null,
  ): Promise<void> {
    await this.db.batch([songBackgroundStatement(workspaceId, songId, background, this.env.now())]);
  }

  /** The workspace's own version of a two-version song, whichever is in use. */
  async getOwnVersion(id: string): Promise<Song | null> {
    const rows = await this.db.select<Row>(`${SONG_SELECT} WHERE song.id = ?`, [id]);
    const row = rows[0];
    if (!row) return null;
    return toSong({ ...row, use_church_version: 0 });
  }

  /** The church's version of a two-version song, for showing beside the workspace's. */
  async getChurchVersion(id: string): Promise<Song | null> {
    const rows = await this.db.select<Row>(`${SONG_SELECT} WHERE song.id = ?`, [id]);
    return rows[0] ? toChurchVersion(rows[0]) : null;
  }

  /**
   * Removes a song from the library. Run sheets that use it keep their item, which still
   * resolves to the song's last saved lyrics.
   */
  async removeSong(id: string): Promise<void> {
    const now = this.env.now();
    const current = await this.getSong(id);
    // Removing a church song hides it in this workspace only: the removal is the
    // workspace's own record of the song (spec §5), with the church's kept beside it.
    const hides = current?.origin === 'church' && !this.managesChurch('song', current);
    await this.db.batch([
      ...(hides ? [this.keepChurchVersion(id)] : []),
      {
        sql: `UPDATE song SET removed_at = ?, revision = revision + 1, updated_at = ?,
                origin = coalesce(?, origin), use_church_version = 0
              WHERE id = ? AND removed_at IS NULL`,
        params: [now, now, hides ? 'workspace' : null, id],
      },
    ]);
  }

  /** The songs pinned to the top of the workspace's library. */
  async pinnedSongIds(workspaceId: string): Promise<Set<string>> {
    const rows = await this.db.select<{ key: string; value: string }>(
      `SELECT key, value FROM setting WHERE workspace_id = ? AND substr(key, 1, ?) = ?`,
      [workspaceId, SONG_PIN_PREFIX.length, SONG_PIN_PREFIX],
    );
    return new Set(
      rows
        .filter((row) => json<unknown>(row.value, false) === true)
        .map((row) => row.key.slice(SONG_PIN_PREFIX.length)),
    );
  }

  /**
   * Pins a song to the top of the library, or unpins it, for the whole workspace. Unpinning
   * keeps the setting as false, so the change reaches the other computers.
   */
  async setSongPinned(workspaceId: string, songId: string, pinned: boolean): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO setting (workspace_id, key, value, revision, updated_at) VALUES (?, ?, ?, 1, ?)
              ON CONFLICT (workspace_id, key) DO UPDATE
              SET value = excluded.value, revision = setting.revision + 1, updated_at = excluded.updated_at`,
        params: [workspaceId, songPinKey(songId), JSON.stringify(pinned), this.env.now()],
      },
    ]);
  }

  /** Any song by identifier, including one removed from the library, as the workspace presents it. */
  async getSong(id: string): Promise<Song | null> {
    const rows = await this.db.select<Row>(`${SONG_SELECT} WHERE song.id = ?`, [id]);
    return rows[0] ? toSong(rows[0]) : null;
  }

  /**
   * Songs in the library. With a search, every term must match the title or the lyrics by
   * Chinese characters in either script, by sound, by pinyin or by pinyin initials; songs are
   * ordered by how well they match (see `rankSong`), then by title. Without a search, pinned
   * songs come first.
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
      `${SONG_SELECT.replace(
        'FROM song',
        `, s.title_text, s.title_pinyin, s.title_initials,
              s.lyrics_text, s.lyrics_pinyin, s.lyrics_initials
       FROM song ${terms.length > 0 ? 'JOIN' : 'LEFT JOIN'} song_search s ON s.song_id = song.id`,
      )}
       WHERE song.workspace_id = ? AND song.removed_at IS NULL
       ${where.map((clause) => `AND ${clause}`).join(' ')}`,
      params,
    );
    // Ordered by the title in use, which may be the church's (D32).
    const songs = rows.map((row) => ({ song: toSong(row), row }));
    songs.sort(
      (a, b) =>
        a.song.title.localeCompare(b.song.title, undefined, { sensitivity: 'accent' }) ||
        a.song.createdAt.localeCompare(b.song.createdAt),
    );
    if (terms.length === 0) {
      const pinned = await this.pinnedSongIds(workspaceId);
      return [
        ...songs.filter(({ song }) => pinned.has(song.id)),
        ...songs.filter(({ song }) => !pinned.has(song.id)),
      ].map(({ song }) => song);
    }
    return songs
      .map(({ song, row }) => ({ song, rank: rankSong(terms, toSongKeys(row)) ?? Infinity }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ song }) => song);
  }

  /**
   * Builds search keys for songs that have none, or whose keys an older search version made.
   * Run at startup, after migrating.
   */
  async refreshSearchIndex(): Promise<number> {
    const rows = await this.db.select<Row>(
      `${SONG_SELECT.replace('FROM song', 'FROM song LEFT JOIN song_search s ON s.song_id = song.id')}
       WHERE s.song_id IS NULL OR s.version <> ?`,
      [SEARCH_VERSION],
    );
    const BATCH = 200;
    for (let start = 0; start < rows.length; start += BATCH) {
      await this.db.batch(
        rows.slice(start, start + BATCH).map((row) => this.searchUpsert(toSong(row))),
      );
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

  /**
   * The videos of run sheets dated `from` or later, each with the earliest such date, earliest
   * first (U8). A song removed from the library still counts, as its run sheets present it.
   */
  async videosFrom(workspaceId: string, from: IsoDate): Promise<{ file: string; date: IsoDate }[]> {
    const rows = await this.db.select<{ song_id: string; date: string }>(
      `SELECT run_sheet_item.song_id AS song_id, MIN(run_sheet.date) AS date FROM run_sheet_item
       JOIN run_sheet ON run_sheet.id = run_sheet_item.run_sheet_id
       WHERE run_sheet.workspace_id = ? AND run_sheet.date >= ?
       GROUP BY run_sheet_item.song_id ORDER BY date`,
      [workspaceId, from],
    );
    const earliest = new Map<string, IsoDate>();
    for (const row of rows) {
      const file = (await this.getSong(row.song_id))?.video?.file;
      if (file && !earliest.has(file)) earliest.set(file, row.date);
    }
    return [...earliest]
      .map(([file, date]) => ({ file, date }))
      .sort((a, b) => a.date.localeCompare(b.date));
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

  /**
   * Adds a song to a run sheet, at `index` or else at the end. The same song may be added
   * more than once.
   */
  async addItem(runSheetId: string, songId: string, index?: number): Promise<RunSheetItem> {
    const now = this.env.now();
    const items = await this.listItems(runSheetId);
    const at = Math.max(0, Math.min(items.length, index ?? items.length));
    const item = this.newItem(runSheetId, songId, at, now);
    items.splice(at, 0, item);
    await this.db.batch([
      ...this.reposition(items, now),
      this.itemInsert(item),
      this.touchRunSheet(runSheetId, now),
    ]);
    return item;
  }

  /**
   * Puts a removed item back at its old position, under its own identifier, so a live state
   * presenting it follows it again. Nothing happens if the item or its run sheet is gone.
   */
  async restoreItem(item: RunSheetItem): Promise<boolean> {
    if (!(await this.getRunSheet(item.runSheetId))) return false;
    const existing = await this.db.select<Row>('SELECT 1 FROM run_sheet_item WHERE id = ?', [
      item.id,
    ]);
    if (existing.length > 0) return false;
    const now = this.env.now();
    const items = await this.listItems(item.runSheetId);
    const at = Math.max(0, Math.min(items.length, item.position));
    const restored = { ...item, position: at, revision: item.revision + 1, updatedAt: now };
    items.splice(at, 0, restored);
    await this.db.batch([
      ...this.reposition(items, now),
      this.itemInsert(restored),
      this.touchRunSheet(item.runSheetId, now),
    ]);
    return true;
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

  /** Settings this workspace sets itself, without the church defaults. */
  async getWorkspaceSettings(workspaceId: string): Promise<Partial<PresentationSettings>> {
    const rows = await this.db.select<{ key: string; value: string }>(
      'SELECT key, value FROM setting WHERE workspace_id = ?',
      [workspaceId],
    );
    const stored: Record<string, unknown> = {};
    for (const row of rows) stored[row.key] = json<unknown>(row.value, undefined);
    const own: Record<string, unknown> = {};
    for (const key of Object.keys(
      DEFAULT_PRESENTATION_SETTINGS,
    ) as (keyof PresentationSettings)[]) {
      const candidate = PresentationSettingsSchema.shape[key].safeParse(stored[key]);
      if (candidate.success) own[key] = candidate.data;
    }
    return own as Partial<PresentationSettings>;
  }

  /**
   * The settings in effect: the workspace's own, else the church default, else the built-in
   * default.
   */
  async getPresentationSettings(workspaceId: string): Promise<PresentationSettings> {
    const church = await this.getChurchSettings();
    const inherited: Partial<PresentationSettings> = {};
    if (church.linesPerPiece !== undefined) inherited.linesPerPiece = church.linesPerPiece;
    if (church.wrapLongLines !== undefined) inherited.wrapLongLines = church.wrapLongLines;
    return {
      ...DEFAULT_PRESENTATION_SETTINGS,
      ...inherited,
      ...(await this.getWorkspaceSettings(workspaceId)),
    };
  }

  /**
   * Sets workspace settings. A null value stops overriding the church default; it is stored
   * rather than deleted so that the change reaches other devices.
   */
  async updatePresentationSettings(
    workspaceId: string,
    patch: { [K in keyof PresentationSettings]?: PresentationSettings[K] | null },
  ): Promise<PresentationSettings> {
    const valid = PresentationSettingsSchema.partial().parse(
      Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)),
    );
    const cleared = Object.fromEntries(
      Object.entries(patch)
        .filter(([key, value]) => value === null && key in DEFAULT_PRESENTATION_SETTINGS)
        .map(([key]) => [key, null]),
    );
    const now = this.env.now();
    const statements = Object.entries({ ...valid, ...cleared })
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

  async getChurchSettings(): Promise<ChurchSettings> {
    const rows = await this.db.select<{ key: string; value: string }>(
      'SELECT key, value FROM church_setting',
    );
    const stored: Record<string, unknown> = {};
    for (const row of rows) stored[row.key] = json<unknown>(row.value, undefined);
    const parsed: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(ChurchSettingsSchema.shape)) {
      const candidate = schema.safeParse(stored[key]);
      if (candidate.success && candidate.data !== undefined) parsed[key] = candidate.data;
    }
    return parsed as ChurchSettings;
  }

  /** Replaces the church defaults with those last received from the instance. */
  async setChurchSettings(settings: ChurchSettings): Promise<void> {
    const valid = ChurchSettingsSchema.parse(settings);
    await this.db.batch([
      { sql: 'DELETE FROM church_setting' },
      ...Object.entries(valid)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({
          sql: 'INSERT INTO church_setting (key, value) VALUES (?, ?)',
          params: [key, JSON.stringify(value)] as SqlValue[],
        })),
    ]);
  }

  /**
   * Forgets the church defaults, after leaving the church. What the workspace took from them
   * becomes its own choice, so nothing on screen changes.
   */
  async dropChurchSettings(): Promise<void> {
    const church = await this.getChurchSettings();
    const workspace = await this.getWorkspace();
    if (workspace) {
      const own = await this.getWorkspaceSettings(workspace.id);
      const patch: Partial<PresentationSettings> = {};
      if (own.linesPerPiece === undefined && church.linesPerPiece !== undefined) {
        patch.linesPerPiece = church.linesPerPiece;
      }
      if (own.wrapLongLines === undefined && church.wrapLongLines !== undefined) {
        patch.wrapLongLines = church.wrapLongLines;
      }
      if (Object.keys(patch).length > 0) {
        await this.updatePresentationSettings(workspace.id, patch);
      }
      const fonts = [
        ['slideshow', church.slideshowFontFamily],
        ['subtitle', church.subtitleFontFamily],
      ] as const;
      for (const [kind, font] of fonts) {
        if (!font) continue;
        const profile = await this.getOutputProfile(workspace.id, kind);
        if (!profile.fontFamily) {
          await this.updateOutputProfile(workspace.id, { fontFamily: font }, kind);
        }
      }
    }
    await this.db.batch([{ sql: 'DELETE FROM church_setting' }]);
  }

  // ── Backgrounds ──────────────────────────────────────────────────────────

  /** Records a background whose file has already been copied into the app's storage. */
  async addBackground(
    workspaceId: string,
    asset: { id: string; kind: BackgroundKind; fileName: string; originalName: string },
  ): Promise<BackgroundAsset> {
    const now = this.env.now();
    const origin = this.managesChurch('background') ? 'church' : null;
    await this.db.batch([
      {
        sql: `INSERT INTO background_asset (id, workspace_id, kind, file_name, original_name, created_at, origin)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          asset.id,
          workspaceId,
          asset.kind,
          asset.fileName,
          asset.originalName,
          now,
          origin,
        ],
      },
    ]);
    return { ...asset, workspaceId, createdAt: now, removedAt: null, origin };
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
      {
        sql: `UPDATE setting SET value = json_set(value, '$.backgroundAssetId', json('null')),
                revision = revision + 1, updated_at = ?
              WHERE key LIKE 'outputLook.%' AND json_extract(value, '$.backgroundAssetId') = ?`,
        params: [now, id],
      },
    ]);
  }

  // ── Output profile ───────────────────────────────────────────────────────

  /** An output's settings, created with defaults on first use. */
  async getOutputProfile(
    workspaceId: string,
    kind: OutputKind = 'slideshow',
  ): Promise<OutputProfile> {
    const query = `SELECT * FROM output_profile WHERE workspace_id = ? AND kind = ?`;
    let rows = await this.db.select<Row>(query, [workspaceId, kind]);
    if (!rows[0]) {
      await this.db.batch([
        {
          sql: `INSERT INTO output_profile (id, workspace_id, kind, font_family, scale, background_color, revision, updated_at)
                VALUES (?, ?, ?, NULL, 1, '#000000', 1, ?)
                ON CONFLICT (workspace_id, kind) DO NOTHING`,
          params: [this.env.newId(), workspaceId, kind, this.env.now()],
        },
      ]);
      rows = await this.db.select<Row>(query, [workspaceId, kind]);
    }
    const look = await this.db.select<{ value: string }>(
      'SELECT value FROM setting WHERE workspace_id = ? AND key = ?',
      [workspaceId, outputLookKey(kind)],
    );
    const shared = OutputLookSchema.partial().safeParse(json<unknown>(look[0]?.value, {}));
    return { ...toOutputProfile(rows[0]!), ...(shared.success ? shared.data : {}) };
  }

  async updateOutputProfile(
    workspaceId: string,
    patch: OutputProfilePatch,
    kind: OutputKind = 'slideshow',
  ): Promise<OutputProfile> {
    const current = await this.getOutputProfile(workspaceId, kind);
    const next = OutputProfileSchema.parse({
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: this.env.now(),
    });
    const statements: Statement[] = [];
    if (OUTPUT_LOOK_KEYS.some((key) => key in patch && patch[key] !== current[key])) {
      // The look is shared by every computer of the workspace; the screen stays this one's.
      const look = Object.fromEntries(OUTPUT_LOOK_KEYS.map((key) => [key, next[key]]));
      statements.push({
        sql: `INSERT INTO setting (workspace_id, key, value, revision, updated_at) VALUES (?, ?, ?, 1, ?)
              ON CONFLICT (workspace_id, key) DO UPDATE
              SET value = excluded.value, revision = setting.revision + 1, updated_at = excluded.updated_at`,
        params: [workspaceId, outputLookKey(kind), JSON.stringify(look), next.updatedAt],
      });
    }
    await this.db.batch([
      ...statements,
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

  // ── Remote-control grants ────────────────────────────────────────────────

  async addRemoteGrant(
    workspaceId: string,
    grant: { id: string; secretHash: string; name: string; createdAt?: string },
  ): Promise<void> {
    const now = this.env.now();
    await this.db.batch([
      {
        // A grant already known, for example from the coordinator's list, is kept as it is.
        sql: `INSERT INTO remote_grant (id, workspace_id, secret_hash, name, created_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET revoked_at = NULL`,
        params: [grant.id, workspaceId, grant.secretHash, grant.name, grant.createdAt ?? now, now],
      },
    ]);
  }

  /** The workspace's unrevoked grants, as shared between its operator devices (D25). */
  async listRemoteGrants(
    workspaceId: string,
  ): Promise<{ id: string; secretHash: string; name: string; createdAt: string }[]> {
    const rows = await this.db.select<Row>(
      'SELECT * FROM remote_grant WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at',
      [workspaceId],
    );
    return rows.map((row) => ({
      id: text(row.id),
      secretHash: text(row.secret_hash),
      name: text(row.name),
      createdAt: text(row.created_at),
    }));
  }

  /** An unrevoked grant of the workspace, recording that it was used. */
  async useRemoteGrant(
    workspaceId: string,
    id: string,
  ): Promise<{ secretHash: string; name: string } | null> {
    const rows = await this.db.select<Row>(
      'SELECT * FROM remote_grant WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL',
      [id, workspaceId],
    );
    if (!rows[0]) return null;
    await this.db.batch([
      {
        sql: 'UPDATE remote_grant SET last_seen_at = ? WHERE id = ?',
        params: [this.env.now(), id],
      },
    ]);
    return { secretHash: text(rows[0].secret_hash), name: text(rows[0].name) };
  }

  async revokeRemoteGrants(workspaceId: string, id?: string): Promise<void> {
    await this.db.batch([
      {
        sql: `UPDATE remote_grant SET revoked_at = ?
              WHERE workspace_id = ? AND revoked_at IS NULL ${id ? 'AND id = ?' : ''}`,
        params: id ? [this.env.now(), workspaceId, id] : [this.env.now(), workspaceId],
      },
    ]);
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
