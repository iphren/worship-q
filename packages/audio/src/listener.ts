/**
 * One listener (live audio plan A5, A17, A18; task breakdown M3.1, M5.4): nothing plays
 * until **Listen** is pressed; once pressed, it keeps itself connected to whoever broadcasts
 * until it is released, the broadcast ends for good, or it is refused as full.
 *
 * The same logic runs on the desktop, the phone page and the admin page; each supplies the
 * connection (`createPeer`), the way signals travel (`send`) and what to do with the sound
 * (`onStream`). It asks for a connection, answers the broadcaster's offer with the tuned Opus
 * settings, restarts ICE on `disconnected`, asks again after a growing wait on `failed`, and
 * connects afresh, new connection first and old one closed after, when the broadcaster took
 * its input again (A17) or the buffer has grown (A18).
 */
import {
  AUDIO_CLOSE,
  tuneOpusDescription,
  type AudioCandidate,
  type AudioSignal,
  type AudioStatus,
  type IceServer,
} from '@worship-q/protocol';
import { newSessionId, systemClock, type Clock, type PeerState } from './timers';

/** No offer this long after asking: asked again with a new session. */
export const OFFER_WAIT_MS = 5000;
/** Waits before asking again after a failure, growing, the last one repeated. */
export const RETRY_MS = [1000, 2000, 4000, 8000, 15000];
/** Not connected this long after pressing or losing the connection: the listener is told. */
export const UNREACHABLE_MS = 15_000;
/** A fresh connection that brings no sound this long after answering is given up (A17). */
export const FRESH_WAIT_MS = 3000;
/** `retaken` again within this long starts no second fresh connection. */
export const RETAKEN_DEBOUNCE_MS = 1000;
/** A buffer above this… */
export const BUFFER_HIGH_MS = 300;
/** …for this long asks for a fresh connection (A18)… */
export const BUFFER_HIGH_FOR_MS = 3000;
/** …at most this often. */
export const BUFFER_FRESH_EVERY_MS = 10_000;
/** With no broadcast for this long, **Listen** turns itself off. */
export const NO_BROADCAST_MS = 60_000;
/** Disconnected this long after an ICE restart was asked for: treated as failed. */
export const RESTART_WAIT_MS = 8000;

/** One receive-only connection, as the listener drives it. */
export interface ListenPeer {
  /**
   * Sets the broadcaster's offer, makes an answer, passes it through `tune` and sets the
   * result as the local description, which it returns. Called again for an ICE restart.
   */
  answer(offer: string, tune: (sdp: string) => string): Promise<string>;
  addCandidate(candidate: AudioCandidate): Promise<void>;
  /** Takes another ICE list for the next gathering, before an ICE restart is answered (A10). */
  setIceServers?(iceServers: IceServer[]): void;
  close(): void;
  /** The connection's statistics, for the delay figure; null when it has none. */
  stats?(): Promise<unknown>;
}

export interface ListenPeerEvents<S> {
  candidate(candidate: AudioCandidate): void;
  state(state: PeerState): void;
  /** The broadcaster's audio arrived on this connection. */
  stream(stream: S): void;
}

/** What the listener follows: the workspace's audio state, as this device has it. */
export interface Broadcast {
  ownerId: string;
  activatedAt: string;
  active: boolean;
  status: AudioStatus;
}

export type ListenStatus =
  | { kind: 'off' }
  | { kind: 'connecting' }
  | { kind: 'playing' }
  /** Connected, and the broadcaster waits for its input device: silence for now. */
  | { kind: 'waiting' }
  | { kind: 'reconnecting' }
  /** Ten others listen; nothing is retried until **Listen** is pressed again. */
  | { kind: 'full' }
  /**
   * No connection could be made (M5.4); still retrying. `relay` says whether a TURN relay
   * was among the ICE servers tried.
   */
  | { kind: 'unreachable'; relay: boolean };

