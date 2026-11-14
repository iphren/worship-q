/**
 * Service records (service records task breakdown, R1–R22): the recording of a live audio
 * broadcast that the broadcasting desktop uploads to the church server, the presentation
 * log that the coordinator uploads, and what the server's local API returns about both.
 *
 * None of this passes through the relay, so the protocol version is unchanged; a desktop
 * uploads only what the server's `info.records` offers.
 */
import { z } from 'zod';
import type { PassageLine } from '@worship-q/bible';
import { IsoDateSchema, TimestampSchema } from './records';

// ── Live audio recordings (R4, R5, R8, R9) ───────────────────────────────────

/** A recording's identifier, made by the desktop that opens it. */
export const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most one chunk may hold: five seconds at 64 kbps is about 40 kB, so this is generous. */
export const RECORDING_CHUNK_MAX_BYTES = 1024 * 1024;

/** A recording with no chunk for this long and no `complete` reads as interrupted (R9). */
export const RECORDING_IDLE_MS = 10 * 60 * 1000;

/** What the recorder wrote: WebM with Opus, or MP4 with AAC (R4). The server never transcodes. */
export const RecordingContainerSchema = z.enum(['webm', 'mp4']);
export type RecordingContainer = z.infer<typeof RecordingContainerSchema>;

/** The extension a recording's file is stored with. */
export function recordingExtension(container: RecordingContainer): string {
  return container === 'webm' ? 'webm' : 'm4a';
}

/** The container a recorder's type string names, or null when it is neither. */
export function recordingContainerOf(mimeType: string): RecordingContainer | null {
  const type = mimeType.split(';')[0]!.trim().toLowerCase();
  if (type === 'audio/webm' || type === 'video/webm') return 'webm';
  if (type === 'audio/mp4' || type === 'video/mp4' || type === 'audio/x-m4a') return 'mp4';
  return null;
}

/** `POST /api/v1/audio/recordings`: opens a recording; safe to repeat. */
export const RecordingOpenSchema = z.object({
  id: z.string().regex(RECORDING_ID),
  startedAt: TimestampSchema,
  container: RecordingContainerSchema,
  /** The recorder's own type string, such as `audio/webm;codecs=opus`. */
  mimeType: z.string().max(100),
  /** The input as the broadcaster names it. */
  inputName: z.string().max(200),
  /** The desktop's clock when it sent this, so the server can store the clock's offset (R16). */
  sentAt: TimestampSchema,
});
export type RecordingOpen = z.infer<typeof RecordingOpenSchema>;

/** `POST /api/v1/audio/recordings/:id/complete`: closes a recording with its end time. */
export const RecordingCompleteSchema = z.object({
  endedAt: TimestampSchema,
  /** Set when the desktop could not send every chunk, as when its queue dropped some (R7). */
  cutShort: z.boolean().optional(),
});
export type RecordingComplete = z.infer<typeof RecordingCompleteSchema>;

/**
 * The answer to a chunk, `PUT /api/v1/audio/recordings/:id/chunks/:seq`. `next` is the chunk
 * the server expects after this one. A repeat of a stored chunk is answered as `duplicate`;
 * a gap is refused with 409 and `expected`.
 */
export interface RecordingChunkResponse {
  stored: true;
  duplicate?: true;
  next: number;
}

/** Why the server refused a recording for good; the desktop drops it from its queue. */
export const RECORDING_REFUSALS = ['recording-off', 'not-owner', 'completed'] as const;
export type RecordingRefusal = (typeof RECORDING_REFUSALS)[number];

/** A recording as the admin app and the local API list it. */
export interface RecordingView {
  id: string;
  workspaceId: string;
  deviceId: string;
  deviceName: string;
  inputName: string;
  container: RecordingContainer;
  mimeType: string;
  startedAt: string;
  /** Null while it is still being received, or when it was interrupted. */
  endedAt: string | null;
  bytes: number;
  /** Chunks received. */
  chunks: number;
  /** When the last chunk arrived, on the server's clock. */
  lastChunkAt: string | null;
  /**
   * `receiving` while chunks keep coming; `interrupted` after ten minutes without one and no
   * `complete`, which a later chunk turns back to receiving; `complete` once closed.
   */
  status: 'receiving' | 'interrupted' | 'complete';
  /** The desktop said some chunks never reached the server. */
  cutShort: boolean;
  /** The desktop's clock minus the server's when it opened the recording, in milliseconds. */
  clockOffsetMs: number;
}

// ── The presentation log (R12–R19) ───────────────────────────────────────────

/** A presentation log entry's identifier, made by the coordinator. */
export const LOG_ENTRY_ID = RECORDING_ID;

/** An entry that lasted less than this is not kept (R14). */
export const LOG_MIN_DURATION_MS = 1000;

/**
 * Which part of the item was on screen (R15), by position in the revision named, never as
 * text: the lines of lyrics, the page of a deck (a slide after some clicks), or the verse
 * units of a passage's slide, per column. A video and a website are shown whole.
 */
