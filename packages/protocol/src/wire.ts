/**
 * Messages between devices and the church instance: version negotiation, capabilities,
 * content synchronization and remote control.
 *
 * Common desktop builds and church-hosted backends are released independently, so every
 * connection starts by stating its protocol version, and an incompatible peer is told to
 * update rather than failing unpredictably.
 */
import { z } from 'zod';
import { ItemBadgeSchema, type ItemBadge } from './badges';
import {
  ObsCommandSchema,
  ObsResultSchema,
  ObsSnapshotSchema,
  ObsStateSchema,
  type ObsResult,
  type ObsSnapshot,
  type RemoteObsView,
} from './obs';
import {
  LiveStateSchema,
  RecordOriginSchema,
  type BackgroundKind,
  type LibraryType,
  type OutputKind,
} from './records';

/**
 * The protocol this build speaks. Version 2 (phase 2) added one live state per workspace,
 * shared between every operator device through a coordinator, so a workspace never mixes
 * version 1 and version 2 desktops. Version 3 (phase 3) is additive: pulled records say
 * where they come from (`origin`, `shadow`), devices pair with an administrator's approval,
 * and a workspace's song record may choose the church's version (`useChurchVersion`). The
 * live-state protocol is unchanged, so version 2 and 3 desktops present together, and each
 * side speaks the other's version when it is older (decision D26). Version 4 adds OBS control
 * (`./obs`): new message kinds that the relay must know before it passes them on, sent only
 * to devices declaring the `obs` capability, so version 3 desktops are untouched. Version 5
 * adds video items (media uploads plan, U20, U21): songs with a `video`, which the instance
 * keeps when an older desktop saves the song without it, and video playback in the live
 * state.
 */
export const PROTOCOL_VERSION = 5;
/** The first protocol version that knows songs' `video` (U20). */
export const VIDEO_PROTOCOL_VERSION = 5;
/** The oldest protocol this build still accepts from a peer. */
export const MIN_PROTOCOL_VERSION = 2;

export function isCompatibleProtocol(version: unknown): boolean {
  return (
    typeof version === 'number' && version >= MIN_PROTOCOL_VERSION && version <= PROTOCOL_VERSION
  );
}

/**
 * The version this build speaks to a server that reported `serverProtocolVersion`: the
 * server's own when it is older than this build's and still accepted, else this build's.
 * A server reporting nothing, or something unreadable, is spoken to at this build's version
 * and answers with update-needed if it cannot.
 */
export function negotiateProtocol(serverProtocolVersion: unknown): number {
  if (
    typeof serverProtocolVersion === 'number' &&
    Number.isInteger(serverProtocolVersion) &&
    serverProtocolVersion >= MIN_PROTOCOL_VERSION &&
    serverProtocolVersion < PROTOCOL_VERSION
  ) {
    return serverProtocolVersion;
  }
  return PROTOCOL_VERSION;
}

/** What `GET /api/v1/info` says about an instance. Fields after `outputs` came with version 3. */
export interface ServerInfo {
  name: string;
  protocolVersion: number;
  minProtocolVersion: number;
  /** Slide decks can be imported. */
  decks: boolean;
  /** Browser output pages are served. */
  outputs: boolean;
  /** New devices pair with an administrator's approval (phase 3, decision D29). */
  pairing?: boolean;
  /** Administrator sign-in is configured, so the admin app at `/admin/` works. */
  admin?: boolean;
  /**
   * Connection codes work for every workspace, because the instance has no administrator
   * yet (D30). Once one exists this is false, and a code works only where turned on.
   */
  codes?: boolean;
  /**
   * What media the instance takes and how large each kind may be (media uploads plan, U1,
   * U19). Missing on an instance from before images and videos, which imports slide decks
   * only, as `decks` says.
   */
  media?: MediaOffer;
  /**
   * The church offers at least one Bible version a provider serves (B17, B19). Missing on an
   * instance from before the Bible.
   */
  bible?: boolean;
}

/** Upload limits in bytes, per kind of file (U1). */
export interface MediaLimits {
  image: number;
  /** Slide decks and PDFs. */
  deck: number;
  video: number;
}

/** What `info.media` says. */
export interface MediaOffer {
  /** Images are taken and become one-page decks (U13). */
  images: boolean;
  /** Videos are taken and stored as uploaded (U14). */
  videos: boolean;
  limits: MediaLimits;
}