export interface ListenerDeps<S> {
  createPeer(args: { iceServers: IceServer[]; events: ListenPeerEvents<S> }): ListenPeer;
  /** Sends a signal to the broadcaster. */
  send(ownerId: string, signal: AudioSignal): void;
  /**
   * ICE servers for a connection whose offer carries none (A10): a desktop asks its server.
   * A phone and an administrator use the offer's.
   */
  iceServers?(): Promise<IceServer[]>;
  /** What to play: the stream of the connection in use, or null to stop. */
  onStream(stream: S | null): void;
  onStatus?(status: ListenStatus): void;
  clock?: Clock;
  newId?: () => string;
}

interface Session<S> {
  id: string;
  ownerId: string;
  peer: ListenPeer | null;
  /** The offer was answered; candidates wait until then. */
  answered: boolean;
  held: AudioCandidate[];
  stream: S | null;
  connected: boolean;
  offerTimer: unknown;
  freshTimer: unknown;
  restartTimer: unknown;
  restarting: boolean;
}

export class Listener<S> {
  private on = false;
  private broadcast: Broadcast | null = null;
  /**
   * The last broadcast seen, kept while there is none: the same one back after a moment
   * (a new coordinator, a blip of the broadcaster's connection) is not a new one.
   */
  private last: Pick<Broadcast, 'ownerId' | 'activatedAt'> | null = null;
  private primary: Session<S> | null = null;
  private fresh: Session<S> | null = null;
  private status_: ListenStatus = { kind: 'off' };
  private attempt = 0;
  private retryTimer: unknown = null;
  private unreachableTimer: unknown = null;
  private noBroadcastTimer: unknown = null;
  /** Ever played since pressed: later losses say reconnecting rather than connecting. */
  private played = false;
  private full = false;
  /** A TURN server was among the ICE servers of the last connection tried (M5.4). */
  private triedRelay = false;
  private lastFreshAt = -Infinity;
  private highSince: number | null = null;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(private readonly deps: ListenerDeps<S>) {
    this.clock = deps.clock ?? systemClock;
    this.newId = deps.newId ?? newSessionId;
  }

  get status(): ListenStatus {
    return this.status_;
  }

  /** Whether **Listen** is on. */
  get listening(): boolean {
    return this.on;
  }

  /** The session whose sound plays, or is being set up; for the delay figure. */
  get sessionId(): string | null {
    return this.primary?.id ?? null;
  }

  /** The statistics of the connection in use. */
  stats(): Promise<unknown> {
    return this.primary?.peer?.stats?.() ?? Promise.resolve(null);
  }

  // ── What the page does ───────────────────────────────────────────────────

  /** **Listen** pressed. */
  start(): void {
    if (this.on) return;
    this.on = true;
    this.full = false;
    this.played = false;
    this.attempt = 0;
    this.setStatus({ kind: 'connecting' });
    if (this.broadcast?.active) {
      this.armUnreachable();
      this.open('primary');
    } else this.armNoBroadcast();
  }