export const LogPartSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('lyrics'),
    /** The first line shown, by position among the song's lines from 0, blank lines not counted. */
    line: z.number().int().min(0),
    count: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('deck'),
    /** The page of the deck, from 0: one image, a slide after some clicks. */
    page: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('passage'),
    /** The passage's slide, from 0. */
    slide: z.number().int().min(0),
    /** Per column, in the passage's order: the slide's first verse unit and how many it shows. */
    units: z.array(z.object({ start: z.number().int().min(0), count: z.number().int().min(0) })),
  }),
  z.object({ kind: z.literal('video') }),
  z.object({ kind: z.literal('website') }),
]);
export type LogPart = z.infer<typeof LogPartSchema>;

/** The background in use when the entry opened (R15): a colour, and an image or video's id. */
export const LogBackgroundSchema = z.object({
  color: z.string().max(20),
  assetId: z.string().max(100).nullable(),
});
export type LogBackground = z.infer<typeof LogBackgroundSchema>;

/**
 * One unbroken showing of one piece (R13), as the coordinator uploads it: when it opens, with
 * no end, and again when it closes, under the same id.
 */
export const LogEntrySchema = z.object({
  id: z.string().regex(LOG_ENTRY_ID),
  runSheetId: z.string().min(1).max(100),
  /** The date of the run sheet the piece was played from. */
  date: IsoDateSchema,
  itemId: z.string().min(1).max(100),
  /** The piece is from the run sheet that was live before Go live. */
  previous: z.boolean(),
  songId: z.string().min(1).max(100),
  /** The revision number of the version shown. */
  revision: z.number().int().min(1),
  /**
   * The revision record's id, when the coordinator holds it; the server otherwise finds it
   * by song and revision number.
   */
  revisionId: z.string().min(1).max(100).nullable(),
  /** For a song with two versions (D31), which one was shown; null for any other. */
  version: z.enum(['own', 'church']).nullable(),
  part: LogPartSchema,
  background: LogBackgroundSchema.nullable(),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

/** Entries sent in one request at most. */
export const LOG_BATCH_MAX = 200;

/** `POST /api/v1/presentation-log`. */
export const LogBatchSchema = z.object({
  /** The coordinator's clock when it sent the batch (R16). */
  sentAt: TimestampSchema,
  entries: z.array(LogEntrySchema).max(LOG_BATCH_MAX),
});
export type LogBatch = z.infer<typeof LogBatchSchema>;

/** A log entry as the server keeps it. */
export interface StoredLogEntry extends LogEntry {
  workspaceId: string;
  deviceId: string;
  deviceName: string;
  /** Closed by the server: a later entry started, or the live state expired (R18). */
  closedByServer: boolean;
  /** The coordinator's clock minus the server's, from the batch that last carried it. */
  clockOffsetMs: number;
  /** The server's order of arrival, which increases on every change to the entry. */
  cursor: number;
}

// ── The local API's content (R22) ────────────────────────────────────────────

/** A file the local API serves, as a link, never its bytes. */
export interface LocalMedia {
  /** A path under `/local/v1/workspaces/:id/media/`. */
  url: string;
  name: string;
  /** The retention sweep removed the file (D34); the link answers 404. */
  gone: boolean;
}

export interface LocalBackground {
  color: string;
  media: (LocalMedia & { kind: 'image' | 'video' }) | null;
}

export interface LocalPassageColumn {
  version: string;
  /** The passage's reference in the version's language. */
  reference: string;
  units: { label: string; title?: boolean; lines: PassageLine[] }[];
  /** The short credit shown under the column. */
  credit: string;
  /** The provider's copyright line. */
  copyright: string;
}

/** What was on screen, structured, joined from the revision an entry names. */
export type LocalContent = {
  title: string;
  /** Everything shown as plain text, for a reader that wants no more. */
  text: string;
} & (
  | {
      kind: 'lyrics';
      author: string;
      copyright: string;
      ccli: string | null;
      /** The song's block the lines are in, from 0. */
      block: number;
      lines: string[];
    }
  | {
      kind: 'deck';
      /** The slide in the original file, from 1, and the clicks into its animations. */
      slide: number;
      step: number;
      page: number;
      /** The slide's text, line by line, as the import read it; empty for a picture. */
      lines: string[];
      image: LocalMedia;
      thumbnail: LocalMedia | null;
    }
  | { kind: 'passage'; slide: number; columns: LocalPassageColumn[] }
  | { kind: 'video'; video: LocalMedia; durationSeconds: number }
  | { kind: 'website'; url: string }
);

/** One entry of `GET /local/v1/presentation-log`. */
export interface LocalLogEntry {
  id: string;
  workspaceId: string;
  /** The device that wrote it, the coordinator then. */
  device: { id: string; name: string };
  runSheet: { id: string; date: string };
  itemId: string;
  previous: boolean;
  song: {
    id: string;
    revision: number;
    revisionId: string | null;
    version: 'own' | 'church' | null;
  };
  part: LogPart;
  startedAt: string;
  endedAt: string | null;
  closedByServer: boolean;
  clockOffsetMs: number;
  cursor: number;
  /** Null while the server does not hold the revision named; a later read has it. */
  content: LocalContent | null;
  background: LocalBackground | null;
}
