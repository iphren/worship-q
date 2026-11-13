import { PassageSchema, type PassageColumn } from '@worship-q/bible';
import { z } from 'zod';

/** Calendar date without a time, as `YYYY-MM-DD`. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Instant as an ISO 8601 UTC string. */
export const TimestampSchema = z.string().min(1);

/** Day of the week, 0 = Sunday … 6 = Saturday. */
export const WeekdaySchema = z.number().int().min(0).max(6);
export type Weekday = z.infer<typeof WeekdaySchema>;

const IdSchema = z.string().min(1);
const RevisionSchema = z.number().int().min(1);

export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: z.string(),
  timezone: z.string().min(1),
  /** The actual selection is kept: none means "Any day", all seven means "Every day". */
  meetingDays: z.array(WeekdaySchema),
  revision: RevisionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A background chosen for one song in place of the slideshow's own. */
export const SongBackgroundSchema = z.object({
  color: ColorSchema,
  /** Image or video; the color is used when null or missing. */
  assetId: IdSchema.nullable(),
});
export type SongBackground = z.infer<typeof SongBackgroundSchema>;

/** One image of an imported slide deck: a slide as it looks after some clicks. */
export const DeckPageSchema = z.object({
  /** Name of the image among the workspace's files. */
  image: z.string().min(1),
  /** A small copy for phones, kept on the church server only; older imports have none. */
  thumbnail: z.string().min(1).optional(),
  /** The slide's position in the original file, from 1. */
  slide: z.number().int().min(1),
  /** Clicks into the slide's animations; 0 before the first. */
  step: z.number().int().min(0),
  /** The text shown, one entry per line, for phones and search. */
  text: z.array(z.string()),
});
export type DeckPage = z.infer<typeof DeckPageSchema>;

/**
 * What a deck was made from: slides (PowerPoint, Keynote, or a PDF), or one image (U13).
 * Missing, or a value this build does not know, reads as slides.
 */
export const DeckKindSchema = z.enum(['slides', 'image']);
export type DeckKind = z.infer<typeof DeckKindSchema>;

/** Slides imported from PowerPoint, Keynote or PDF, shown as images instead of lyrics. */
export const DeckSchema = z.object({
  /** The file the slides came from. */
  source: z.string(),
  /** Set to `image` for an uploaded image, which is a deck of one page (U13). */
  kind: DeckKindSchema.optional().catch(undefined),
  /** Size of every image in pixels. */
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  pages: z.array(DeckPageSchema),
});
export type Deck = z.infer<typeof DeckSchema>;

/** The text a deck's song keeps as its lyrics, so search finds the slides. */
export function deckLyrics(deck: Deck): string {
  return deck.pages.map((page) => page.text.join('\n')).join('\n\n');
}

/**
 * An uploaded video, shown full screen instead of lyrics (U14). The server keeps the file as
 * uploaded; each computer keeps a copy for upcoming run sheets (U8).
 */
export const VideoSchema = z.object({
  /** Name of the stored file among the workspace's files, `video-<id>.<ext>`. */
  file: z.string().min(1),
  /** The name of the file uploaded. */
  source: z.string(),
  /** Picture size in pixels. */
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  durationSeconds: z.number().min(0),
  bytes: z.number().int().min(0),
  /** Plays as soon as it is presented (U23). */
  autoplay: z.boolean().default(false),
});
export type Video = z.infer<typeof VideoSchema>;

/** A stored video file's name, as the server makes it. */
export const VIDEO_FILE = /^video-[0-9a-f-]{36}\.(mp4|m4v|mov|webm)$/;

/** A web page shown live on the slideshow instead of lyrics. */
export const WebsiteSchema = z.object({
  /** An `http` or `https` address; see `websiteUrl`. */
  url: z.string().refine((url) => websiteUrl(url) === url),
});
export type Website = z.infer<typeof WebsiteSchema>;

/**
 * The address typed for a website, made complete: `https://` is added when no scheme is
 * given. Null when it is not a usable `http` or `https` address.
 */