/** The answer to an upload over its kind's limit (U2). */
export const TOO_LARGE = 'too-large';

/**
 * Which side is behind when the server refused this version: the server, when the version
 * it reported is older than this app accepts; otherwise the app. A server that reported
 * nothing is taken to be newer, as a server before this field was always the newer side.
 */
export function updateNeededBy(serverProtocolVersion: unknown): 'app' | 'server' {
  return typeof serverProtocolVersion === 'number' && serverProtocolVersion < MIN_PROTOCOL_VERSION
    ? 'server'
    : 'app';
}

/** What a client can do, reported rather than inferred from its operating system. */
export const CapabilitiesSchema = z.object({
  roles: z.array(z.enum(['coordinator', 'controller', 'display', 'overlay'])),
  appVersion: z.string(),
  /** Installed fonts can be listed. */
  fonts: z.boolean().default(false),
  /** Screens can be listed and presented on. */
  screens: z.boolean().default(false),
  /** Image and video backgrounds can be played. */
  media: z.boolean().default(false),
  /** Output can be drawn over a transparent background. */
  transparency: z.boolean().default(false),
  /**
   * Fonts the workspace's outputs ask for that this device does not have, so the coordinator
   * can warn. Omitted by devices that cannot tell.
   */
  missingFonts: z.array(z.string().max(100)).max(10).optional(),
  /**
   * Takes OBS messages (protocol version 4). Absent from older devices, and stripped by an
   * older relay, which knows only the fields above: either way, nothing is sent to it.
   */
  obs: z.boolean().optional(),
  /**
   * Takes video items in snapshots (protocol version 5, U21). Absent from older devices,
   * which are sent such items as slide decks with nothing to show (U20).
   */
  videos: z.boolean().optional(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** How a desktop takes part in the workspace's live state (spec §7 and §9). */
export const DeviceRoleSchema = z.enum(['operator', 'viewer']);
export type DeviceRole = z.infer<typeof DeviceRoleSchema>;

/** Sent by the instance when a peer's protocol version is not supported. */
export const UPDATE_NEEDED = 'update-needed';

// ── Church defaults ────────────────────────────────────────────────────────

/**
 * Settings the church instance provides as defaults. A workspace setting, when set, takes
 * precedence over the church default, which takes precedence over the built-in default.
 */
export const ChurchSettingsSchema = z
  .object({
    linesPerPiece: z.number().int().min(1).max(8),
    wrapLongLines: z.boolean(),
    slideshowFontFamily: z.string().nullable(),
    subtitleFontFamily: z.string().nullable(),
    /**
     * The Bible versions the church offers its workspaces (B19), by Worship Q's version id.
     * Unset offers none, so a church chooses before its desktops show a Bible.
     */
    bibleVersions: z.array(z.string().min(1).max(20)).max(50),
  })
  .partial();
export type ChurchSettings = z.infer<typeof ChurchSettingsSchema>;

// ── Content synchronization ────────────────────────────────────────────────

export const SyncKindSchema = z.enum([
  'workspace',
  'song',
  'songRevision',
  'runSheet',
  'setting',
  'background',
]);
export type SyncKind = z.infer<typeof SyncKindSchema>;

/**
 * One synchronized record. `key` is what makes two records the same one: the identifier,
 * except for run sheets, which are one per date.
 */
export const SyncRecordSchema = z.object({
  kind: SyncKindSchema,
  id: z.string().min(1),
  key: z.string().min(1),
  revision: z.number().int().min(0),
  updatedAt: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  /**
   * Set by a version 3 instance on every pulled record. Absent from pushed records and from
   * records of a version 2 instance, which a device treats as it always has.
   */
  origin: RecordOriginSchema.optional(),
  /**
   * The church's record for a song the workspace has its own version of: kept beside the
   * workspace's version, never shown as the song itself. Only version 3 devices receive it.
   */
  shadow: z.boolean().optional(),
});
export type SyncRecord = z.infer<typeof SyncRecordSchema>;

/**
 * Whether `incoming` should replace `current`: the later edit wins, then the higher
 * revision. Both sides apply the same rule, so they settle on the same record.
 */
export function syncWins(
  incoming: Pick<SyncRecord, 'revision' | 'updatedAt'>,
  current: Pick<SyncRecord, 'revision' | 'updatedAt'> | null,
): boolean {
  if (!current) return true;
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt;
  return incoming.revision > current.revision;
}

export const PushRequestSchema = z.object({
  protocolVersion: z.number(),
  records: z.array(SyncRecordSchema).max(500),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export interface PushResponse {
  /** Run sheets the instance already knew by another identifier: local id → instance id. */
  remap: Record<string, string>;
}

export interface PullResponse {
  records: SyncRecord[];
  /** Pass back as `since` to continue. */
  cursor: number;
  /** True when more records are waiting. */
  more: boolean;
  church: ChurchSettings;
  /**
   * Whether the workspace manages the Church Library, so a device knows that editing a
   * church song edits the church's rather than making a workspace version. Version 3. Since
   * management is per type, true when it manages songs; see `manageLibraryTypes`.
   */
  manageLibrary?: boolean;
  /** The Church Library types the workspace manages; absent from older instances. */
  manageLibraryTypes?: LibraryType[];
}

export interface EnrollResponse {
  deviceId: string;
  deviceToken: string;
  workspace: {
    id: string;
    name: string;
    /** Identifier the workspace's content uses; null until a device uploads its content. */
    contentId: string | null;
  };
}

/** `POST /api/v1/sync/restore`: the church's record, now the workspace's song again (D32). */
export interface RestoreResponse {
  record: SyncRecord;
}

// ── Pairing (phase 3, decision D29) ────────────────────────────────────────

/** What a device shows while it waits for an administrator (`POST /api/v1/pair`). */
export interface PairingStartResponse {
  /** Proves the device on each poll; never shown or put in the QR code. */
  secret: string;
  /** Eight characters shown as `ABCD-2345`; the administrator sees and approves this. */
  code: string;
  /** Opens the request in the admin app after sign-in. */
  url: string;
  expiresAt: string;
  /** How often to poll. */
  intervalMs: number;
}

export type PairingPollResponse =
  | { status: 'pending' }
  | ({
      status: 'approved';
      /**
       * Whether the administrator let this device keep its own songs and run sheets alongside
       * the workspace's (“Keep both”). When false it can only take the workspace's copy, unless
       * the workspace has no content yet. Missing from servers before this choice: allowed.
       */
      allowMerge?: boolean;
    } & EnrollResponse)
  | { status: 'refused' }
  | { status: 'expired' };

// ── Remote control ─────────────────────────────────────────────────────────

/**
 * Commands a remote controller may send: navigation, and adding, removing and reordering
 * items of the live run sheet. Never song editing, other dates or Go live.
 *
 * Edits name items rather than positions, so one made from a slightly old view still lands
 * where it was meant to. `afterItemId` null means the top of the run sheet; an added song
 * without it goes to the end.
 */
export const RemoteCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('playPiece'), itemId: z.string(), pieceId: z.string() }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('previous') }),
  z.object({ type: z.literal('nextItem') }),
  z.object({ type: z.literal('previousItem') }),
  z.object({ type: z.literal('blank') }),
  z.object({ type: z.literal('unblank') }),
  z.object({ type: z.literal('clear') }),
  z.object({
    type: z.literal('addItem'),
    songId: z.string(),
    afterItemId: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('removeItem'), itemId: z.string() }),
  z.object({ type: z.literal('moveItem'), itemId: z.string(), afterItemId: z.string().nullable() }),
  // Video playback (protocol version 5, U21).
  z.object({ type: z.literal('videoPlay'), itemId: z.string() }),
  z.object({ type: z.literal('videoPause'), itemId: z.string() }),
  z.object({ type: z.literal('videoSeek'), itemId: z.string(), seconds: z.number().finite() }),
]);
export type RemoteCommand = z.infer<typeof RemoteCommandSchema>;
export type RemoteEditCommand = Extract<
  RemoteCommand,
  { type: 'addItem' | 'removeItem' | 'moveItem' }
