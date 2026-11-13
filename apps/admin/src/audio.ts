/**
 * **Listen** in the admin app (live audio plan A14; task breakdown M5.8). The admin app has
 * no event stream, so the browser posts its signals and polls for the answers (A22): every
 * 500 ms while connecting, every 5 s once playing. The server makes each session's id; the
 * shared `Listener` makes its own, so this maps one onto the other.
 */
import {
  ListenPlayer,
  browserAudioOutput,
  browserListenPeer,
  systemClock,
  type Clock,
  type ListenOutput,
  type ListenPeer,
  type ListenPeerEvents,
  type ListenState,
} from '@worship-q/audio';
import type { AudioSignal, IceServer } from '@worship-q/protocol';
import { api, ApiError } from './api';

export const POLL_CONNECTING_MS = 500;
export const POLL_PLAYING_MS = 5000;

export type AdminListenState = ListenState;

/** What the page supplies; the browser's own and the admin API in the app, fakes in tests. */
export interface AdminListenDeps {
  api?: Pick<typeof api, 'audioSignal' | 'audioSignals'>;
  output?: ListenOutput<MediaStream> & { remove?(): void };
  createPeer?: (args: {
    iceServers: IceServer[];
    events: ListenPeerEvents<MediaStream>;
  }) => ListenPeer;
  clock?: Clock;
  /** This page's own id, sent with every `listen` so its sessions count as one (A20). */
  pageId?: string;
}

/** One listening session's place on the server. */
interface ServerSession {
  local: string;
  server: string | null;
  after: number;
  /** Signals made before the server named the session. */
  waiting: AudioSignal[];
}

export class AdminListen {
  private readonly player: ListenPlayer<MediaStream>;
  private readonly output: ListenOutput<MediaStream> & { remove?(): void };
  private readonly api: Pick<typeof api, 'audioSignal' | 'audioSignals'>;
  private readonly clock: Clock;
  private readonly pageId: string;
  private readonly sessions = new Map<string, ServerSession>();
  private iceServers: IceServer[] = [];
  private pollTimer: unknown = null;
  /** A poll is under way: never two at once, or one answer would be delivered twice. */
  private polling = false;
  /** Something asked for a poll while one was under way: the next follows at once. */
  private pollAgain = false;

  constructor(
    private readonly workspaceId: string,
    deps: AdminListenDeps = {},
  ) {
    this.api = deps.api ?? api;
    this.clock = deps.clock ?? systemClock;
    this.pageId = deps.pageId ?? globalThis.crypto.randomUUID();
    this.output = deps.output ?? browserAudioOutput();
    this.player = new ListenPlayer<MediaStream>({
      createPeer: deps.createPeer ?? browserListenPeer,
      send: (_ownerId, signal) => void this.send(signal),
      iceServers: async () => this.iceServers,
      output: this.output,
      onListening: (on) => (on ? this.schedulePoll(0) : this.halt()),
      clock: this.clock,
    });
  }

  get state(): AdminListenState {
    return this.player.state;
  }

  subscribe = (listener: () => void): (() => void) => this.player.subscribe(listener);

  /** The report's broadcast changed; the admin page knows no owner id, so the name stands in. */
  follow(
    audio: { ownerName: string; status: 'live' | 'waiting' | 'refused'; connected: boolean } | null,
  ): void {
    this.player.setBroadcast(
      audio?.connected
        ? { ownerId: audio.ownerName, activatedAt: '', active: true, status: audio.status }
        : null,
    );
  }

  start(): void {
    this.player.start();
  }

  stop(): void {
    this.player.stop();
  }

  dispose(): void {
    this.player.stop();
    this.halt();
    this.output.remove?.();
  }

  private halt(): void {
    if (this.pollTimer !== null) this.clock.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollAgain = false;
  }

  /** A signal from the listener, on its way to the server. */
  private async send(signal: AudioSignal): Promise<void> {
    const { session: local, ...body } = signal;
    let entry = this.sessions.get(local);
    if (!entry) {
      if (signal.kind !== 'listen') return;
      entry = { local, server: null, after: 0, waiting: [] };
      this.sessions.set(local, entry);
      try {
        const { session } = await this.api.audioSignal(this.workspaceId, null, body, this.pageId);
        entry.server = session;
      } catch {
        this.sessions.delete(local);
        // Treated as a closed session, so the listener asks again after a wait.
        this.player.signal({ kind: 'close', session: local, reason: 'gone' });
        return;
      }
      for (const queued of entry.waiting.splice(0)) await this.post(entry, queued);
      this.schedulePoll(0);
      return;
    }
    if (!entry.server) {
      entry.waiting.push(signal);
      return;
    }
    await this.post(entry, signal);
  }

  private async post(entry: ServerSession, signal: AudioSignal): Promise<void> {
    const body: Partial<AudioSignal> = { ...signal };
    delete body.session;
    if (signal.kind === 'close') this.sessions.delete(entry.local);
    await this.api
      .audioSignal(this.workspaceId, entry.server, body as Omit<AudioSignal, 'session'>)
      .catch(() => undefined);
  }

  private schedulePoll(ms: number): void {
    if (this.polling) {
      // The one under way finishes first; it then polls again at once for an early ask.
      if (ms === 0) this.pollAgain = true;
      return;
    }
    if (this.pollTimer !== null) this.clock.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (!this.player.listening) return;
    this.pollTimer = this.clock.setTimeout(() => {
      this.pollTimer = null;
      void this.poll();
    }, ms);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    this.pollAgain = false;
    try {
      for (const entry of [...this.sessions.values()]) {
        if (!entry.server) continue;
        try {
          const answer = await this.api.audioSignals(this.workspaceId, entry.server, entry.after);
          if (answer.iceServers) this.iceServers = answer.iceServers;
          // Closed while the server was asked: its answers are for nobody.
          if (this.sessions.get(entry.local) !== entry) continue;
          for (const { seq, signal } of answer.signals) {
            if (seq <= entry.after) continue;
            entry.after = seq;
            this.player.signal({ ...signal, session: entry.local } as AudioSignal);
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            // The server forgot the session: the listener asks again if still on.
            if (this.sessions.get(entry.local) !== entry) continue;
            this.sessions.delete(entry.local);
            this.player.signal({ kind: 'close', session: entry.local, reason: 'gone' });
          }
        }
      }
    } finally {
      this.polling = false;
    }
    if (this.pollAgain) return this.schedulePoll(0);
    // Quickly while a connection is being made, including a fresh one beside the one playing.
    const kind = this.player.state.status.kind;
    const settled = (kind === 'playing' || kind === 'waiting') && this.sessions.size <= 1;
    this.schedulePoll(settled ? POLL_PLAYING_MS : POLL_CONNECTING_MS);
  }
}
