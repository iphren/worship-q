/**
 * What an AI assistant may do to a workspace's run sheets and songs (MCP plan, C5–C9), for
 * one signed-in MCP user and only in the workspaces they reach. Everything here is plain
 * TypeScript, so it is tested without the MCP transport; `tools.ts` only describes it.
 *
 * Writes take the path a desktop's push takes: records go through `Instance.push`, then the
 * relay tells the workspace's devices to synchronize. So a change made here reaches every
 * desktop within seconds, exactly as an edit on another computer would.
 */
import { randomUUID } from 'node:crypto';
import {
  catalogueVersion,
  effectiveVersions,
  formatReference,
  parseReference,
  passagePlainText,
  PassageSchema,
  toUsfm,
  type CatalogueVersion,
  type Passage,
  type PassageText,
  type Reference,
} from '@worship-q/bible';
import { addDays, dateInTimeZone, nextMeetingDate } from '@worship-q/calendar';
import { assignLineIds } from '@worship-q/lyrics';
import {
  BibleVersionsSettingSchema,
  cleanSongFields,
  maxSongYear,
  PROTOCOL_VERSION,
  songBadge,
  websiteUrl,
  type ChurchSettings,
  type SyncRecord,
} from '@worship-q/protocol';
import type { Relay } from '@worship-q/relay';
import { parseQuery, rankSong, searchKeys, songKeys, type SongKeys } from '@worship-q/search';
import type { SqlValue } from '../db';
import type { Instance, WorkspaceRow } from '../instance';
import type { McpUserRow } from './access';

/** Items added to a run sheet in one call at most. */
export const MAX_ITEMS_PER_CALL = 30;
/** Songs a search returns at most. */
export const MAX_SEARCH_RESULTS = 50;
/** Titles matched in one call at most. */
export const MAX_MATCH_TITLES = 30;
export const MAX_TITLE_LENGTH = 200;
export const MAX_LYRICS_LENGTH = 50_000;
/** Days before and after today that `listRunSheets` covers when not told. */
export const DEFAULT_RANGE_DAYS = 28;
/** The longest span `listRunSheets` covers at once. */
export const MAX_RANGE_DAYS = 400;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The Bible as this module needs it; the server's `Bible`, or a stand-in in tests. */
export interface McpBible {
  offered(church: ChurchSettings): CatalogueVersion[];
  passages: { get(version: string, reference: Reference): Promise<PassageText> };
  fums: { report(tokens: string[], device: string, session: string): void };
}

export type McpErrorCode =
  | 'no-workspaces'
  | 'workspace-required'
  | 'workspace-not-found'
  | 'invalid-date'
  | 'invalid-range'
  | 'song-not-found'
  | 'item-not-found'
  | 'nothing-to-copy'
  | 'same-date'
  | 'too-many-items'
  | 'no-items'
  | 'invalid-song'
  | 'duplicate-song'
  | 'not-editable'
  | 'revision-conflict'
  | 'invalid-url'
  | 'invalid-reference'
  | 'version-not-offered'
  | 'passage-not-found'
  | 'passage-too-large'
  | 'bible-unavailable';

/** A refusal the assistant can act on: the code, and a sentence saying what to do. */
export class McpToolError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type SongKind = 'song' | 'bible' | 'website' | 'slides' | 'pdf' | 'image' | 'video';

/** One song as the workspace sees it. */
interface VisibleSong {
  id: string;
  revision: number;
  updatedAt: string;
  data: Record<string, unknown>;
  /** Whose record is shown: the Church Library's, or the workspace's own. */
  origin: 'church' | 'workspace';
  /** The workspace's own record, when it has one (possibly using the church's version). */
  own: StoredRecord | null;
  church: StoredRecord | null;
}

interface StoredRecord {
  id: string;
  revision: number;
  updatedAt: string;
  data: Record<string, unknown>;
}

interface RunSheetItemData {
  id: string;
  songId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface RunSheetRecord {
  id: string;
  revision: number;
  updatedAt: string;
  createdAt: string;
  items: RunSheetItemData[];
}

export type ItemInput =
  { song: string } | { passage: string; versions?: string[] } | { website: string; title?: string };

export type Position = 'start' | 'end' | string;

export interface SongFieldsInput {
  title?: string;
  lyrics?: string;
  author?: string;
  copyright?: string;
  ccli?: string | number | null;
  year?: number | null;
}

/** Search keys of songs, kept while the song's revision stays the same. */
export class SongKeyCache {
  private readonly keys = new Map<string, { revision: string; keys: SongKeys }>();

