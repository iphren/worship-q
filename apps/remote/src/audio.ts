/**
 * **Listen** on the phone (live audio plan §3; task breakdown M4.4): the same `Listener` as
 * the desktop, its signals through the desktop this phone uses, and an `<audio>` element
 * started from the tap, which is the gesture phone browsers require. The ICE servers come in
 * the broadcaster's offer (M4.3), so the phone needs no credential of its own. When the page
 * comes back into view while listening, it connects afresh (A24).
 */
import {
  DelayMeter,
  Listener,
  browserListenPeer,
  readStats,
  type DelayFigure,
  type ListenStatus,
} from '@worship-q/audio';
import type { RemoteAudioView } from '@worship-q/protocol';
import type { RemoteConnection } from './connection';

const STATS_EVERY_MS = 2000;

export interface PhoneListenState {
  status: ListenStatus;
  delay: DelayFigure | null;
}

export class PhoneListen {
  private readonly listener: Listener<MediaStream>;
  private readonly element: HTMLAudioElement;
  private readonly meter = new DelayMeter();
  private state_: PhoneListenState = { status: { kind: 'off' }, delay: null };
  private readonly subscribers = new Set<() => void>();
  private statsTimer: ReturnType<typeof setInterval> | undefined;

  constructor(connection: RemoteConnection) {
    this.element = document.createElement('audio');
    this.element.autoplay = true;
    this.element.setAttribute('playsinline', '');
    document.body.appendChild(this.element);
    this.listener = new Listener<MediaStream>({
      createPeer: browserListenPeer,
      send: (_ownerId, signal) => connection.sendAudio(signal),
      onStream: (stream) => {
        this.element.srcObject = stream;
        if (stream) void this.element.play().catch(() => undefined);
      },
      onStatus: (status) => {
        this.update({ status, ...(status.kind === 'off' ? { delay: null } : {}) });
        if (status.kind === 'off') clearInterval(this.statsTimer);
      },
    });
    connection.onAudioSignal((signal) => this.listener.signal(signal));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.listener.refresh();
    });
  }

  get state(): PhoneListenState {
    return this.state_;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  /** The view's broadcast changed. */
  follow(audio: RemoteAudioView | null | undefined): void {
    this.listener.setBroadcast(
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
    void this.element.play().catch(() => undefined);
    this.meter.reset();
    this.listener.start();
    clearInterval(this.statsTimer);
    this.statsTimer = setInterval(() => void this.readStats(), STATS_EVERY_MS);
  }

  stop(): void {
    this.listener.stop();
  }

  private async readStats(): Promise<void> {
    const session = this.listener.sessionId;
    if (!session) return;
    const report = await this.listener.stats().catch(() => null);
    if (!report || this.listener.sessionId !== session) return;
    const figure = this.meter.push(session, readStats(report, Date.now()));
    this.listener.reportBuffer(figure.bufferMs);
    this.update({ delay: figure });
  }

  private update(patch: Partial<PhoneListenState>): void {
    this.state_ = { ...this.state_, ...patch };
    for (const listener of [...this.subscribers]) listener();
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

/** The note of A24, shown beside the button. */
export const LOCK_NOTE =
  'The sound may stop when the screen locks or the browser goes to the background.';