>;
export type RemoteNavigationCommand = Exclude<RemoteCommand, RemoteEditCommand>;

export function isRemoteEdit(command: RemoteCommand): command is RemoteEditCommand {
  return command.type === 'addItem' || command.type === 'removeItem' || command.type === 'moveItem';
}

/**
 * Commands an operator device sends to the coordinator (decision D24): everything a phone
 * may send, stepping within an item, Go live with a date, and ending. Go live names the date
 * rather than a run sheet, because a run sheet made on one device has no identifier on
 * another until it has been synchronized.
 */
export const OperatorCommandSchema = z.discriminatedUnion('type', [
  ...RemoteCommandSchema.options,
  z.object({ type: z.literal('nextInItem') }),
  z.object({ type: z.literal('previousInItem') }),
  z.object({ type: z.literal('goLive'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ type: z.literal('end') }),
]);
export type OperatorCommand = z.infer<typeof OperatorCommandSchema>;

/** Who asked for a command, so notices and the connected-devices list name the right one. */
export const CommandOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('operator'), deviceId: z.string(), name: z.string().max(60) }),
  z.object({ kind: z.literal('phone'), grantId: z.string(), name: z.string().max(60) }),
]);
export type CommandOrigin = z.infer<typeof CommandOriginSchema>;

/** From a remote controller to the desktop it is connected to. */
export const RemoteToHostSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number(),
    /** The instance's identifier for the workspace; read by the relay. */
    workspace: z.string().max(100).optional(),
    name: z.string().max(60),
    /**
     * A fresh invitation from the QR code or link, as `<device id>.<secret>` so the relay
     * routes it to the desktop that showed it, or the grant from an earlier approval, which
     * belongs to the workspace and is accepted by any of its operator devices.
     */
    invite: z.string().max(200).optional(),
    grant: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('command'),
    id: z.string().min(1).max(100),
    command: RemoteCommandSchema,
  }),
  /** Searches the library for songs to add, as the operator's search does. */
  z.object({
    type: z.literal('search'),
    id: z.string().min(1).max(100),
    query: z.string().max(200),
  }),
  /** Answered by the relay, so a phone notices a connection lost while it slept. */
  z.object({ type: z.literal('ping') }),
  /** A command for OBS (protocol version 4), answered with `obsAck`. */
  z.object({
    type: z.literal('obsCommand'),
    id: z.string().min(1).max(100),
    command: ObsCommandSchema,
  }),
  /** The phone's OBS screen opened or closed: send it the live monitor's images, or stop. */
  z.object({ type: z.literal('obsWatch'), watching: z.boolean() }),
]);
export type RemoteToHost = z.infer<typeof RemoteToHostSchema>;