  get(cacheKey: string, revision: string, song: { title: string; lyrics: string }): SongKeys {
    const cached = this.keys.get(cacheKey);
    if (cached?.revision === revision) return cached.keys;
    const keys = songKeys(song);
    this.keys.set(cacheKey, { revision, keys });
    return keys;
  }
}

export interface McpContentDeps {
  instance: Instance;
  relay: Pick<Relay, 'contentChanged' | 'contentChangedAll'>;
  bible?: McpBible | null;
  keyCache?: SongKeyCache;
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const text = (value: SqlValue | undefined) => (value == null ? '' : String(value));
const isRemoved = (data: Record<string, unknown>) =>
  typeof data.removedAt === 'string' && data.removedAt !== '';
const usesChurchVersion = (data: Record<string, unknown>) => data.useChurchVersion === true;

/** A real calendar date, written `YYYY-MM-DD`. */
export function validDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function requireDate(date: unknown, name = 'date'): string {
  if (!validDate(date)) {
    throw new McpToolError('invalid-date', `${name} must be a real date written YYYY-MM-DD`);
  }
  return date;
}

/**
 * Lyrics as the app keeps them: Unix line breaks, no spaces at the ends of lines, blocks
 * separated by exactly one blank line, nothing blank before or after.
 */
export function normalizeLyrics(lyrics: string): string {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\u3000]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

/** A title folded for comparing: both Chinese scripts as one, case and punctuation ignored. */
export function titleKey(title: string): string {
  return searchKeys(title).text;
}

function kindOf(data: Record<string, unknown>): SongKind {
  return (songBadge(data as Parameters<typeof songBadge>[0]) ?? 'song') as SongKind;
}

function parseData(value: SqlValue | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text(value));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toStored(row: Record<string, SqlValue> | undefined): StoredRecord | null {
  if (!row) return null;
  return {
    id: text(row.id),
    revision: Number(row.revision),
    updatedAt: text(row.updated_at),
    data: parseData(row.data),
  };
}

export class McpContent {
  private readonly instance: Instance;
  private readonly keyCache: SongKeyCache;

  constructor(
    private readonly deps: McpContentDeps,
    private readonly user: McpUserRow,
  ) {
    this.instance = deps.instance;
    this.keyCache = deps.keyCache ?? new SongKeyCache();
  }

  // ── Workspaces ───────────────────────────────────────────────────────────

  /** The workspaces this user reaches now; read on every call, so changes apply at once. */
  workspaces(): WorkspaceRow[] {
    const all = this.instance.listWorkspaces();
    if (this.user.allWorkspaces) return all;
    const allowed = new Set(this.user.workspaceIds);
    return all.filter((workspace) => allowed.has(workspace.id));
  }

  /**
   * The workspace a call names, by identifier or by name. One the user may not reach reads
   * the same as one that does not exist. Omitted, it is the user's only workspace.
   */
  workspace(ref: string | undefined | null): WorkspaceRow {
    const reachable = this.workspaces();
    if (reachable.length === 0) {
      throw new McpToolError(
        'no-workspaces',
        'You have no workspaces. Ask an administrator to give you access on the MCP users page.',
      );
    }
    const wanted = (ref ?? '').trim();
    if (!wanted) {
      if (reachable.length === 1) return reachable[0]!;
      throw new McpToolError(
        'workspace-required',
        `Say which workspace: ${reachable.map((w) => `${w.name} (${w.id})`).join(', ')}.`,
        { workspaces: reachable.map((w) => ({ id: w.id, name: w.name })) },
      );
    }
    const byId = reachable.find((w) => w.id === wanted);
    if (byId) return byId;
    const byName = reachable.filter((w) => w.name.toLowerCase() === wanted.toLowerCase());
    if (byName.length === 1) return byName[0]!;
    throw new McpToolError(
      'workspace-not-found',
      `No workspace “${wanted}” that you can reach. Use list_workspaces to see yours.`,
    );
  }

  private settings(workspaceId: string): { timezone: string; meetingDays: number[] } {
    const row = this.instance.db
      .prepare(`SELECT data FROM record WHERE workspace_id = ? AND kind = 'workspace'`)
      .get(workspaceId);
    const data = row ? parseData(row.data) : {};
    let timezone = str(data.timezone) || 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      timezone = 'UTC';
    }
    const meetingDays = Array.isArray(data.meetingDays)
      ? data.meetingDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
      : [0];
    return { timezone, meetingDays };
  }

  /** Today in the workspace's timezone. */
  today(workspaceId: string): string {
    return dateInTimeZone(new Date(this.instance.now()), this.settings(workspaceId).timezone);
  }

  listWorkspaces() {
    return this.workspaces().map((workspace) => {
      const { timezone, meetingDays } = this.settings(workspace.id);
      const today = dateInTimeZone(new Date(this.instance.now()), timezone);
      return {
        id: workspace.id,
        name: workspace.name,
        timezone,
        today,
        todayWeekday: WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()]!,
        meetingDays: meetingDays.map((d) => WEEKDAYS[d]!),
        nextMeetingDate: nextMeetingDate(today, meetingDays),
        managesChurchLibrary: workspace.libraryTypes,
        bibleVersions: this.bibleVersions(workspace.id),
      };
    });
  }

  // ── Songs ────────────────────────────────────────────────────────────────

  private ownSong(workspaceId: string, id: string): StoredRecord | null {
    return toStored(
      this.instance.db
        .prepare(`SELECT * FROM record WHERE workspace_id = ? AND kind = 'song' AND key = ?`)
        .get(workspaceId, id),
    );
  }

  private churchSong(id: string): StoredRecord | null {
    return toStored(
      this.instance.db
        .prepare(`SELECT * FROM church_record WHERE kind = 'song' AND key = ?`)
        .get(id),
    );
  }

