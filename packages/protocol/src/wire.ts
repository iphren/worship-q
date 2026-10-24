/**
 * Messages between devices and the church instance: version negotiation, capabilities,
 * content synchronization and remote control.
 *
 * Common desktop builds and church-hosted backends are released independently, so every
 * connection starts by stating its protocol version, and an incompatible peer is told to
 * update rather than failing unpredictably.
 */
import { z } from 'zod';

/** The protocol this build speaks. */
export const PROTOCOL_VERSION = 1;
/** The oldest protocol this build still accepts from a peer. */
export const MIN_PROTOCOL_VERSION = 1;

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
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

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

/** Commands a remote controller may send: navigation only, never editing or Go live. */
export const RemoteCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('playPiece'), itemId: z.string(), pieceId: z.string() }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('previous') }),
  z.object({ type: z.literal('nextItem') }),
  z.object({ type: z.literal('previousItem') }),
  z.object({ type: z.literal('blank') }),
  z.object({ type: z.literal('unblank') }),
  z.object({ type: z.literal('clear') }),
]);
export type RemoteCommand = z.infer<typeof RemoteCommandSchema>;

/** From a remote controller to the coordinator. */
export const RemoteToHostSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number(),
    /** The instance's identifier for the workspace; read by the relay. */
    workspace: z.string().max(100).optional(),
    name: z.string().max(60),
    /** A fresh invitation from the QR code or link, or the grant from an earlier approval. */
    invite: z.string().max(200).optional(),
    grant: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('command'),
    id: z.string().min(1).max(100),
    command: RemoteCommandSchema,
  }),
]);
export type RemoteToHost = z.infer<typeof RemoteToHostSchema>;

export interface RemoteItemView {
  itemId: string;
  title: string;
  removed: boolean;
  /** `block` numbers the song's blocks from 0; desktops before it was added leave it out. */
  /**
   * `thumbnail` names a small image of an imported slide, served to phones by the instance.
   */
  pieces: { id: string; lines: string[]; block?: number; thumbnail?: string }[];
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
}

/** From the coordinator to a remote controller. */
export type HostToRemote =
  | { type: 'update-needed' }
  /** Waiting for an operator; the same code is shown on the operator's screen. */
  | { type: 'pending'; code: string }
  | { type: 'approved'; grant: string }
  | { type: 'denied'; reason: 'denied' | 'invalid-invite' | 'revoked' }
  | { type: 'view'; view: RemoteView }
  | { type: 'ack'; id: string; applied: boolean };

/** From the instance to a remote controller, about the connection itself. */
export type RelayToRemote =
  | { type: 'update-needed' }
  | { type: 'unavailable'; reason: 'no-workspace' | 'presentation-offline' };

/**
 * From a desktop to the instance relay. Several desktops of a workspace may be connected;
 * one of them, the coordinator, receives the remote controllers. The first to connect
 * becomes the coordinator, and another takes over only when an operator asks it to.
 */
export type CoordinatorToRelay =
  | { type: 'hello'; protocolVersion: number; token: string; capabilities: Capabilities }
  /** `to` is a remote connection, or every remote connection when omitted. */
  | { type: 'send'; to?: string; data: HostToRemote }
  | { type: 'drop'; to: string }
  /** Become the coordinator in place of another device. */
  | { type: 'claim' };

/** From the instance relay to a desktop. */
export type RelayToCoordinator =
  | {
      type: 'ready';
      workspaceId: string;
      /** True when this device receives the remote controllers. */
      coordinator: boolean;
      coordinatorName: string | null;
    }
  | { type: 'update-needed' }
  | { type: 'rejected'; reason: 'unauthorized' }
  /** Another device changed content; pull now. */
  | { type: 'changed' }
  | { type: 'message'; from: string; data: unknown }
  | { type: 'left'; from: string };

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
