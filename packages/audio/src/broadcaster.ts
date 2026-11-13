/**
 * The broadcaster's sessions (live audio plan A2, A17, A20; task breakdown M2.6, M2.7): one
 * send-only connection per session, all sharing the one capture track, at most ten listeners
 * counted by who they are.
 *
 * It decides; the connections it drives are supplied (`createPeer`), so it runs on real
 * `RTCPeerConnection`s in the app and on fakes in tests. Signals arrive with a route, which
 * is given back unchanged to send the answers the way the listener's came.
 */
import {
  AUDIO_CLOSE,
  AUDIO_LISTENER_LIMIT,
  audioListenerKey,
  type AudioCandidate,
  type AudioListener,
  type AudioSignal,
  type IceServer,
} from '@worship-q/protocol';
import { systemClock, type Clock, type PeerState } from './timers';

/** A listener's earlier session is closed this long after a fresh one was accepted (A17). */
export const OLD_SESSION_MS = 10_000;
/** A connection failed or disconnected this long, with no word from the listener, is closed. */
export const DEAD_SESSION_MS = 30_000;

/** One send-only connection, as the broadcaster drives it. */
export interface BroadcastPeer<T> {
  /** Makes an offer, with an ICE restart when asked, and sets it as the local description. */
  offer(restart: boolean): Promise<string>;
  /** Sets the listener's answer as the remote description. */
  answer(sdp: string): Promise<void>;
  addCandidate(candidate: AudioCandidate): Promise<void>;
  /** Puts another track in place, or nothing, without renegotiating. */
  setTrack(track: T | null): Promise<void>;
  close(): void;
}

export interface BroadcastPeerEvents {
  candidate(candidate: AudioCandidate): void;
  state(state: PeerState): void;
}

export interface BroadcasterDeps<R, T> {
  createPeer(args: {
    track: T | null;
    iceServers: IceServer[];
    events: BroadcastPeerEvents;
  }): BroadcastPeer<T>;
  /** Sends a signal back the way `route` came. */
  send(route: R, signal: AudioSignal): void;
  /** Fetched before each new connection and ICE restart (A10); empty when none can be had. */
  iceServers(): Promise<IceServer[]>;
  /** The number of listeners changed. */
  onCount?(count: number): void;
  clock?: Clock;
}

interface Session<R, T> {
  id: string;
  route: R;
  listener: AudioListener;
  key: string;
  peer: BroadcastPeer<T> | null;
  /** The answer is being applied, or was. */
  answering: boolean;
  /** The answer was applied; candidates wait until then. */
  answered: boolean;
  held: AudioCandidate[];
  /** Running while the connection is failed or disconnected. */
  deadTimer: unknown;
  oldTimer: unknown;
}

export class Broadcaster<R, T> {
  private readonly sessions = new Map<string, Session<R, T>>();
  private track: T | null = null;
  private active = true;
  private count_ = 0;
  private readonly clock: Clock;

  constructor(private readonly deps: BroadcasterDeps<R, T>) {
    this.clock = deps.clock ?? systemClock;
  }

  /** Listeners connected now, counted by who they are (A20). */
  get count(): number {
    return this.count_;
  }

  /** Sessions open now, for tests and diagnostics. */
  get sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** A signal from a listener, with the way back and who it is. */
  signal(route: R, listener: AudioListener, signal: AudioSignal): void {
    if (!this.active) {
      if (signal.kind !== 'close') {
        this.deps.send(route, {
          kind: 'close',
          session: signal.session,
          reason: AUDIO_CLOSE.notBroadcasting,
        });
      }
      return;
    }
    const session = this.sessions.get(signal.session);
    switch (signal.kind) {
      case 'listen':
        if (session) {
          // The same session asked again: only an ICE restart is acted on.
          if (signal.restart && audioListenerKey(listener) === session.key) {
            void this.offer(session, true);
          }
          return;
        }
        return this.accept(route, listener, signal.session);
      case 'answer':
        if (!session || session.answering || !session.peer) return;
        session.answering = true;
        void session.peer
          .answer(signal.sdp)
          .then(() => {
            session.answered = true;
            this.flush(session);
          })
          .catch(() => this.end(session, AUDIO_CLOSE.timeout));
        return;
      case 'candidate':
        if (!session) return;
        if (!session.answered || !session.peer) session.held.push(signal.candidate);
        else void session.peer.addCandidate(signal.candidate).catch(() => undefined);
        return;
      case 'close':
        if (session) this.drop(session);
        return;
      default:
        // `offer`, `full` and `retaken` go the other way.
        return;
    }
  }

  /** Closes the sessions of listeners that are gone: a device left, a grant was revoked. */
  listenerGone(match: (listener: AudioListener, route: R) => boolean): void {
    for (const session of [...this.sessions.values()]) {
      if (match(session.listener, session.route)) this.drop(session);
    }
  }

