/**
 * **Listen** in the admin app (live audio plan A14; task breakdown M5.8). The admin app has
 * no event stream, so the browser posts its signals and polls for the answers (A22): every
 * 500 ms while connecting, every 5 s once playing. The server makes each session's id; the
 * shared `Listener` makes its own, so this maps one onto the other.
 */
import {
  DelayMeter,
  Listener,
  browserListenPeer,
  readStats,
  type DelayFigure,
  type ListenStatus,
} from '@worship-q/audio';
import type { AudioSignal, IceServer } from '@worship-q/protocol';
import { api, ApiError } from './api';

export const POLL_CONNECTING_MS = 500;
export const POLL_PLAYING_MS = 5000;
const STATS_EVERY_MS = 2000;

export interface AdminListenState {
  status: ListenStatus;
  delay: DelayFigure | null;
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
  private readonly listener: Listener<MediaStream>;
  private readonly element: HTMLAudioElement;
  private readonly meter = new DelayMeter();
  private readonly sessions = new Map<string, ServerSession>();
  private iceServers: IceServer[] = [];
  private state_: AdminListenState = { status: { kind: 'off' }, delay: null };
  private readonly subscribers = new Set<() => void>();
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly workspaceId: string) {
    this.element = document.createElement('audio');
    this.element.autoplay = true;
    document.body.appendChild(this.element);
    this.listener = new Listener<MediaStream>({
      createPeer: browserListenPeer,
      send: (_ownerId, signal) => void this.send(signal),
      iceServers: async () => this.iceServers,
      onStream: (stream) => {
        this.element.srcObject = stream;
        if (stream) void this.element.play().catch(() => undefined);
      },
      onStatus: (status) => {
        this.update({ status, ...(status.kind === 'off' ? { delay: null } : {}) });
        if (status.kind === 'off') this.halt();
      },
    });
  }

  get state(): AdminListenState {
    return this.state_;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  /** The report's broadcast changed; the admin page knows no owner id, so the name stands in. */
  follow(
    audio: { ownerName: string; status: 'live' | 'waiting' | 'refused'; connected: boolean } | null,
  ): void {
    this.listener.setBroadcast(
      audio?.connected
        ? { ownerId: audio.ownerName, activatedAt: '', active: true, status: audio.status }
        : null,
    );
  }

  start(): void {
    void this.element.play().catch(() => undefined);
    this.meter.reset();
    this.listener.start();
    this.schedulePoll(0);
    clearInterval(this.statsTimer);
    this.statsTimer = setInterval(() => void this.readStats(), STATS_EVERY_MS);
  }

  stop(): void {
    this.listener.stop();
  }

  dispose(): void {
    this.listener.stop();
    this.halt();
    this.element.remove();
  }

  private halt(): void {
    clearTimeout(this.pollTimer);
    clearInterval(this.statsTimer);
    this.pollTimer = this.statsTimer = undefined;
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
        const { session } = await api.audioSignal(this.workspaceId, null, body);
        entry.server = session;
      } catch {
        this.sessions.delete(local);
        // Treated as a closed session, so the listener asks again after a wait.
        this.listener.signal({ kind: 'close', session: local, reason: 'gone' });
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
    await api
      .audioSignal(this.workspaceId, entry.server, body as Omit<AudioSignal, 'session'>)
      .catch(() => undefined);
  }

  private schedulePoll(ms: number): void {
    clearTimeout(this.pollTimer);
    if (!this.listener.listening) return;
    this.pollTimer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    for (const entry of [...this.sessions.values()]) {
      if (!entry.server) continue;
      try {
        const answer = await api.audioSignals(this.workspaceId, entry.server, entry.after);
        if (answer.iceServers) this.iceServers = answer.iceServers;
        for (const { seq, signal } of answer.signals) {
          entry.after = Math.max(entry.after, seq);
          this.listener.signal({ ...signal, session: entry.local } as AudioSignal);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // The server forgot the session: the listener asks again if still on.
          this.sessions.delete(entry.local);
          this.listener.signal({ kind: 'close', session: entry.local, reason: 'gone' });
        }
      }
    }
    // Quickly while a connection is being made, including a fresh one beside the one playing.
    const kind = this.listener.status.kind;
    const settled = (kind === 'playing' || kind === 'waiting') && this.sessions.size <= 1;
    this.schedulePoll(settled ? POLL_PLAYING_MS : POLL_CONNECTING_MS);
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

  private update(patch: Partial<AdminListenState>): void {
    this.state_ = { ...this.state_, ...patch };
    for (const listener of [...this.subscribers]) listener();
  }
}