export interface RemoteItemView {
  itemId: string;
  title: string;
  removed: boolean;
  /**
   * Lyrics, imported slides, a website or a video; desktops before it was added leave it
   * out, and `video` came with protocol version 5.
   */
  kind?: 'lyrics' | 'deck' | 'website' | 'video';
  /** Its badge, as the desktop marks it; desktops before it was added leave it out. */
  badge?: ItemBadge;
  /** `block` numbers the song's blocks from 0; desktops before it was added leave it out. */
  /**
   * `thumbnail` names a small image of an imported slide, served to phones by the instance.
   * `textless` marks an imported slide without text, whose lines only name its place.
   */
  pieces: {
    id: string;
    lines: string[];
    block?: number;
    thumbnail?: string;
    textless?: boolean;
  }[];
}

/** A song found by a remote controller's search. */
export interface RemoteSongResult {
  id: string;
  title: string;
  /** Imported slides and websites are marked as on the desktop. */
  kind: 'lyrics' | 'deck' | 'website';
  /** Its badge, as the desktop marks it; desktops before it was added leave it out. */
  badge?: ItemBadge;
  /** The first lines of the lyrics, a deck's first slide text, or a website's address. */
  preview: string[];
}

/** What a remote controller is shown of the live presentation. */
export interface RemoteView {
  workspaceName: string;
  status: 'live' | 'ended';
  date: string | null;
  items: RemoteItemView[];
  presented: { itemId: string; pieceId: string } | null;
  /** The piece each item showed most recently, by item; desktops before it was added leave it out. */
  lastShown?: Record<string, string>;
  /** The screen still shows a slide from the previous run sheet. */
  previousContent: boolean;
  blank: boolean;
  /** True when the live run sheet can be edited; desktops before it was added leave it out. */
  editable?: boolean;
  /** OBS, when a device of the workspace has an active OBS link; absent from older desktops. */
  obs?: RemoteObsView | null;
  /**
   * The presented video item's playback, for the phone's control bar (U21); absent from
   * older desktops, null when no video item is presented.
   */
  video?: {
    itemId: string;
    playing: boolean;
    /** Seconds into the video at `at`. */
    position: number;
    at: string;
    durationSeconds: number;
  } | null;
}