  /**
   * A new capture track, or none while the input is gone: put in place on every connection,
   * then each listener is told once that the input was taken again, so it connects afresh
   * (A17). Losing the track tells nobody: listeners stay connected in silence.
   */
  async setTrack(track: T | null): Promise<void> {
    const had = this.track;
    this.track = track;
    if (track === had) return;
    const sessions = [...this.sessions.values()];
    await Promise.all(
      sessions.map((session) => session.peer?.setTrack(track).catch(() => undefined)),
    );
    if (!track || !this.active) return;
    const newest = new Map<string, Session<R, T>>();
    for (const session of this.sessions.values()) newest.set(session.key, session);
    for (const session of newest.values()) {
      this.deps.send(session.route, { kind: 'retaken', session: session.id });
    }
  }

  /** Switched off or taken over: every listener is told, every connection closed. */
  stop(): void {
    this.active = false;
    for (const session of [...this.sessions.values()]) this.end(session, AUDIO_CLOSE.stopped);
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  private accept(route: R, listener: AudioListener, id: string): void {
    const key = audioListenerKey(listener);
    const others = new Set(
      [...this.sessions.values()].map((each) => each.key).filter((each) => each !== key),
    );
    if (others.size >= AUDIO_LISTENER_LIMIT) {
      this.deps.send(route, { kind: 'full', session: id });
      return;
    }
    const session: Session<R, T> = {
      id,
      route,
      listener,
      key,
      peer: null,
      answering: false,
      answered: false,
      held: [],
      deadTimer: null,
      oldTimer: null,
    };
    // The listener connecting afresh: its earlier sessions go once this one has had time to
    // bring sound, if the listener has not closed them itself (A17).
    for (const old of this.sessions.values()) {
      if (old.key !== key || old.oldTimer !== null) continue;
      old.oldTimer = this.clock.setTimeout(() => {
        if (this.sessions.get(old.id) === old) this.end(old, AUDIO_CLOSE.replaced);
      }, OLD_SESSION_MS);
    }
    this.sessions.set(id, session);
    this.recount();
    void this.offer(session, false);
  }

  private async offer(session: Session<R, T>, restart: boolean): Promise<void> {
    const iceServers = await this.deps.iceServers().catch(() => []);
    if (this.sessions.get(session.id) !== session) return;
    if (!session.peer) {
      session.peer = this.deps.createPeer({
        track: this.track,
        iceServers,
        events: {
          candidate: (candidate) => {
            if (this.sessions.get(session.id) !== session) return;
            this.deps.send(session.route, { kind: 'candidate', session: session.id, candidate });
          },
          state: (state) => this.peerState(session, state),
        },
      });
    }
    let sdp: string;
    try {
      sdp = await session.peer.offer(restart);
    } catch {
      return this.end(session, AUDIO_CLOSE.timeout);
    }
    if (this.sessions.get(session.id) !== session) return;
    if (restart) {
      // A restart's answer is a new one.
      session.answering = false;
      session.answered = false;
    }
    // A phone or an administrator has no credential of its own (M4.3).
    const carry = session.listener.kind !== 'desktop' && iceServers.length > 0;
    this.deps.send(session.route, {
      kind: 'offer',
      session: session.id,
      sdp,
      ...(carry ? { iceServers } : {}),
    });
  }

  private flush(session: Session<R, T>): void {
    const held = session.held.splice(0);
    for (const candidate of held) void session.peer?.addCandidate(candidate).catch(() => undefined);
  }

  private peerState(session: Session<R, T>, state: PeerState): void {
    if (this.sessions.get(session.id) !== session) return;
    if (state === 'failed' || state === 'disconnected') {
      if (session.deadTimer !== null) return;
      session.deadTimer = this.clock.setTimeout(() => {
        if (this.sessions.get(session.id) === session) this.end(session, AUDIO_CLOSE.timeout);
      }, DEAD_SESSION_MS);
    } else if (state === 'connected' && session.deadTimer !== null) {
      this.clock.clearTimeout(session.deadTimer);
      session.deadTimer = null;
    }
  }

  /** Closes a session and tells the listener why. */
  private end(session: Session<R, T>, reason: string): void {
    if (this.sessions.get(session.id) !== session) return;
    this.deps.send(session.route, { kind: 'close', session: session.id, reason });
    this.drop(session);
  }

  /** Closes a session without a word: the listener asked, or is gone. */
  private drop(session: Session<R, T>): void {
    if (this.sessions.get(session.id) !== session) return;
    this.sessions.delete(session.id);
    if (session.deadTimer !== null) this.clock.clearTimeout(session.deadTimer);
    if (session.oldTimer !== null) this.clock.clearTimeout(session.oldTimer);
    session.peer?.close();
    this.recount();
  }

  private recount(): void {
    const count = Math.min(
      AUDIO_LISTENER_LIMIT,
      new Set([...this.sessions.values()].map((each) => each.key)).size,
    );
    if (count === this.count_) return;
    this.count_ = count;
    this.deps.onCount?.(count);
  }
}