  /** **Listen** released, or the page goes away. */
  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.closeSession(this.fresh, AUDIO_CLOSE.stopped);
    this.closeSession(this.primary, AUDIO_CLOSE.stopped);
    this.fresh = null;
    this.primary = null;
    this.clearTimer('retryTimer');
    this.clearTimer('unreachableTimer');
    this.clearTimer('noBroadcastTimer');
    this.highSince = null;
    this.deps.onStream(null);
    this.setStatus({ kind: 'off' });
  }

  /**
   * The workspace's audio state changed. A broadcaster that restarted or was taken over is
   * asked again; one that is gone is waited for a minute, then **Listen** turns off.
   */
  setBroadcast(broadcast: Broadcast | null): void {
    const before = this.last;
    const next = broadcast?.active ? broadcast : null;
    this.broadcast = next;
    if (next) this.last = { ownerId: next.ownerId, activatedAt: next.activatedAt };
    if (!this.on) return;
    if (!next) {
      this.clearTimer('unreachableTimer');
      this.armNoBroadcast();
      if (this.status_.kind === 'playing' || this.status_.kind === 'waiting') {
        this.setStatus({ kind: 'reconnecting' });
      }
      return;
    }
    this.clearTimer('noBroadcastTimer');
    const same =
      !!before && before.ownerId === next.ownerId && before.activatedAt === next.activatedAt;
    if (this.full) {
      // Refused by this broadcast; another one, or this computer switched on again, is asked.
      if (same) return;
      this.full = false;
    }
    if (same && (this.primary || this.retryTimer !== null)) {
      // The same broadcast, perhaps back after a moment without: the connection was never
      // touched, and one still being made goes on.
      if (!this.primary?.connected) this.armUnreachable();
      this.showConnected();
      return;
    }
    // Another broadcaster, or the same one after a restart: a new session with it.
    this.closeSession(this.fresh, AUDIO_CLOSE.stopped);
    this.fresh = null;
    if (this.primary && this.primary.ownerId !== next.ownerId) {
      this.closeSession(this.primary, AUDIO_CLOSE.stopped);
      this.primary = null;
      this.deps.onStream(null);
    } else if (this.primary && !same) {
      this.closeSession(this.primary, AUDIO_CLOSE.stopped);
      this.primary = null;
    }
    this.clearTimer('retryTimer');
    this.attempt = 0;
    if (!this.played) this.setStatus({ kind: 'connecting' });
    else this.setStatus({ kind: 'reconnecting' });
    this.armUnreachable();
    this.open('primary');
  }

  /** A signal from the broadcaster. */
  signal(signal: AudioSignal): void {
    const session =
      this.primary?.id === signal.session
        ? this.primary
        : this.fresh?.id === signal.session
          ? this.fresh
          : null;
    if (!session) {
      // A late offer for a session this listener no longer wants.
      if (signal.kind === 'offer' && this.broadcast) {
        this.deps.send(this.broadcast.ownerId, {
          kind: 'close',
          session: signal.session,
          reason: AUDIO_CLOSE.stopped,
        });
      }
      return;
    }
    switch (signal.kind) {
      case 'offer':
        void this.answer(session, signal.sdp, signal.iceServers);
        return;
      case 'candidate':
        if (!session.answered || !session.peer) session.held.push(signal.candidate);
        else void session.peer.addCandidate(signal.candidate).catch(() => undefined);
        return;
      case 'close':
        if (session === this.fresh) return this.dropFresh();
        return this.lost();
      case 'full':
        if (session === this.fresh) return this.dropFresh();
        this.closeSession(this.primary, null);
        this.primary = null;
        this.full = true;
        this.clearTimer('unreachableTimer');
        this.deps.onStream(null);
        this.setStatus({ kind: 'full' });
        return;
      case 'retaken':
        if (session === this.primary) this.connectAfresh(false);
        return;
      default:
        return;
    }
  }

  /**
   * The buffer of the connection in use, from its statistics (A18): above 300 ms for 3 s
   * asks for a fresh connection, at most once every 10 s. Elapsed time is read from the
   * clock, never from how often this is called.
   */
  reportBuffer(bufferMs: number | null): void {
    if (!this.on || bufferMs === null || !this.primary?.connected) {
      this.highSince = null;
      return;
    }
    const now = this.clock.now();
    if (bufferMs <= BUFFER_HIGH_MS) {
      this.highSince = null;
      return;
    }
    this.highSince ??= now;
    if (now - this.highSince < BUFFER_HIGH_FOR_MS) return;
    if (now - this.lastFreshAt < BUFFER_FRESH_EVERY_MS) return;
    this.highSince = null;
    this.connectAfresh(true);
  }

  /** The page came back into view (A24): connect afresh, as the phone may have fallen behind. */
  refresh(): void {
    if (this.on && this.primary?.connected) this.connectAfresh(true);
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  private open(role: 'primary' | 'fresh'): void {
    const broadcast = this.broadcast;
    if (!this.on || !broadcast) return;
    const session: Session<S> = {
      id: this.newId(),
      ownerId: broadcast.ownerId,
      peer: null,
      answered: false,
      held: [],
      stream: null,
      connected: false,
      offerTimer: null,
      freshTimer: null,
      restartTimer: null,
      restarting: false,
    };
    if (role === 'primary') this.primary = session;
    else this.fresh = session;
    session.offerTimer = this.clock.setTimeout(() => {
      session.offerTimer = null;
      if (session.peer) return;
      if (session === this.fresh) this.dropFresh();
      else if (session === this.primary) this.lost();
    }, OFFER_WAIT_MS);
    this.deps.send(session.ownerId, { kind: 'listen', session: session.id });
  }

  private async answer(
    session: Session<S>,
    offer: string,
    offered: IceServer[] | undefined,
  ): Promise<void> {
    if (session.offerTimer !== null) {
      this.clock.clearTimeout(session.offerTimer);
      session.offerTimer = null;
    }
    if (!session.peer) {
      const iceServers =
        offered ?? (this.deps.iceServers ? await this.deps.iceServers().catch(() => []) : []);
      if (!this.current(session)) return;
      this.triedRelay = iceServers.some((server) =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) =>
          url.startsWith('turn'),
        ),
      );
      session.peer = this.deps.createPeer({
        iceServers,
        events: {
          candidate: (candidate) => {
            if (!this.current(session)) return;
            this.deps.send(session.ownerId, { kind: 'candidate', session: session.id, candidate });
          },
          state: (state) => this.peerState(session, state),
          stream: (stream) => {
            if (!this.current(session)) return;
            session.stream = stream;
            if (session.connected) this.connected(session);
          },
        },
      });
    } else {
      // An ICE restart: gathered with a new list, the offer's or one asked for now, since
      // the relay credential of the first may have run out. With none, the old one stays.
      const iceServers =
        offered ?? (this.deps.iceServers ? await this.deps.iceServers().catch(() => []) : []);
      if (!this.current(session) || !session.peer) return;
      if (iceServers.length > 0) session.peer.setIceServers?.(iceServers);
    }
    session.answered = false;
    let sdp: string;
    const peer = session.peer;
    try {
      sdp = await peer.answer(offer, tuneOpusDescription);
    } catch {
      if (session === this.fresh) return this.dropFresh();
      if (session === this.primary) return this.lost();
      return;
    }
    if (!this.current(session)) return;
    session.answered = true;
    this.deps.send(session.ownerId, { kind: 'answer', session: session.id, sdp });
    for (const candidate of session.held.splice(0)) {
      void peer.addCandidate(candidate).catch(() => undefined);
    }
    if (session === this.fresh && session.freshTimer === null) {
      session.freshTimer = this.clock.setTimeout(() => {
        session.freshTimer = null;
        if (session === this.fresh) this.dropFresh();
      }, FRESH_WAIT_MS);
    }
  }

  private current(session: Session<S>): boolean {
    return this.on && (session === this.primary || session === this.fresh);
  }

  private peerState(session: Session<S>, state: PeerState): void {
    if (!this.current(session)) return;
    if (state === 'connected') {
      session.connected = true;
      session.restarting = false;
      if (session.restartTimer !== null) {
        this.clock.clearTimeout(session.restartTimer);
        session.restartTimer = null;
      }
      this.connected(session);
      return;
    }
    if (state === 'failed' || state === 'closed') {
      if (session === this.fresh) return this.dropFresh();
      return this.lost();
    }
    if (state === 'disconnected' && session === this.primary) {
      // An ICE restart, which the broadcaster offers; a fresh ICE list comes with it.
      if (session.restarting) return;
      session.restarting = true;
      this.setStatus({ kind: 'reconnecting' });
      this.armUnreachable();
      this.deps.send(session.ownerId, { kind: 'listen', session: session.id, restart: true });
      session.restartTimer = this.clock.setTimeout(() => {
        session.restartTimer = null;
        if (session === this.primary && session.restarting) this.lost();
      }, RESTART_WAIT_MS);
    }
  }

  /** A session is connected: it plays, and a fresh one takes the old one's place. */
  private connected(session: Session<S>): void {
    if (!session.connected || session.stream === null) {
      if (session === this.primary) this.showConnected();
      return;
    }
    if (session === this.fresh) {
      if (session.freshTimer !== null) this.clock.clearTimeout(session.freshTimer);
      session.freshTimer = null;
      const old = this.primary;
      this.primary = session;
      this.fresh = null;
      this.deps.onStream(session.stream);
      this.closeSession(old, AUDIO_CLOSE.replaced);
    } else if (session === this.primary) {
      this.deps.onStream(session.stream);
    }
    this.attempt = 0;
    this.played = true;
    this.clearTimer('unreachableTimer');
    this.showConnected();
  }

  private showConnected(): void {
    const primary = this.primary;
    if (!this.on || this.full || !primary?.connected) return;
    this.setStatus({ kind: this.broadcast?.status === 'live' ? 'playing' : 'waiting' });
  }

  /** The session in use is gone: closed, and asked for again after a growing wait. */
  private lost(): void {
    if (!this.on) return;
    this.closeSession(this.fresh, AUDIO_CLOSE.stopped);
    this.fresh = null;
    this.closeSession(this.primary, AUDIO_CLOSE.stopped);
    this.primary = null;
    this.setStatus(
      this.status_.kind === 'unreachable'
        ? this.status_
        : { kind: this.played ? 'reconnecting' : 'connecting' },
    );
    this.armUnreachable();
    if (this.retryTimer !== null) return;
    const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]!;
    this.attempt++;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      if (this.on && !this.primary && !this.full) this.open('primary');
    }, wait);
  }

  /** New connection first, the old one closed once the new one brings sound (A17). */
  private connectAfresh(byBuffer: boolean): void {
    const now = this.clock.now();
    if (!byBuffer && now - this.lastFreshAt < RETAKEN_DEBOUNCE_MS) return;
    if (!this.primary) return;
    this.lastFreshAt = now;
    // The latest wins over one still being made.
    this.dropFresh();
    this.open('fresh');
  }

  private dropFresh(): void {
    const fresh = this.fresh;
    if (!fresh) return;
    this.fresh = null;
    this.closeSession(fresh, AUDIO_CLOSE.replaced);
  }

  /** Closes a session, telling the broadcaster when a reason is given. */
  private closeSession(session: Session<S> | null, reason: string | null): void {
    if (!session) return;
    for (const timer of [session.offerTimer, session.freshTimer, session.restartTimer]) {
      if (timer !== null) this.clock.clearTimeout(timer);
    }
    session.offerTimer = session.freshTimer = session.restartTimer = null;
    session.peer?.close();
    session.peer = null;
    if (reason !== null) {
      this.deps.send(session.ownerId, { kind: 'close', session: session.id, reason });
    }
  }

  // ── Timers and status ────────────────────────────────────────────────────

  private armUnreachable(): void {
    if (this.unreachableTimer !== null) return;
    this.unreachableTimer = this.clock.setTimeout(() => {
      this.unreachableTimer = null;
      if (!this.on || this.full || !this.broadcast || this.primary?.connected) return;
      this.setStatus({ kind: 'unreachable', relay: this.triedRelay });
    }, UNREACHABLE_MS);
  }

  private armNoBroadcast(): void {
    if (this.noBroadcastTimer !== null) return;
    this.noBroadcastTimer = this.clock.setTimeout(() => {
      this.noBroadcastTimer = null;
      if (!this.broadcast) this.stop();
    }, NO_BROADCAST_MS);
  }

  private clearTimer(name: 'retryTimer' | 'unreachableTimer' | 'noBroadcastTimer'): void {
    if (this[name] !== null) this.clock.clearTimeout(this[name]);
    this[name] = null;
  }

  private setStatus(status: ListenStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.status_)) return;
    this.status_ = status;
    this.deps.onStatus?.(status);
  }
}
