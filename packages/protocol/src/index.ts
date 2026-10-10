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

export const SongFieldsSchema = z.object({
  title: z.string(),
  lyrics: z.string(),
  author: z.string(),
  copyright: z.string(),
});
export type SongFields = z.infer<typeof SongFieldsSchema>;

export const SongSchema = SongFieldsSchema.extend({
  id: IdSchema,
  workspaceId: IdSchema,
  /** One stable identifier per non-blank lyric line, in order. */
  lineIds: z.array(IdSchema),
  revision: RevisionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  removedAt: TimestampSchema.nullable(),
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

export const OutputProfileSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  kind: z.literal('slideshow'),
  /** Null means the system default font. */
  fontFamily: z.string().nullable(),
  scale: z.number().min(MIN_SCALE).max(MAX_SCALE),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
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

export const LiveStateSchema = z.object({
  status: z.enum(['live', 'ended']),
  /** Link to the dated run sheet, not a copy of it. */
  runSheetId: IdSchema,
  presented: PresentedSchema.nullable(),
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
  z.object({ ...commandBase, type: z.literal('blank') }),
  z.object({ ...commandBase, type: z.literal('unblank') }),
  z.object({ ...commandBase, type: z.literal('goLive'), runSheetId: IdSchema }),
  z.object({ ...commandBase, type: z.literal('end') }),
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];

/** Everything an output needs to draw the current moment of a presentation. */
export interface OutputFrame {
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
}

export const EMPTY_FRAME: OutputFrame = {
  blank: false,
  fontFamily: null,
  scale: 1,
  wrap: true,
  hideCursor: false,
  background: { color: '#000000', media: null },
  song: null,
  pieceId: null,
};
