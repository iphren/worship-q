/**
 * OBS control (OBS control plan; decisions O1–O12): the OBS state a workspace shares, the
 * commands for it, and the live monitor's images.
 *
 * One desktop of the workspace, the one on the computer OBS runs on, holds the connection to
 * OBS and owns the OBS state, in any role (O1, O8). It publishes the state to the coordinator,
 * which passes it on to the other desktops and they to their phones; commands travel the
 * other way and are answered to the device that asked. The coordinator only forwards (O11).
 * These messages came with protocol version 4, and a coordinator sends them only to devices
 * that declare the `obs` capability, so older desktops see nothing new.
 */
import { z } from 'zod';

/** The protocol version that carries OBS messages; the relay refuses them before it. */
export const OBS_PROTOCOL_VERSION = 4;

/** The OBS computer's connection to OBS, as the status indicator shows it (plan §3). */
export const ObsConnectionSchema = z.enum(['not-running', 'connecting', 'connected', 'refused']);
export type ObsConnection = z.infer<typeof ObsConnectionSchema>;

/** Streaming, recording or the virtual camera. */
export const ObsOutputSchema = z.object({
  active: z.boolean(),
  /** Between states, as OBS reports them. */
  phase: z.enum(['starting', 'stopping', 'reconnecting']).nullable(),
  /**
   * How long it had been running when the state was sent, in milliseconds; null when not
   * running. A receiver adds the time since it received the state, so clocks need not agree.
   */
  durationMs: z.number().int().min(0).nullable(),
  /** Recording only: paused in OBS, so the duration does not advance. */
  paused: z.boolean(),
});
export type ObsOutput = z.infer<typeof ObsOutputSchema>;

const SceneNameSchema = z.string().min(1).max(256);

/**
 * The workspace's OBS state, owned by the device whose OBS link is active (O8). A later
 * activation takes it over (O9): see `newerObsState` in `@worship-q/live-state`.
 */
export const ObsStateSchema = z.object({
  /** The device holding the connection to OBS. */
  ownerId: z.string().min(1).max(100),
  ownerName: z.string().max(100),
  /** When the owner's link was turned on; the later activation wins. */
  activatedAt: z.string().min(1).max(40),
  /** Increases with each state the owner sends for one activation. */
  revision: z.number().int().min(0),
  /** False once the owner turned its link off: the controls disappear everywhere. */
  active: z.boolean(),
  status: ObsConnectionSchema,
  /** In the order OBS lists them, top first. */
  scenes: z.array(SceneNameSchema).max(500),
  /** The scene on program. */
  currentScene: SceneNameSchema.nullable(),
  /** The two sides of the switch button, chosen on the OBS computer (O4). */
  favourites: z.tuple([SceneNameSchema.nullable(), SceneNameSchema.nullable()]),
  stream: ObsOutputSchema,
  record: ObsOutputSchema,
  virtualCam: ObsOutputSchema,
});
export type ObsState = z.infer<typeof ObsStateSchema>;

/**
 * What another device may ask of OBS (O3). Each names the state wanted rather than toggling,
 * so two operators pressing at once cannot cancel each other out.
 */
export const ObsCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setScene'), scene: SceneNameSchema }),
  z.object({ type: z.literal('startStream') }),
  z.object({ type: z.literal('stopStream') }),
  z.object({ type: z.literal('startRecord') }),
  z.object({ type: z.literal('stopRecord') }),
  z.object({ type: z.literal('startVirtualCam') }),
  z.object({ type: z.literal('stopVirtualCam') }),
]);
export type ObsCommand = z.infer<typeof ObsCommandSchema>;

/** Why a command failed, when it was not OBS that refused it. */
export const OBS_ERRORS = {
  /** No device of the workspace has an active OBS link. */
  noObs: 'no-obs',
  /** The OBS computer is not connected to OBS. */
  notConnected: 'not-connected',
  /** No answer from the OBS computer in time. */
  timeout: 'timeout',
  /** The OBS computer left, or another took over, before answering. */
  ownerLeft: 'owner-left',
} as const;

/** The answer to a command: OBS's error code and comment when it refused. */
export const ObsResultSchema = z.object({
  ok: z.boolean(),
  code: z.number().int().optional(),
  error: z.string().max(300).optional(),
});
export type ObsResult = z.infer<typeof ObsResultSchema>;

/**
 * How often the OBS computer takes a live monitor image while anyone watches (O6): rarely
 * enough to leave OBS's rendering alone. Monitors count down to the next image with it.
 */
export const OBS_SNAPSHOT_EVERY_MS = 3000;

/**
 * A monitor image older than this is shown as stale (M5.2): one image missed, with time to
 * travel.
 */
export const OBS_SNAPSHOT_STALE_MS = OBS_SNAPSHOT_EVERY_MS * 2.5;

/** One image of the program output, for the live monitor (O6). */
export const ObsSnapshotSchema = z.object({
  /** A small image as a data URL; nothing else is ever put in an image's address. */
  image: z
    .string()
    .max(700_000)
    .regex(/^data:image\/(webp|jpeg|jpg|png);base64,[A-Za-z0-9+/]+=*$/),
  /** On the OBS computer's clock; shown only as an age next to the receiver's own. */
  takenAt: z.string().min(1).max(40),
});
export type ObsSnapshot = z.infer<typeof ObsSnapshotSchema>;

/** Which favourite is on program: 0, 1, or null when neither is. */
export function liveFavourite(view: Pick<ObsState, 'currentScene' | 'favourites'>): 0 | 1 | null {
  if (view.currentScene === null) return null;
  if (view.favourites[0] === view.currentScene) return 0;
  if (view.favourites[1] === view.currentScene) return 1;
  return null;
}

/**
 * Where the switch button goes (O4): to the other favourite when one is live, else to the
 * first. A favourite OBS no longer has is skipped. Null when there is nowhere to go.
 */
export function switchTarget(
  view: Pick<ObsState, 'scenes' | 'currentScene' | 'favourites'>,
): string | null {
  const [first, second] = view.favourites;
  const usable = (scene: string | null): scene is string =>
    scene !== null && view.scenes.includes(scene);
  const options = [first, second].filter(usable);
  if (options.length === 0) return null;
  const live = liveFavourite(view);
  if (options.length === 2 && first !== second) {
    if (live === 0) return second;
    if (live === 1) return first;
    return first;
  }
  const only = options[0]!;
  return view.currentScene === only ? null : only;
}

/**
 * How long an output has run, now: the duration sent with the state plus the time since it
 * was received, on the receiver's clock.
 */
export function outputElapsed(output: ObsOutput, receivedAt: number, now: number): number | null {
  if (!output.active || output.durationMs === null) return null;
  return output.durationMs + (output.paused ? 0 : Math.max(0, now - receivedAt));
}

/** What a phone is shown of OBS, inside its view; absent or null when there is nothing. */
export interface RemoteObsView {
  status: ObsConnection;
  ownerName: string;
  /** False while commands cannot reach the OBS computer from here. */
  reachable: boolean;
  scenes: string[];
  currentScene: string | null;
  favourites: [string | null, string | null];
  stream: ObsOutput;
  record: ObsOutput;
  virtualCam: ObsOutput;
}
