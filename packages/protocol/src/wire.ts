/**
 * Messages between devices and the church instance: version negotiation, capabilities,
 * content synchronization and remote control.
 *
 * Common desktop builds and church-hosted backends are released independently, so every
 * connection starts by stating its protocol version, and an incompatible peer is told to
 * update rather than failing unpredictably.
 */
import { z } from 'zod';
import { LiveStateSchema, type BackgroundKind, type OutputKind } from './records';

/**
 * The protocol this build speaks. Version 2 (phase 2) added one live state per workspace,
 * shared between every operator device through a coordinator, so a workspace never mixes
 * version 1 and version 2 desktops.
 */
export const PROTOCOL_VERSION = 2;
/** The oldest protocol this build still accepts from a peer. */
export const MIN_PROTOCOL_VERSION = 2;

export function isCompatibleProtocol(version: unknown): boolean {
  return (
    typeof version === 'number' && version >= MIN_PROTOCOL_VERSION && version <= PROTOCOL_VERSION
  );
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
]);
export type RemoteToHost = z.infer<typeof RemoteToHostSchema>;

export interface RemoteItemView {
  itemId: string;
  title: string;
  removed: boolean;
  /** Lyrics, imported slides or a website; desktops before it was added leave it out. */
  kind?: 'lyrics' | 'deck' | 'website';
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
  /** The screen still shows a slide from the previous run sheet. */
  previousContent: boolean;
  blank: boolean;
  /** True when the live run sheet can be edited; desktops before it was added leave it out. */
  editable?: boolean;
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
  | { type: 'searchResults'; id: string; songs: RemoteSongResult[] };

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
});
export type SnapshotPiece = z.infer<typeof SnapshotPieceSchema>;

/** One item of the live run sheet as the snapshot carries it. */
export const SnapshotItemSchema = z.object({
  itemId: z.string().min(1),
  songId: z.string().min(1),
  title: z.string(),
  /** The song was removed from the library; the item still presents it. */
  removed: z.boolean(),
  kind: z.enum(['lyrics', 'deck', 'website']),
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
  kind: z.enum(['lyrics', 'deck', 'website']),
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

/**
 * From a desktop to the instance relay. Every desktop of a workspace connects; one of them,
 * the coordinator, holds the live state. The first operator device to connect becomes the
 * coordinator, and another takes over only when an operator asks it to (D14). Each desktop
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
    }
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