  /** What the workspace shows for a song, or null when it has none or hid it. */
  private resolve(own: StoredRecord | null, church: StoredRecord | null): VisibleSong | null {
    const churchLive = church !== null && !isRemoved(church.data);
    if (own) {
      if (isRemoved(own.data)) return null;
      if (usesChurchVersion(own.data) && churchLive) {
        return { ...church, origin: 'church', own, church };
      }
      return { ...own, origin: 'workspace', own, church };
    }
    if (churchLive) return { ...church, origin: 'church', own: null, church };
    return null;
  }

  private visibleSong(workspaceId: string, id: string): VisibleSong | null {
    return this.resolve(this.ownSong(workspaceId, id), this.churchSong(id));
  }

  private requireSong(workspaceId: string, id: string): VisibleSong {
    const song = this.visibleSong(workspaceId, id);
    if (!song) {
      throw new McpToolError(
        'song-not-found',
        `No song ${id} in this workspace. Search for it first.`,
      );
    }
    return song;
  }

  /** Every song of the workspace's library: no passages, nothing deleted or hidden. */
  private library(workspaceId: string): VisibleSong[] {
    const own = new Map<string, StoredRecord>();
    for (const row of this.instance.db
      .prepare(`SELECT * FROM record WHERE workspace_id = ? AND kind = 'song'`)
      .all(workspaceId)) {
      own.set(text(row.key), toStored(row)!);
    }
    const songs: VisibleSong[] = [];
    const seen = new Set<string>();
    for (const row of this.instance.db
      .prepare(`SELECT * FROM church_record WHERE kind = 'song'`)
      .all()) {
      const key = text(row.key);
      seen.add(key);
      const song = this.resolve(own.get(key) ?? null, toStored(row));
      if (song && !song.data.passage) songs.push(song);
    }
    for (const [key, record] of own) {
      if (seen.has(key)) continue;
      const song = this.resolve(record, null);
      if (song && !song.data.passage) songs.push(song);
    }
    return songs;
  }

  private keysOf(workspaceId: string, song: VisibleSong): SongKeys {
    const website = (song.data.website as { url?: unknown } | null)?.url;
    return this.keyCache.get(
      `${song.origin === 'church' ? '' : workspaceId}:${song.id}`,
      `${song.revision}:${song.updatedAt}`,
      {
        title: str(song.data.title),
        lyrics: [str(song.data.lyrics), typeof website === 'string' ? website : ''].join('\n'),
      },
    );
  }

  private summary(song: VisibleSong) {
    const website = song.data.website as { url?: unknown } | null;
    return {
      songId: song.id,
      title: str(song.data.title),
      author: str(song.data.author),
      kind: kindOf(song.data),
      ...(typeof website?.url === 'string' ? { url: website.url } : {}),
    };
  }