export function websiteUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // A colon followed by digits is a port, as in `localhost:8080`, not a scheme.
  const candidate = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The seconds a YouTube link starts at: `90`, `90s` or `1h2m3s`. Zero when it has none. */
function youtubeStart(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!parts) return 0;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

/**
 * The address that shows only the video of a YouTube link, filling the screen and playing at
 * once, in place of YouTube's page around it. Null when the address is not a YouTube video:
 * a channel, a playlist or any other site is shown as the web page it is.
 */
export function youtubeEmbedUrl(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const [first, second] = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (host === 'youtu.be') id = first;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (first === 'watch') id = url.searchParams.get('v');
    else if (first === 'embed' || first === 'live' || first === 'shorts') id = second;
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const start = youtubeStart(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0${
    start > 0 ? `&start=${start}` : ''
  }`;
}

export const SongFieldsSchema = z.object({
  title: z.string(),
  lyrics: z.string(),
  /**
   * Writers as one line. Roles are labelled only when they differ, as in songbooks:
   * `词：A` and `曲：B` (separated by a full-width space), `译：` for a translator, or
   * `Words: A; Music: B`. Names are separated by `, `.
   */
  author: z.string(),
  copyright: z.string(),
  /** CCLI song number, when the song has one. */
  ccli: z.string().regex(/^\d+$/).nullable(),
  /** Year the song was written, when known; see `maxSongYear`. */
  year: z.number().int().nullable(),
  /** Null uses the slideshow background from the settings. */
  background: SongBackgroundSchema.nullable(),
  /** Imported slides, shown instead of the lyrics; null for an ordinary song. */
  deck: DeckSchema.nullable(),
  /** A web page, shown instead of the lyrics; null for an ordinary song. */
  website: WebsiteSchema.nullable(),
  /**
   * An uploaded video, shown instead of the lyrics; null for an ordinary song, and on songs
   * saved before videos existed.
   */
  video: VideoSchema.nullable().default(null),
  /**
   * A Bible passage, shown instead of the lyrics (Bible passages plan, B23); null for an
   * ordinary song, and on songs saved before passages existed. `lyrics` then holds the
   * passage as plain text, for devices older than passages.
   */
  passage: PassageSchema.nullable().default(null),
});
export type SongFields = z.infer<typeof SongFieldsSchema>;

/** The latest acceptable song year: next year, to catch typos such as 20155. */
export function maxSongYear(now: Date): number {
  return now.getUTCFullYear() + 1;
}

/** Fields whose value is not acceptable. */
export function invalidSongFields(
  fields: Pick<SongFields, 'ccli' | 'year'>,
  now: Date,
): ('ccli' | 'year')[] {
  const invalid: ('ccli' | 'year')[] = [];
  if (fields.ccli !== null && !/^\d+$/.test(fields.ccli)) invalid.push('ccli');
  if (fields.year !== null && (!Number.isInteger(fields.year) || fields.year > maxSongYear(now)))
    invalid.push('year');
  return invalid;
}

/** Control characters other than tabs and line breaks, such as stray DEL (0x7F). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * Tidies fields entered by hand: removes invisible control characters everywhere, trims the
 * single-line fields, and records an empty CCLI number as none.
 */
export function cleanSongFields(fields: SongFields): SongFields {
  const clean = (value: string) => value.replace(CONTROL_CHARACTERS, '');
  const ccli = clean(fields.ccli ?? '').trim();
  return {
    title: clean(fields.title).trim(),
    lyrics: clean(fields.lyrics),
    author: clean(fields.author).trim(),
    copyright: clean(fields.copyright).trim(),
    ccli: ccli === '' ? null : ccli,
    year: fields.year,
    background: fields.background,
    deck: fields.deck,
    website: fields.website,
    video: fields.video,
    passage: fields.passage,
  };
}

/**
 * What a workspace may manage in the Church Library, each on its own: songs of lyrics,
 * backgrounds, media (imported slides, images and videos, stored as `slides`) and websites.
 * Media and websites are songs with a deck, a video or a website, and a song's history goes
 * with the song.
 */
export const LIBRARY_TYPES = ['songs', 'backgrounds', 'slides', 'websites'] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];

/** Which Church Library type a record is; null for a kind the Church Library does not hold. */
export function libraryTypeOf(
  kind: string,
  data:
    { deck?: unknown; website?: unknown; video?: unknown; passage?: unknown } | null | undefined,
): LibraryType | null {
  if (kind === 'background') return 'backgrounds';
  if (kind !== 'song' && kind !== 'songRevision') return null;
  // A passage lives only in the run sheet that holds it, never in a library (B7).
  if (data?.passage) return null;
  if (data?.deck || data?.video) return 'slides';
  if (data?.website) return 'websites';
  return 'songs';
}

/** The library types named in a list, in their usual order, unknown names left out. */
export function libraryTypes(values: readonly unknown[]): LibraryType[] {
  return LIBRARY_TYPES.filter((type) => values.includes(type));
}

/** Whose record it is: the Church Library's, or the workspace's own (phase 3, decision D31). */
export const RecordOriginSchema = z.enum(['church', 'workspace']);
export type RecordOrigin = z.infer<typeof RecordOriginSchema>;

/** When one version of a two-version song last changed, for the toggle (D32). */
export const SongVersionStampSchema = z.object({
  revision: RevisionSchema,
  updatedAt: TimestampSchema,
});

export const SongSchema = SongFieldsSchema.extend({
  id: IdSchema,
  workspaceId: IdSchema,
  /** One stable identifier per non-blank lyric line, in order. */
  lineIds: z.array(IdSchema),
  revision: RevisionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  removedAt: TimestampSchema.nullable(),
  /**
   * Where the song came from (D31): the Church Library's, or this workspace's own. Null on a
   * device without a church, or before its first pull from a version 3 instance.
   */
  origin: RecordOriginSchema.nullable().default(null),
  /**
   * On a song with two versions, whether this workspace presents the church's rather than
   * its own (D32). The song's fields are then the church's; `versions` tells both apart.
   */
  useChurchVersion: z.boolean().default(false),
  /** Set on a song with two versions: the workspace's own and the church's. */
  versions: z
    .object({ own: SongVersionStampSchema, church: SongVersionStampSchema })
    .nullable()
    .default(null),
});
export type Song = z.infer<typeof SongSchema>;

export const SongRevisionSchema = SongFieldsSchema.extend({
  id: IdSchema,
  songId: IdSchema,
  revision: RevisionSchema,
  lineIds: z.array(IdSchema),
  createdAt: TimestampSchema,
});
export type SongRevision = z.infer<typeof SongRevisionSchema>;

export const RunSheetSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  date: IsoDateSchema,
  revision: RevisionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type RunSheet = z.infer<typeof RunSheetSchema>;

export const RunSheetItemSchema = z.object({
  id: IdSchema,
  runSheetId: IdSchema,
  songId: IdSchema,
  position: z.number().int().min(0),
  revision: RevisionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type RunSheetItem = z.infer<typeof RunSheetItemSchema>;

export const MIN_LINES_PER_PIECE = 1;
export const MAX_LINES_PER_PIECE = 8;

export const PresentationSettingsSchema = z.object({
  linesPerPiece: z.number().int().min(MIN_LINES_PER_PIECE).max(MAX_LINES_PER_PIECE),
  wrapLongLines: z.boolean(),
});
export type PresentationSettings = z.infer<typeof PresentationSettingsSchema>;

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = {
  linesPerPiece: 2,
  wrapLongLines: true,
};

export const BackgroundKindSchema = z.enum(['image', 'video']);
export type BackgroundKind = z.infer<typeof BackgroundKindSchema>;

export const BackgroundAssetSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  kind: BackgroundKindSchema,
  /** Name of the copy inside the app's own storage. */
  fileName: z.string().min(1),
  originalName: z.string(),
  createdAt: TimestampSchema,
  removedAt: TimestampSchema.nullable(),
  /** The Church Library's or the workspace's own (D31); backgrounds have no versions. */
  origin: RecordOriginSchema.nullable().default(null),
});
export type BackgroundAsset = z.infer<typeof BackgroundAssetSchema>;

/** Enough to recognise a monitor again without relying on its index. */
export const MonitorIdentitySchema = z.object({
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type MonitorIdentity = z.infer<typeof MonitorIdentitySchema>;

export const OutputTargetSchema = z.object({
  monitor: MonitorIdentitySchema,
  /** False once the operator closes the output; the monitor stays remembered. */
  enabled: z.boolean(),
  /** True only when the operator explicitly asked to present on their own screen. */
  allowOperatorScreen: z.boolean(),
});
export type OutputTarget = z.infer<typeof OutputTargetSchema>;

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 1.5;

export const OutputKindSchema = z.enum(['slideshow', 'subtitle']);
export type OutputKind = z.infer<typeof OutputKindSchema>;

export const OutputProfileSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  /** The slideshow fills a screen; the subtitle overlay is a page for OBS and similar. */
  kind: OutputKindSchema,
  /** Null uses the church default font, else the system default. */
  fontFamily: z.string().nullable(),
  scale: z.number().min(MIN_SCALE).max(MAX_SCALE),
  backgroundColor: ColorSchema,
  /** Selected image or video; the solid color is used when null or missing. */
  backgroundAssetId: IdSchema.nullable(),
  /** True hides the mouse cursor while it is over the slideshow. */
  hideCursor: z.boolean(),
  target: OutputTargetSchema.nullable(),
  revision: RevisionSchema,
  updatedAt: TimestampSchema,
});
export type OutputProfile = z.infer<typeof OutputProfileSchema>;

export const PresentedSchema = z.object({
  /** Run sheet the piece was played from; may differ from the live one after Go live. */
  runSheetId: IdSchema,
  itemId: IdSchema,
  songId: IdSchema,
  pieceId: IdSchema,
  /** Position in the run sheet when played; used when the item has since been removed. */
  index: z.number().int().min(0),
});
export type Presented = z.infer<typeof PresentedSchema>;

/**
 * The presented video item's playback (media uploads plan, U22, U23): where it was at `at`,
 * and whether it has played on since. One clock for every screen.
 */
export const LiveVideoSchema = z.object({
  itemId: IdSchema,
  playing: z.boolean(),
  /** Seconds into the video at `at`. */
  position: z.number().min(0),
  at: TimestampSchema,
  durationSeconds: z.number().min(0),
  /**
   * Set while blanking paused it, or while an Autoplay video waits for the screen, so
   * unblanking plays it; cleared by the operator's own play or pause (U22, U23).
   */
  resumeOnUnblank: z.boolean(),
});
export type LiveVideo = z.infer<typeof LiveVideoSchema>;

export const LiveStateSchema = z.object({
  status: z.enum(['live', 'ended']),
  /** Link to the dated run sheet, not a copy of it. */
  runSheetId: IdSchema,
  presented: PresentedSchema.nullable(),
  /**
   * The piece each item showed most recently, keyed by run sheet item, so operators can
   * see where they left off. Lasts as long as this live state; states saved before it was
   * added start empty.
   */
  lastShown: z.record(IdSchema, z.object({ songId: IdSchema, pieceId: IdSchema })).default({}),
  /** The presented video item's playback; null when no video item is presented. */
  video: LiveVideoSchema.nullable().default(null),
  /**
   * Where each video item was left, in seconds, keyed by run sheet item (U22). Lasts as long
   * as this live state; states saved before it was added start empty.
   */
  videoPositions: z.record(IdSchema, z.number().min(0)).default({}),
  blank: z.boolean(),
  revision: z.number().int().min(0),
  /** Recently applied command identifiers, so a repeated command is applied once. */
  appliedCommandIds: z.array(IdSchema),
  startedAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** Last time an operator device was known to be connected. */
  lastActiveAt: TimestampSchema,
});
export type LiveState = z.infer<typeof LiveStateSchema>;

const commandBase = { id: IdSchema };
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ ...commandBase, type: z.literal('playPiece'), itemId: IdSchema, pieceId: IdSchema }),
  z.object({ ...commandBase, type: z.literal('next') }),
  z.object({ ...commandBase, type: z.literal('previous') }),
  /** Step to another piece of the presented item, never leaving it. */
  z.object({ ...commandBase, type: z.literal('nextInItem') }),
  z.object({ ...commandBase, type: z.literal('previousInItem') }),
  /** Present the first piece of the item after or before the presented one. */
  z.object({ ...commandBase, type: z.literal('nextItem') }),
  z.object({ ...commandBase, type: z.literal('previousItem') }),
  z.object({ ...commandBase, type: z.literal('blank') }),
  z.object({ ...commandBase, type: z.literal('unblank') }),
  /** Takes the presented piece off the screen and stays live; next starts from the top. */
  z.object({ ...commandBase, type: z.literal('clear') }),
  z.object({ ...commandBase, type: z.literal('goLive'), runSheetId: IdSchema }),
  z.object({ ...commandBase, type: z.literal('end') }),
  /**
   * Video playback (protocol version 5, U21). Each names the video item it is meant for, so
   * one sent from a slow phone after the item changed is ignored.
   */
  z.object({ ...commandBase, type: z.literal('videoPlay'), itemId: IdSchema }),
  z.object({ ...commandBase, type: z.literal('videoPause'), itemId: IdSchema }),
  z.object({
    ...commandBase,
    type: z.literal('videoSeek'),
    itemId: IdSchema,
    seconds: z.number().finite(),
  }),
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];

/** The presented video as an output plays it. */
export interface OutputVideo {
  /** Where to play it from; empty when this computer has no copy yet. */
  url: string;
  playing: boolean;
  /** Seconds into the video at `at`. */
  position: number;
  /** ISO timestamp the position was taken at. */
  at: string;
  durationSeconds: number;
}

/** Everything an output needs to draw the current moment of a presentation. */
export interface OutputFrame {
  /** Slideshow: lyrics over a background. Subtitle: a lower band over transparency. */
  layout: OutputKind;
  /** True shows the background without lyrics. */
  blank: boolean;
  /** Null means the system default font. */
  fontFamily: string | null;
  scale: number;
  wrap: boolean;
  /** True hides the mouse cursor while it is over the output. */
  hideCursor: boolean;
  background: {
    color: string;
    media: { kind: BackgroundKind; url: string } | null;
  };
  /** The presented song as pieces of source lines; the whole song is needed for fitting. */
  song: { id: string; pieces: { id: string; lines: string[] }[] } | null;
  pieceId: string | null;
  /** An imported slide, shown whole in place of lyrics. */
  picture: { url: string } | null;
  /** A web page shown live over the slideshow, by the output window itself. */
  website: { url: string } | null;
  /**
   * A video item, shown full screen on black in place of lyrics (U14), with the live state's
   * clock for it. Hidden while blank. Never on the subtitle overlay.
   */
  video?: OutputVideo | null;
  /**
   * A Bible passage's slide (B10): each version's verses as a column, side by side, with its
   * credit, and above each column the whole passage's reference in its version's language
   * (`Mark 15:5–6`, `马可福音 15:5-6`), the same on every slide. Hidden while blank; never on
   * the subtitle overlay (B12).
   */
  passage?: {
    columns: PassageColumn[];
    headers: string[];
    /** Which slide of the passage this is, from 1, and how many it has. */
    page?: { number: number; count: number };
  } | null;
  /**
   * Words shown instead of lyrics, such as **Waiting for presentation** on a viewer's
   * slideshow (decision D16). Never shown on the subtitle overlay.
   */
  message?: string | null;
}

export const EMPTY_FRAME: OutputFrame = {
  layout: 'slideshow',
  blank: false,
  fontFamily: null,
  scale: 1,
  wrap: true,
  hideCursor: false,
  background: { color: '#000000', media: null },
  song: null,
  pieceId: null,
  picture: null,
  website: null,
};