/** From the desktop to a remote controller. */
export type HostToRemote =
  | { type: 'update-needed' }
  /** Waiting for an operator; the same code is shown on the operator's screen. */
  | { type: 'pending'; code: string }
  | { type: 'approved'; grant: string }
  | { type: 'denied'; reason: 'denied' | 'invalid-invite' | 'revoked' }
  | { type: 'view'; view: RemoteView }
  | { type: 'ack'; id: string; applied: boolean }
  | { type: 'searchResults'; id: string; songs: RemoteSongResult[] }
  | ({ type: 'obsAck'; id: string } & ObsResult)
  | ({ type: 'obsSnapshot' } & ObsSnapshot);

/** From the instance to a remote controller, about the connection itself. */
export type RelayToRemote =
  | { type: 'update-needed' }
  /**
   * `reconnect`: the desktop this phone was connected to went away; the phone connects
   * again with its grant and is routed to another operator device.
   */
  | { type: 'unavailable'; reason: 'no-workspace' | 'presentation-offline' | 'reconnect' }
  | { type: 'pong' };

// ── Shared live state ──────────────────────────────────────────────────────

/** One piece of a run-sheet item as the snapshot carries it. */
export const SnapshotPieceSchema = z.object({
  id: z.string().min(1),
  lines: z.array(z.string()),
  /** The song's block the piece belongs to, from 0. */
  block: z.number().int().min(0).optional(),
  /** An imported slide's image, among the workspace's files. */
  image: z.string().optional(),
  /** A small copy of that image, kept on the instance for phones. */
  thumbnail: z.string().optional(),
  /** An imported slide without text, whose lines only name its place. */
  textless: z.boolean().optional(),
  /** A video item's one piece: the video to play (protocol version 5, U14). */
  video: z
    .object({
      file: z.string().min(1),
      durationSeconds: z.number().min(0),
      width: z.number().int().min(0),
      height: z.number().int().min(0),
      autoplay: z.boolean(),
    })
    .optional(),
});
export type SnapshotPiece = z.infer<typeof SnapshotPieceSchema>;

/** How an item is presented; `video` came with protocol version 5 (U21). */
export const SnapshotKindSchema = z.enum(['lyrics', 'deck', 'website', 'video']);

/** One item of the live run sheet as the snapshot carries it. */
export const SnapshotItemSchema = z.object({
  itemId: z.string().min(1),
  songId: z.string().min(1),
  title: z.string(),
  /** The song was removed from the library; the item still presents it. */
  removed: z.boolean(),
  kind: SnapshotKindSchema,
  /** Its badge, as the desktop marks it; devices before it was added leave it out. */
  badge: ItemBadgeSchema.optional().catch(undefined),
  pieces: z.array(SnapshotPieceSchema),
});
export type SnapshotItem = z.infer<typeof SnapshotItemSchema>;

/**
 * What is on screen, carried so that a follower whose content is behind can still render it.
 * Lyrics are rendered from `pieces`; images and videos arrive by content synchronization.
 */
export const SnapshotPresentedSchema = z.object({
  itemId: z.string().min(1),
  pieceId: z.string().min(1),
  songId: z.string().min(1),
  title: z.string(),
  kind: SnapshotKindSchema,
  /** Every piece of the presented song, which the renderer needs to size the text. */
  pieces: z.array(SnapshotPieceSchema),
  /** The song's own background, if it has one. */
  background: z.object({ color: z.string(), assetId: z.string().nullable() }).nullable(),
  /** The web page a website song shows. */
  websiteUrl: z.string().nullable(),
  /** The slide is from the run sheet that was live before Go live (spec §7 rule 7). */
  previous: z.boolean(),
});
export type SnapshotPresented = z.infer<typeof SnapshotPresentedSchema>;