  /** As the desktop's song search: either script, pinyin or initials, title before lyrics. */
  searchSongs(workspaceRef: string | undefined, query: string, limit = 20) {
    const workspace = this.workspace(workspaceRef);
    const terms = parseQuery(String(query ?? '').slice(0, 200));
    const max = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(limit) || 20));
    const songs = this.library(workspace.id);
    const ranked =
      terms.length === 0
        ? songs
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((song) => ({ song, rank: 0 }))
        : songs
            .map((song) => ({ song, rank: rankSong(terms, this.keysOf(workspace.id, song)) }))
            .filter((entry): entry is { song: VisibleSong; rank: number } => entry.rank !== null)
            .sort((a, b) => a.rank - b.rank || b.song.updatedAt.localeCompare(a.song.updatedAt));
    return {
      workspaceId: workspace.id,
      total: ranked.length,
      songs: ranked.slice(0, max).map((entry) => this.summary(entry.song)),
    };
  }

  private exactMatches(workspaceId: string, title: string, songs = this.library(workspaceId)) {
    const key = titleKey(title);
    if (!key) return [];
    return songs.filter((song) => titleKey(str(song.data.title)) === key);
  }

  /**
   * For each title, whether the library has it: `exact` when a song's title is the same once
   * script, case, spaces and punctuation are set aside; `likely` when a search for the title
   * finds songs; `none` otherwise.
   */
  matchSongs(workspaceRef: string | undefined, titles: string[]) {
    const workspace = this.workspace(workspaceRef);
    if (titles.length > MAX_MATCH_TITLES) {
      throw new McpToolError('too-many-items', `At most ${MAX_MATCH_TITLES} titles at once.`);
    }
    const songs = this.library(workspace.id);
    return {
      workspaceId: workspace.id,
      matches: titles.map((title) => {
        const exact = this.exactMatches(workspace.id, title, songs);
        if (exact.length > 0) {
          return {
            title,
            match: 'exact' as const,
            candidates: exact.slice(0, 5).map((s) => this.summary(s)),
          };
        }
        const terms = parseQuery(title);
        const likely =
          terms.length === 0
            ? []
            : songs
                .map((song) => ({ song, rank: rankSong(terms, this.keysOf(workspace.id, song)) }))
                .filter(
                  (entry): entry is { song: VisibleSong; rank: number } => entry.rank !== null,
                )
                .sort((a, b) => a.rank - b.rank)
                .slice(0, 5)
                .map((entry) => this.summary(entry.song));
        return {
          title,
          match: likely.length > 0 ? ('likely' as const) : ('none' as const),
          candidates: likely,
        };
      }),
    };
  }

  getSong(workspaceRef: string | undefined, songId: string) {
    const workspace = this.workspace(workspaceRef);
    const song = this.requireSong(workspace.id, songId);
    const d = song.data;
    const passage = d.passage as Passage | null | undefined;
    return {
      ...this.summary(song),
      revision: song.revision,
      updatedAt: song.updatedAt,
      lyrics: str(d.lyrics),
      copyright: str(d.copyright),
      ccli: typeof d.ccli === 'string' ? d.ccli : null,
      year: typeof d.year === 'number' ? d.year : null,
      inChurchLibrary: song.origin === 'church',
      hasWorkspaceVersion: song.own !== null && song.church !== null,
      editable: kindOf(d) === 'song',
      ...(passage
        ? { reference: passage.reference, versions: passage.texts.map((t) => t.version) }
        : {}),
    };
  }

  /** Cleans and checks what an assistant sent for a song; throws on what cannot be fixed. */
  private songFields(input: SongFieldsInput, base: Record<string, unknown>) {
    const ccliInput = input.ccli === undefined ? base.ccli : input.ccli;
    let ccli: string | null = null;
    if (ccliInput !== null && ccliInput !== undefined && String(ccliInput).trim() !== '') {
      const digits = String(ccliInput)
        .replace(/^\s*(ccli)?\s*(song)?\s*(#|no\.?)?\s*/i, '')
        .trim();
      if (!/^\d+$/.test(digits)) {
        throw new McpToolError('invalid-song', 'ccli must be the CCLI song number: digits only.');
      }
      ccli = digits;
    }
    const year =
      input.year === undefined ? ((base.year as number | null | undefined) ?? null) : input.year;
    if (
      year !== null &&
      (!Number.isInteger(year) || year < 1 || year > maxSongYear(new Date(this.instance.now())))
    ) {
      throw new McpToolError(
        'invalid-song',
        'year must be the year the song was written, if known.',
      );
    }
    const cleaned = cleanSongFields({
      title: input.title ?? str(base.title),
      lyrics: normalizeLyrics(input.lyrics ?? str(base.lyrics)),
      author: input.author ?? str(base.author),
      copyright: input.copyright ?? str(base.copyright),
      ccli,
      year,
      background: null,
      deck: null,
      website: null,
      video: null,
      passage: null,
    });
    if (!cleaned.title) throw new McpToolError('invalid-song', 'A song needs a title.');
    if (cleaned.title.length > MAX_TITLE_LENGTH) {
      throw new McpToolError('invalid-song', `A title has at most ${MAX_TITLE_LENGTH} characters.`);
    }
    if (!cleaned.lyrics) throw new McpToolError('invalid-song', 'A song needs lyrics.');
    if (cleaned.lyrics.length > MAX_LYRICS_LENGTH) {
      throw new McpToolError(
        'invalid-song',
        `Lyrics have at most ${MAX_LYRICS_LENGTH} characters.`,
      );
    }
    return {
      title: cleaned.title,
      lyrics: cleaned.lyrics,
      author: cleaned.author.slice(0, 300),
      copyright: cleaned.copyright.slice(0, 300),
      ccli: cleaned.ccli,
      year: cleaned.year,
    };
  }

  /** A timestamp later than every one given, so the write wins over them (clock skew). */
  private stamp(...after: (string | null | undefined)[]): string {
    let ms = Date.parse(this.instance.now());
    for (const value of after) {
      const t = value ? Date.parse(value) : NaN;
      if (!Number.isNaN(t) && t >= ms) ms = t + 1;
    }
    return new Date(ms).toISOString();
  }

  /** The song and revision records of a new song. */
  private newSongRecords(
    fields: Record<string, unknown>,
    now: string,
  ): { id: string; records: SyncRecord[] } {
    const id = randomUUID();
    const lyrics = str(fields.lyrics);
    const data = {
      title: '',
      lyrics,
      lineIds: assignLineIds(null, lyrics, randomUUID),
      author: '',
      copyright: '',
      ccli: null,
      year: null,
      background: null,
      deck: null,
      website: null,
      video: null,
      passage: null,
      ...fields,
      createdAt: now,
      removedAt: null,
    };
    return { id, records: this.songRecords(id, 1, now, data) };
  }

  private songRecords(
    id: string,
    revision: number,
    now: string,
    data: Record<string, unknown>,
  ): SyncRecord[] {
    const revisionId = randomUUID();
    return [
      { kind: 'song', id, key: id, revision, updatedAt: now, data },
      {
        kind: 'songRevision',
        id: revisionId,
        key: revisionId,
        revision: 1,
        updatedAt: now,
        data: { ...data, songId: id, revision },
      },
    ];
  }

  /** Stores records as a desktop's push would, and tells the devices. */
  private write(workspaceId: string, records: SyncRecord[]): void {
    this.instance.claimContent(workspaceId, randomUUID());
    const { stored, central } = this.instance.push(
      workspaceId,
      `mcp:${this.user.id}`,
      records,
      PROTOCOL_VERSION,
    );
    if (central > 0) this.deps.relay.contentChangedAll('');
    else if (stored > 0) this.deps.relay.contentChanged(workspaceId, '');
  }

  createSong(
    workspaceRef: string | undefined,
    input: SongFieldsInput & { allowDuplicate?: boolean },
  ) {
    const workspace = this.workspace(workspaceRef);
    const fields = this.songFields(input, {});
    if (!input.allowDuplicate) {
      const same = this.exactMatches(workspace.id, fields.title);
      if (same.length > 0) {
        throw new McpToolError(
          'duplicate-song',
          `The library already has “${fields.title}”. Use the existing song, or set allowDuplicate if this really is a different song.`,
          { existing: same.slice(0, 5).map((s) => this.summary(s)) },
        );
      }
    }
    const now = this.instance.now();
    const { id, records } = this.newSongRecords(fields, now);
    this.write(workspace.id, records);
    return {
      songId: id,
      title: fields.title,
      revision: 1,
      inChurchLibrary: this.instance.managedTypes(workspace.id).has('songs'),
    };
  }

  /** The highest revision in a song's history, in the workspace and the Church Library. */
  private historyRevision(workspaceId: string, songId: string): number {
    const own = this.instance.db
      .prepare(
        `SELECT MAX(json_extract(data, '$.revision')) AS r FROM record
         WHERE workspace_id = ? AND kind = 'songRevision' AND json_extract(data, '$.songId') = ?`,
      )
      .get(workspaceId, songId);
    const church = this.instance.db
      .prepare(
        `SELECT MAX(json_extract(data, '$.revision')) AS r FROM church_record
         WHERE kind = 'songRevision' AND json_extract(data, '$.songId') = ?`,
      )
      .get(songId);
    return Math.max(Number(own?.r ?? 0) || 0, Number(church?.r ?? 0) || 0);
  }

  /**
   * Edits a song of lyrics. `expectedRevision` is the revision the assistant read, so an edit
   * made meanwhile on a desktop is never overwritten unseen. Editing a church song in a
   * workspace that does not manage songs makes the workspace's own version (D31), as a
   * desktop's edit does.
   */
  updateSong(
    workspaceRef: string | undefined,
    songId: string,
    expectedRevision: number,
    input: SongFieldsInput,
  ) {
    const workspace = this.workspace(workspaceRef);
    const song = this.requireSong(workspace.id, songId);
    if (kindOf(song.data) !== 'song') {
      throw new McpToolError(
        'not-editable',
        'Only songs of lyrics can be edited here; Bible passages, websites, slides and videos cannot.',
      );
    }
    if (song.revision !== expectedRevision) {
      throw new McpToolError(
        'revision-conflict',
        `The song changed since you read it (now revision ${song.revision}). Read it again with get_song and redo the edit.`,
        { revision: song.revision },
      );
    }
    const fields = this.songFields(input, song.data);
    const unchanged = (Object.keys(fields) as (keyof typeof fields)[]).every(
      (key) => (song.data[key] ?? null) === (fields[key] ?? null),
    );
    const createsWorkspaceVersion =
      song.own === null && !this.instance.managedTypes(workspace.id).has('songs');
    if (unchanged) {
      return { songId, revision: song.revision, changed: false, workspaceVersion: false };
    }
    const revision =
      Math.max(
        song.revision,
        song.own?.revision ?? 0,
        song.church?.revision ?? 0,
        this.historyRevision(workspace.id, songId),
      ) + 1;
    const now = this.stamp(song.own?.updatedAt, song.church?.updatedAt);
    const previous = {
      lyrics: str(song.data.lyrics),
      lineIds: Array.isArray(song.data.lineIds) ? (song.data.lineIds as string[]) : [],
    };
    const data: Record<string, unknown> = {
      ...song.data,
      ...fields,
      lineIds: assignLineIds(previous, fields.lyrics, randomUUID),
      createdAt: str(song.data.createdAt) || now,
      removedAt: null,
    };
    // Editing while the church's version is in use edits the workspace's and uses it (D32).
    if (song.own) data.useChurchVersion = false;
    else delete data.useChurchVersion;
    this.write(workspace.id, this.songRecords(songId, revision, now, data));
    return { songId, revision, changed: true, workspaceVersion: createsWorkspaceVersion };
  }

  // ── Run sheets ───────────────────────────────────────────────────────────

  private runSheetRecord(workspaceId: string, date: string): RunSheetRecord | null {
    const row = this.instance.db
      .prepare(`SELECT * FROM record WHERE workspace_id = ? AND kind = 'runSheet' AND key = ?`)
      .get(workspaceId, date);
    if (!row) return null;
    const data = parseData(row.data);
    const items = Array.isArray(data.items)
      ? (data.items as Record<string, unknown>[])
          .filter((item) => typeof item.id === 'string' && typeof item.songId === 'string')
          .map((item) => ({
            id: str(item.id),
            songId: str(item.songId),
            revision: Number(item.revision) || 1,
            createdAt: str(item.createdAt),
            updatedAt: str(item.updatedAt),
          }))
      : [];
    return {
      id: text(row.id),
      revision: Number(row.revision),
      updatedAt: text(row.updated_at),
      createdAt: str(data.createdAt) || text(row.updated_at),
      items,
    };
  }

  private isLive(workspaceId: string, runSheetId: string | undefined): boolean {
    if (!runSheetId) return false;
    return this.instance.getLive(workspaceId)?.snapshot.state.runSheetId === runSheetId;
  }

  listRunSheets(workspaceRef: string | undefined, from?: string, to?: string) {
    const workspace = this.workspace(workspaceRef);
    const today = this.today(workspace.id);
    const start = from ? requireDate(from, 'from') : addDays(today, -DEFAULT_RANGE_DAYS);
    const end = to ? requireDate(to, 'to') : addDays(today, DEFAULT_RANGE_DAYS);
    if (end < start) throw new McpToolError('invalid-range', '`to` must not be before `from`.');
    if (addDays(start, MAX_RANGE_DAYS) < end) {
      throw new McpToolError('invalid-range', `At most ${MAX_RANGE_DAYS} days at once.`);
    }
    const days = this.instance.runSheetDays(workspace.id);
    return {
      workspaceId: workspace.id,
      today,
      liveDate: days?.liveDate ?? null,
      runSheets: (days?.dates ?? []).filter((d) => d.date >= start && d.date <= end),
    };
  }

  private describeItems(workspaceId: string, items: RunSheetItemData[]) {
    return items.map((item) => {
      const song = this.visibleSong(workspaceId, item.songId);
      // A song deleted from the library is still presented by run sheets that hold it.
      const shown = song ?? this.resolveAny(workspaceId, item.songId);
      if (!shown) return { itemId: item.id, songId: item.songId, kind: 'missing', title: '' };
      const website = shown.data.website as { url?: unknown } | null;
      const passage = shown.data.passage as Passage | null | undefined;
      return {
        itemId: item.id,
        songId: item.songId,
        kind: kindOf(shown.data),
        title: str(shown.data.title),
        author: str(shown.data.author),
        ...(typeof website?.url === 'string' ? { url: website.url } : {}),
        ...(passage ? { versions: passage.texts.map((t) => t.version) } : {}),
        ...(song ? {} : { deletedFromLibrary: true }),
      };
    });
  }

  /** A song's record whatever its state, for describing run sheet items. */
  private resolveAny(workspaceId: string, songId: string): StoredRecord | null {
    return this.ownSong(workspaceId, songId) ?? this.churchSong(songId);
  }

  getRunSheet(workspaceRef: string | undefined, date: string) {
    const workspace = this.workspace(workspaceRef);
    const day = requireDate(date);
    const sheet = this.runSheetRecord(workspace.id, day);
    return {
      workspaceId: workspace.id,
      date: day,
      exists: sheet !== null && sheet.items.length > 0,
      revision: sheet?.revision ?? 0,
      live: this.isLive(workspace.id, sheet?.id),
      items: sheet ? this.describeItems(workspace.id, sheet.items) : [],
    };
  }

  private insertIndex(items: RunSheetItemData[], after: Position | undefined): number {
    if (after === undefined || after === 'end') return items.length;
    if (after === 'start') return 0;
    const index = items.findIndex((item) => item.id === after);
    if (index === -1) {
      throw new McpToolError(
        'item-not-found',
        `No item ${after} on this run sheet. Read it again with get_run_sheet.`,
      );
    }
    return index + 1;
  }

  /** Writes a run sheet with its new items, and the new songs they point to, as one push. */
  private writeRunSheet(
    workspaceId: string,
    date: string,
    current: RunSheetRecord | null,
    items: RunSheetItemData[],
    now: string,
    songs: SyncRecord[] = [],
  ) {
    // Items whose place changed are revised, as the desktop does.
    const before = new Map((current?.items ?? []).map((item, index) => [item.id, index]));
    const placed = items.map((item, index) =>
      before.has(item.id) && before.get(item.id) !== index
        ? { ...item, revision: item.revision + 1, updatedAt: now }
        : item,
    );
    const record: SyncRecord = {
      kind: 'runSheet',
      id: current?.id ?? randomUUID(),
      key: date,
      // A new run sheet starts past 1, which reads as one a device only opened.
      revision: current ? current.revision + 1 : 2,
      updatedAt: now,
      data: { date, createdAt: current?.createdAt ?? now, items: placed },
    };
    this.write(workspaceId, [...songs, record]);
    return {
      workspaceId,
      date,
      revision: record.revision,
      live: this.isLive(workspaceId, record.id),
      items: this.describeItems(workspaceId, placed),
    };
  }

  private newItem(songId: string, now: string): RunSheetItemData {
    return { id: randomUUID(), songId, revision: 1, createdAt: now, updatedAt: now };
  }

  /**
   * Adds songs, Bible passages and websites to a date's run sheet, making it if there is
   * none. Everything is checked and fetched first: one item that fails adds nothing.
   */
  async addToRunSheet(
    workspaceRef: string | undefined,
    date: string,
    inputs: ItemInput[],
    after?: Position,
  ) {
    const workspace = this.workspace(workspaceRef);
    const day = requireDate(date);
    if (inputs.length === 0) throw new McpToolError('no-items', 'Give at least one item to add.');
    if (inputs.length > MAX_ITEMS_PER_CALL) {
      throw new McpToolError('too-many-items', `At most ${MAX_ITEMS_PER_CALL} items at once.`);
    }
    // Checked before anything is fetched, so a wrong place costs no Bible request.
    this.insertIndex(this.runSheetRecord(workspace.id, day)?.items ?? [], after);

    const resolved: ({ songId: string } | { fields: Record<string, unknown> })[] = [];
    /** New websites by address, so one given twice is made once. */
    const websites = new Map<string, { fields: Record<string, unknown> }>();
    let library: VisibleSong[] | null = null;
    for (const [index, input] of inputs.entries()) {
      const at = inputs.length > 1 ? ` (item ${index + 1})` : '';
      if ('song' in input) {
        this.requireSong(workspace.id, input.song);
        resolved.push({ songId: input.song });
      } else if ('passage' in input) {
        resolved.push({
          fields: await this.passageFields(workspace.id, input.passage, input.versions, at),
        });
      } else if ('website' in input) {
        const url = websiteUrl(String(input.website ?? ''));
        if (!url) {
          throw new McpToolError(
            'invalid-url',
            `Not a web address${at}: give an http or https link.`,
          );
        }
        library ??= this.library(workspace.id);
        const existing = library.find(
          (song) => (song.data.website as { url?: unknown } | null)?.url === url,
        )?.id;
        if (existing) {
          resolved.push({ songId: existing });
        } else {
          let entry = websites.get(url);
          if (!entry) {
            const title =
              (input.title ?? '').trim().slice(0, MAX_TITLE_LENGTH) || new URL(url).hostname;
            entry = { fields: { title, lyrics: '', website: { url } } };
            websites.set(url, entry);
          }
          resolved.push(entry);
        }
      } else {
        throw new McpToolError('no-items', `Each item is a song, a passage or a website${at}.`);
      }
    }

    // Read again after the fetches: another call may have changed the run sheet meanwhile.
    const current = this.runSheetRecord(workspace.id, day);
    const items = [...(current?.items ?? [])];
    const index = this.insertIndex(items, after);
    const now = this.stamp(current?.updatedAt);
    const songs: SyncRecord[] = [];
    const added: RunSheetItemData[] = [];
    const made = new Map<object, string>();
    for (const entry of resolved) {
      let songId: string;
      if ('songId' in entry) {
        songId = entry.songId;
      } else {
        songId = made.get(entry) ?? '';
        if (!songId) {
          const created = this.newSongRecords(entry.fields, now);
          songs.push(...created.records);
          songId = created.id;
          made.set(entry, songId);
        }
      }
      added.push(this.newItem(songId, now));
    }
    items.splice(index, 0, ...added);
    const result = this.writeRunSheet(workspace.id, day, current, items, now, songs);
    return { ...result, addedItemIds: added.map((item) => item.id) };
  }

  /** The versions a passage is shown in: the workspace's, else the church's default. */
  private bibleVersions(workspaceId: string): string[] {
    const bible = this.deps.bible;
    if (!bible) return [];
    const church = this.instance.churchSettings();
    const offered = bible.offered(church).map((v) => v.id);
    const row = this.instance.db
      .prepare(
        `SELECT data FROM record WHERE workspace_id = ? AND kind = 'setting' AND key = 'bibleVersions'`,
      )
      .get(workspaceId);
    const setting = BibleVersionsSettingSchema.safeParse(row ? parseData(row.data).value : null);
    const chosen = effectiveVersions(setting.success ? setting.data : [], offered);
    if (chosen.length > 0) return chosen;
    const defaults = effectiveVersions(church.bibleDefaultVersions ?? [], offered);
    if (defaults.length > 0) return defaults;
    return offered.slice(0, 1);
  }

  private async passageFields(
    workspaceId: string,
    input: string,
    versions: string[] | undefined,
    at: string,
  ): Promise<Record<string, unknown>> {
    const bible = this.deps.bible;
    const parsed = parseReference(String(input ?? '').slice(0, 100));
    if (parsed.kind !== 'reference') {
      throw new McpToolError(
        'invalid-reference',
        `Not a Bible reference${at}: give a book, chapter and verses, such as “John 3:16-18” or “约翰福音 3:16-18”.`,
      );
    }
    if (!bible)
      throw new McpToolError('bible-unavailable', 'This server offers no Bible passages.');
    const offered = bible.offered(this.instance.churchSettings()).map((v) => v.id);
    let chosen: string[];
    if (versions && versions.length > 0) {
      const wanted = [...new Set(versions.map((v) => v.trim().toUpperCase()))];
      const unknown = wanted.filter((v) => !offered.includes(v));
      if (unknown.length > 0) {
        throw new McpToolError(
          'version-not-offered',
          `The church does not offer ${unknown.join(', ')}. Offered: ${offered.join(', ') || 'none'}.`,
          { offered },
        );
      }
      if (wanted.length > 2)
        throw new McpToolError('too-many-items', 'At most two Bible versions side by side.');
      chosen = wanted;
    } else {
      chosen = this.bibleVersions(workspaceId);
    }
    if (chosen.length === 0) {
      throw new McpToolError('bible-unavailable', 'The church offers no Bible versions yet.');
    }
    const reference = parsed.reference;
    const texts: PassageText[] = [];
    for (const version of chosen) {
      try {
        texts.push(await bible.passages.get(version, reference));
      } catch (error) {
        const kind = (error as { kind?: unknown }).kind;
        const where = `${formatReference(reference, 'en')} in ${version}${at}`;
        if (kind === 'not-found')
          throw new McpToolError('passage-not-found', `${where} does not exist.`);
        if (kind === 'too-large') {
          throw new McpToolError(
            'passage-too-large',
            `${where} is too long: split it into shorter passages.`,
          );
        }
        if (kind === 'not-offered')
          throw new McpToolError('version-not-offered', `${version} is not offered.`);
        throw new McpToolError(
          'bible-unavailable',
          `The Bible could not be reached for ${where}. Try again later.`,
        );
      }
    }
    // Every API.Bible passage served is reported (B25).
    const tokens = texts.map((t) => t.fumsToken).filter((t): t is string => !!t);
    if (tokens.length > 0) bible.fums.report(tokens, `mcp:${this.user.id}`, '');
    const passage = PassageSchema.parse({ reference: toUsfm(reference), texts });
    const language = catalogueVersion(texts[0]!.version)?.language ?? 'en';
    // As the desktop's `passageSongFields`: the reference as title, the text as lyrics (B23).
    return {
      title: formatReference(reference, language),
      lyrics: passagePlainText(passage),
      passage,
    };
  }

  moveRunSheetItem(
    workspaceRef: string | undefined,
    date: string,
    itemId: string,
    after: Position,
  ) {
    const workspace = this.workspace(workspaceRef);
    const day = requireDate(date);
    const current = this.runSheetRecord(workspace.id, day);
    const items = [...(current?.items ?? [])];
    const from = items.findIndex((item) => item.id === itemId);
    if (!current || from === -1) {
      throw new McpToolError('item-not-found', `No item ${itemId} on the run sheet for ${day}.`);
    }
    if (after === itemId) {
      throw new McpToolError('item-not-found', 'An item cannot go after itself.');
    }
    const [moved] = items.splice(from, 1);
    items.splice(this.insertIndex(items, after), 0, moved!);
    if (items.every((item, index) => item.id === current.items[index]!.id)) {
      return { ...this.getRunSheet(workspace.id, day), changed: false };
    }
    return {
      ...this.writeRunSheet(workspace.id, day, current, items, this.stamp(current.updatedAt)),
      changed: true,
    };
  }

  /** Removes items from a run sheet; songs stay in the library. All or nothing. */
  removeRunSheetItems(workspaceRef: string | undefined, date: string, itemIds: string[]) {
    const workspace = this.workspace(workspaceRef);
    const day = requireDate(date);
    if (itemIds.length === 0)
      throw new McpToolError('no-items', 'Give at least one item to remove.');
    const current = this.runSheetRecord(workspace.id, day);
    const wanted = new Set(itemIds);
    const known = new Set((current?.items ?? []).map((item) => item.id));
    const unknown = [...wanted].filter((id) => !known.has(id));
    if (!current || unknown.length > 0) {
      throw new McpToolError(
        'item-not-found',
        `Not on the run sheet for ${day}: ${unknown.join(', ') || itemIds.join(', ')}. Nothing was removed.`,
        { unknown },
      );
    }
    const items = current.items.filter((item) => !wanted.has(item.id));
    return {
      ...this.writeRunSheet(workspace.id, day, current, items, this.stamp(current.updatedAt)),
      removed: wanted.size,
    };
  }

  /**
   * Copies items from one date to another, such as last week's announcements: new items
   * pointing at the same songs, as the desktop's copy does. The source is not changed.
   */
  copyRunSheetItems(
    workspaceRef: string | undefined,
    fromDate: string,
    toDate: string,
    itemIds?: string[],
    after?: Position,
  ) {
    const workspace = this.workspace(workspaceRef);
    const from = requireDate(fromDate, 'fromDate');
    const to = requireDate(toDate, 'toDate');
    if (from === to) throw new McpToolError('same-date', 'Copy to another date.');
    const source = this.runSheetRecord(workspace.id, from);
    if (!source || source.items.length === 0) {
      throw new McpToolError('nothing-to-copy', `There is no run sheet with items for ${from}.`);
    }
    let picked = source.items;
    if (itemIds && itemIds.length > 0) {
      const known = new Set(source.items.map((item) => item.id));
      const unknown = itemIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new McpToolError(
          'item-not-found',
          `Not on the run sheet for ${from}: ${unknown.join(', ')}.`,
          {
            unknown,
          },
        );
      }
      const wanted = new Set(itemIds);
      picked = source.items.filter((item) => wanted.has(item.id));
    }
    // A song since deleted everywhere is not copied: a desktop would not show it.
    const copyable = picked.filter((item) => this.resolveAny(workspace.id, item.songId) !== null);
    const skipped = picked.length - copyable.length;
    if (copyable.length === 0) {
      throw new McpToolError('nothing-to-copy', 'None of those items can be copied.');
    }
    if (copyable.length > MAX_ITEMS_PER_CALL * 4) {
      throw new McpToolError('too-many-items', 'Too many items to copy at once.');
    }
    const current = this.runSheetRecord(workspace.id, to);
    const items = [...(current?.items ?? [])];
    const index = this.insertIndex(items, after);
    const now = this.stamp(current?.updatedAt);
    const copies = copyable.map((item) => this.newItem(item.songId, now));
    items.splice(index, 0, ...copies);
    return {
      ...this.writeRunSheet(workspace.id, to, current, items, now),
      addedItemIds: copies.map((item) => item.id),
      skipped,
    };
  }
}
