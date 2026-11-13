/**
 * **Listen** on the phone (live audio plan §3; task breakdown M4.4): the same `Listener` as
 * the desktop, its signals through the desktop this phone uses, and an `<audio>` element
 * started from the tap, which is the gesture phone browsers require. The ICE servers come in
 * the broadcaster's offer (M4.3), so the phone needs no credential of its own. When the page
 * comes back into view while listening, it connects afresh (A24).
 */
import {
  ListenPlayer,
  browserAudioOutput,
  browserListenPeer,
  type Clock,
  type DelayFigure,
  type ListenOutput,
  type ListenPeer,
  type ListenPeerEvents,
  type ListenState,
  type ListenStatus,
} from '@worship-q/audio';
import type { IceServer, RemoteAudioView } from '@worship-q/protocol';
import type { RemoteConnection } from './connection';

export type PhoneListenState = ListenState;

/** What the page supplies; the browser's own in the app, fakes in tests. */
export interface PhoneListenDeps {
  output?: ListenOutput<MediaStream>;
  createPeer?: (args: {
    iceServers: IceServer[];
    events: ListenPeerEvents<MediaStream>;
  }) => ListenPeer;
  /** Calls back each time the page comes into view. */
  onVisible?: (listener: () => void) => void;
  clock?: Clock;
}

function whenVisible(listener: () => void): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') listener();
  });
}

export class PhoneListen {
  private readonly player: ListenPlayer<MediaStream>;

  constructor(
    connection: Pick<RemoteConnection, 'sendAudio' | 'onAudioSignal' | 'onRejoin'>,
    deps: PhoneListenDeps = {},
  ) {
    this.player = new ListenPlayer<MediaStream>({
      createPeer: deps.createPeer ?? browserListenPeer,
      send: (_ownerId, signal) => connection.sendAudio(signal),
      // Started from the tap, the gesture phone browsers require.
      output: deps.output ?? browserAudioOutput({ inline: true }),
      ...(deps.clock ? { clock: deps.clock } : {}),
    });
    connection.onAudioSignal((signal) => this.player.signal(signal));
    // Back in view, the phone may have fallen behind (A24). Let in again after losing its
    // desktop, perhaps by another one, it asks again (§3.9): the broadcaster then answers
    // the way the phone is reached now, and the desktop it left may close what it carried.
    (deps.onVisible ?? whenVisible)(() => this.player.refresh());
    connection.onRejoin(() => this.player.refresh());
  }

  get state(): PhoneListenState {
    return this.player.state;
  }

  subscribe = (listener: () => void): (() => void) => this.player.subscribe(listener);

  /** The view's broadcast changed. */
  follow(audio: RemoteAudioView | null | undefined): void {
    this.player.setBroadcast(
      audio
        ? {
            ownerId: audio.ownerId,
            activatedAt: audio.activatedAt,
            active: true,
            status: audio.status,
          }
        : null,
    );
  }

  /** The tap: playback is unlocked inside it, before anything is awaited. */
  start(): void {
    this.player.start();
  }

  stop(): void {
    this.player.stop();
  }
}

/** **Listen**'s state in words, on the phone. */
export function phoneListenText(status: ListenStatus): string {
  switch (status.kind) {
    case 'off':
      return 'Not listening';
    case 'connecting':
      return 'Connecting…';
    case 'playing':
      return 'Playing';
    case 'waiting':
      return 'Connected; the broadcast is waiting for its input';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'full':
      return 'The broadcast is full: ten are listening already';
    case 'unreachable':
      return status.relay
        ? 'Could not connect. The church’s relay was tried; this network may block it.'
        : 'Could not connect from this network, and the church’s server offers no relay.';
  }
}

/** The delay figure and path on one line; null while there is none. */
export function phoneDelayText(delay: DelayFigure | null): string | null {
  if (!delay) return null;
  const figure =
    delay.delayMs === null ? 'Network and buffer: –' : `Network and buffer: ${delay.delayMs} ms`;
  const path = delay.path === 'relayed' ? 'Relayed' : delay.path === 'direct' ? 'Direct' : null;
  return path ? `${figure} · ${path}` : figure;
}