/** A device following the presentation, as shown in the connected-devices list. */
export const ConnectedDeviceSchema = z.object({
  /** Device identifier, grant identifier or output link identifier. */
  id: z.string().min(1),
  name: z.string(),
  role: z.enum(['coordinator', 'operator', 'viewer', 'phone', 'output']),
  /** `lan` is a direct connection on the venue network; `relay` goes through the instance. */
  connection: z.enum(['lan', 'relay']),
  /** ISO timestamp of the last message from the device. */
  lastSeenAt: z.string(),
  /** For phones: the operator device they are connected through. */
  via: z.string().optional(),
  /** Fonts the workspace asks for that the device lacks. */
  missingFonts: z.array(z.string()).optional(),
});
export type ConnectedDevice = z.infer<typeof ConnectedDeviceSchema>;

/**
 * The coordinator's view of the live state, sent whole to every follower on each change.
 * `revision` increases by one per snapshot, so a follower drops one older than what it has.
 */
export const LiveSnapshotSchema = z.object({
  revision: z.number().int().min(1),
  /** The device holding and ordering the live state. */
  coordinatorId: z.string().min(1),
  state: LiveStateSchema,
  /** Date of the live run sheet. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(SnapshotItemSchema),
  presented: SnapshotPresentedSchema.nullable(),
  devices: z.array(ConnectedDeviceSchema).default([]),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;

/** A remote controller's approval, shared by the workspace's operator devices (D25). */
export const WorkspaceGrantSchema = z.object({
  id: z.string().min(1),
  secretHash: z.string().min(1),
  name: z.string(),
  createdAt: z.string(),
});
export type WorkspaceGrant = z.infer<typeof WorkspaceGrantSchema>;

/** From an operator device to the coordinator, over the relay or the LAN. */
export const FollowerToCoordinatorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('command'),
    id: z.string().min(1).max(100),
    origin: CommandOriginSchema,
    command: OperatorCommandSchema,
  }),
  /** Asks for the full snapshot: on connecting, and when one seems to have been missed. */
  z.object({ type: z.literal('resync'), have: z.number().int().min(0) }),
  /** The old coordinator's final snapshot, sent to the new one on handover (M2.3). */
  z.object({ type: z.literal('handover'), snapshot: LiveSnapshotSchema }),
  z.object({ type: z.literal('grantRegister'), grant: WorkspaceGrantSchema }),
  /** `id` null revokes every grant of the workspace. */
  z.object({ type: z.literal('grantRevoke'), id: z.string().nullable() }),
  /** The phones connected through this device, for the connected-devices list. */
  z.object({
    type: z.literal('phones'),
    phones: z.array(z.object({ grantId: z.string(), name: z.string() })),
  }),
  z.object({ type: z.literal('capabilities'), capabilities: CapabilitiesSchema }),
  // OBS control (protocol version 4; see `./obs`).
  /** From the OBS computer: its OBS state, and once its link is turned off, the last one. */
  z.object({ type: z.literal('obsState'), state: ObsStateSchema }),
  /** A command for OBS, to be forwarded to the OBS computer. */
  z.object({
    type: z.literal('obsCommand'),
    id: z.string().min(1).max(100),
    command: ObsCommandSchema,
  }),
  /** From the OBS computer: the answer to a forwarded command. */
  z
    .object({ type: z.literal('obsAck'), id: z.string().min(1).max(100) })
    .extend(ObsResultSchema.shape),
  /** This device shows the live monitor, or stopped showing it. */
  z.object({ type: z.literal('obsWatch'), watching: z.boolean() }),
  /** From the OBS computer: an image for the devices showing the live monitor. */
  z.object({ type: z.literal('obsSnapshot') }).extend(ObsSnapshotSchema.shape),
]);
export type FollowerToCoordinator = z.infer<typeof FollowerToCoordinatorSchema>;

/** From the coordinator to the workspace's other devices. */
export const CoordinatorToFollowerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), snapshot: LiveSnapshotSchema }),
  z.object({
    type: z.literal('ack'),
    id: z.string(),
    applied: z.boolean(),
  }),
  /** Sent every few seconds; a follower behind `revision` asks for a resync. */
  z.object({ type: z.literal('alive'), revision: z.number().int().min(0) }),
  z.object({ type: z.literal('grantList'), grants: z.array(WorkspaceGrantSchema) }),
  /** A live run-sheet edit made elsewhere, shown to operators without Undo (D24). */
  z.object({
    type: z.literal('notice'),
    origin: CommandOriginSchema,
    change: z.object({
      kind: z.enum(['added', 'removed', 'moved']),
      title: z.string(),
      toIndex: z.number().int().min(0).optional(),
    }),
  }),
  // OBS control (protocol version 4), only to devices declaring the `obs` capability.
  /** The workspace's OBS state; null when no device has an active OBS link. */
  z.object({ type: z.literal('obsState'), state: ObsStateSchema.nullable() }),
  /** To the OBS computer: a command from another device. */
  z.object({
    type: z.literal('obsCommand'),
    id: z.string().min(1).max(100),
    command: ObsCommandSchema,
  }),
  /** To the device that asked: the answer to its command. */
  z
    .object({ type: z.literal('obsAck'), id: z.string().min(1).max(100) })
    .extend(ObsResultSchema.shape),
  /** To the OBS computer: whether any other device is showing the live monitor. */
  z.object({ type: z.literal('obsWatch'), watching: z.boolean() }),
  /** To the devices showing the live monitor. */
  z.object({ type: z.literal('obsSnapshot') }).extend(ObsSnapshotSchema.shape),
]);
export type CoordinatorToFollower = z.infer<typeof CoordinatorToFollowerSchema>;

/** What a browser output page is shown: the snapshot, and what it needs to draw it. */
export interface OutputView {
  snapshot: LiveSnapshot | null;
  /** The output's look, as the workspace's settings have it. */
  look: {
    fontFamily: string | null;
    scale: number;
    backgroundColor: string;
    /** File name of the background image or video, fetched from the instance. */
    backgroundFile: { kind: BackgroundKind; fileName: string } | null;
    linesPerPiece: number;
    wrapLongLines: boolean;
  } | null;
}

// ── Desktops and the relay ─────────────────────────────────────────────────

/** A live state's place in time, for settling which of two copies is kept (D14). */
export interface LiveStanding {
  /** When the live state started; the older one is kept. */
  startedAt: string;
  /** When it last changed; between copies of one live state, the more recent is kept. */
  updatedAt: string;
}

/**
 * What a desktop is doing with the live state as it connects, so the relay can tell, after
 * an outage, who was presenting all along (D14).
 */
export type LivePresence =
  /** Presenting: as coordinator before the connection dropped, or alone while offline. */
  | ({ kind: 'coordinating' } & LiveStanding)
  /** Following a coordinator over the LAN, which is therefore still presenting. */
  | ({ kind: 'following'; deviceId: string; name: string } & LiveStanding);

/**
 * From a desktop to the instance relay. Every desktop of a workspace connects; one of them,
 * the coordinator, holds the live state. The first operator device to connect becomes the
 * coordinator, and another takes over only when an operator asks it to, or when a desktop
 * returning from an outage was presenting an older live state (D14). Each desktop
 * receives the phones that scanned its own invitation, and forwards their commands to the
 * coordinator (D25).
 */
export type DesktopToRelay =
  | {
      type: 'hello';
      protocolVersion: number;
      token: string;
      capabilities: Capabilities;
      /** Omitted by desktops before viewer mode existed. */
      role?: DeviceRole;
      /** For the LAN (D19, D20): this device's certificate fingerprint and addresses. */
      lan?: { fingerprint: string; addresses: string[]; port: number } | null;
      /** Omitted by desktops before it existed, and by one with no live state to report. */
      live?: LivePresence | null;
    }
  /**
   * What this desktop does with the live state changed since its hello: it started or
   * stopped following a coordinator over the LAN, or presenting. Omitted by desktops
   * before it existed; a relay before it existed ignores it.
   */
  | { type: 'presence'; live: LivePresence | null }
  /** `to` is a remote connection, or every remote connection of this desktop when omitted. */
  | { type: 'send'; to?: string; data: HostToRemote }
  | { type: 'drop'; to: string }
  /** Become the coordinator in place of another device, or where there is none. */
  | { type: 'claim' }
  /** To the coordinator. */
  | { type: 'toCoordinator'; data: FollowerToCoordinator }
  /** From the coordinator to one desktop, or to every other desktop and output when omitted. */
  | { type: 'toFollower'; to?: string; data: CoordinatorToFollower }
  /**
   * Answered with a pong. Browsers do not expose WebSocket pings, so this is how a desktop
   * notices a connection the instance dropped while the computer slept.
   */
  | { type: 'ping' };
/** The name before several desktops shared one live state. */
export type CoordinatorToRelay = DesktopToRelay;

/** A desktop or browser output connected to the relay, as told to the others. */
export interface RelayPeer {
  deviceId: string;
  name: string;
  role: DeviceRole | 'output';
  capabilities?: Capabilities;
  lan?: { fingerprint: string; addresses: string[]; port: number } | null;
  connectedAt: string;
}

/** From the instance relay to a desktop. */
export type RelayToDesktop =
  | {
      type: 'ready';
      workspaceId: string;
      deviceId: string;
      /** True when this device is the coordinator. */
      coordinator: boolean;
      coordinatorName: string | null;
      coordinatorId: string | null;
      /** Every desktop and output of the workspace connected right now, this one included. */
      peers: RelayPeer[];
      /**
       * False when this device lost the role to another live state on reconnecting (D14):
       * its own is dropped rather than handed over, so the role and the content kept stay
       * together. Omitted, a coordinator that loses the role hands its last snapshot over.
       */
      handover?: boolean;
    }
  | { type: 'update-needed' }
  | { type: 'rejected'; reason: 'unauthorized' }
  /** Another device changed content; pull now. */
  | { type: 'changed' }
  /** From one of this desktop's phones. */
  | { type: 'message'; from: string; data: unknown }
  | { type: 'left'; from: string }
  /** From another desktop: a follower's message to the coordinator, or the other way. */
  | { type: 'peer'; from: string; data: unknown }
  | { type: 'pong' };
/** The name before several desktops shared one live state. */
export type RelayToCoordinator = RelayToDesktop;

// ── Browser outputs ────────────────────────────────────────────────────────

/** From a browser output page to the relay, with its output link's token. */
export const OutputToRelaySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number(),
    token: z.string().min(1).max(200),
    capabilities: CapabilitiesSchema.partial().optional(),
  }),
  z.object({ type: z.literal('ping') }),
]);
export type OutputToRelay = z.infer<typeof OutputToRelaySchema>;

/** From the relay to a browser output page. It may send nothing else. */
export type RelayToOutput =
  | { type: 'update-needed' }
  | { type: 'rejected'; reason: 'unauthorized' | 'revoked' }
  | { type: 'ready'; kind: OutputKind; look: OutputView['look'] }
  /** Nothing is live, or the coordinator is away; the last snapshot may be kept. */
  | { type: 'waiting' }
  | { type: 'snapshot'; snapshot: LiveSnapshot }
  | { type: 'pong' };

/** A browser output link as Settings → Outputs lists it (D22). */
export interface OutputLink {
  id: string;
  kind: OutputKind;
  name: string;
  createdAt: string;
  /** Only when the link was just created; never stored or shown again. */
  url?: string;
}

/** Header carrying the protocol version on every request to the instance. */
export const PROTOCOL_HEADER = 'x-worship-q-protocol';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Replaces each half of a broken surrogate pair with U+FFFD, in a string or anywhere in an
 * object. JavaScript strings may hold one, but JSON readers outside JavaScript reject it.
 */
export function wellFormed<T>(value: T): T {
  if (typeof value === 'string') return value.replace(LONE_SURROGATE, '�') as T;
  if (Array.isArray(value)) return value.map(wellFormed) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, wellFormed(item)]),
    ) as T;
  }
  return value;
}

/**
 * A snapshot for a device older than video items (U20): each video item becomes a slide deck
 * with nothing to show, so it keeps its title and place, and nothing it cannot read is sent.
 */
export function snapshotWithoutVideos(snapshot: LiveSnapshot): LiveSnapshot {
  const hasVideo =
    snapshot.items.some((item) => item.kind === 'video') || snapshot.presented?.kind === 'video';
  if (!hasVideo) return snapshot;
  // A video item's badge goes too, so it reads as the slide deck it now is.
  const plain = <
    T extends { kind: SnapshotItem['kind']; badge?: ItemBadge; pieces: SnapshotPiece[] },
  >(
    item: T,
  ): T => (item.kind === 'video' ? { ...item, kind: 'deck', badge: undefined, pieces: [] } : item);
  return {
    ...snapshot,
    items: snapshot.items.map(plain),
    presented: snapshot.presented && plain(snapshot.presented),
  };
}
