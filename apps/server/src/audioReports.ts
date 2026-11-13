/**
 * Each workspace's live audio broadcast, as its broadcaster last reported it, for the admin
 * app (live audio A21; task breakdown M5.5); and the administrators listening, whose signals
 * the server carries to the broadcaster and back (A14, A22; M5.7).
 *
 * The broadcaster reports by HTTP when its state changes and every half minute while its
 * switch is on. The reports are kept in memory: they are transient, and the next one refills
 * them after a restart. A report not renewed for 90 s is forgotten.
 *
 * An administrator's browser has no event stream, so it posts its signals and polls for the
 * answers. Answers are queued per session, in order, each given once, and dropped after 60 s.
 * A session that has not polled for 30 s is closed towards the broadcaster.
 */
import { randomUUID } from 'node:crypto';
import { newerAudioState } from '@worship-q/live-state';
import {
  AUDIO_CLOSE,
  AUDIO_SESSION_MAX,
  type AudioSignal,
  type AudioState,
} from '@worship-q/protocol';

/** A report older than this is forgotten. */
export const AUDIO_REPORT_TTL_MS = 90_000;
/** An answer waiting this long for a poll is dropped. */
export const ADMIN_SIGNAL_TTL_MS = 60_000;
/** A session that has not polled this long is closed. */
export const ADMIN_SESSION_IDLE_MS = 30_000;
/** Answers kept per session at most. */
const QUEUE_MAX = 200;

export interface AudioReport {
  state: AudioState;
  deviceId: string;
  receivedAt: number;
}

interface AdminSession {
  id: string;
  workspaceId: string;
  administratorId: string;
  ownerId: string;
  name: string;
  /** Who listens, for the broadcaster's count: the administrator's page, or this session. */
  listener: string;
  lastPollAt: number;
  queue: { seq: number; at: number; signal: AudioSignal }[];
  nextSeq: number;
  /** The ICE list has been handed out with an answer. */
  iceGiven: boolean;
}

export class AudioReports {
  private readonly reports = new Map<string, AudioReport>();
  private readonly sessions = new Map<string, AdminSession>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    /** Sends a signal to the broadcaster's relay socket; false when it is not there. */
    private readonly toBroadcaster: (
      workspaceId: string,
      deviceId: string,
      name: string,
      signal: AudioSignal,
      listener: string,
    ) => boolean = () => false,
  ) {}

  // ── Reports ──────────────────────────────────────────────────────────────

  /**
   * Keeps the report unless another computer's later activation holds the workspace's
   * broadcast; the same computer's report always replaces its last. An inactive report from
   * the owner clears it at once. Returns whether it was kept.
   */
  put(workspaceId: string, deviceId: string, state: AudioState): boolean {
    if (state.ownerId !== deviceId) return false;
    const current = this.get(workspaceId);
    const sameOwner = current?.state.ownerId === state.ownerId;
    if (current && !sameOwner && !newerAudioState(state, current.state)) return false;
    if (!state.active) {
      if (sameOwner) this.reports.delete(workspaceId);
      return sameOwner;
    }
    this.reports.set(workspaceId, { state, deviceId, receivedAt: this.now() });
    return true;
  }

  /** The workspace's live broadcast, unless its report is too old. */
  get(workspaceId: string): AudioReport | null {
    const report = this.reports.get(workspaceId);
    if (!report) return null;
    if (this.now() - report.receivedAt > AUDIO_REPORT_TTL_MS) {
      this.reports.delete(workspaceId);
      return null;
    }
    return report;
  }

  // ── Administrators listening ─────────────────────────────────────────────

  /**
   * A signal from a signed-in administrator. `listen` without a session makes one here;
   * every other signal must name a session of this administrator. Returns the session, or
   * an error code.
   *
   * `page` is an id the administrator's page made for itself and sends with each `listen`:
   * the sessions of one page are one listener to the broadcaster, so a page that connects
   * afresh is never refused by its own old connection (A20), and two pages of the same
   * administrator are two listeners. A page that sends none is counted by session.
   */
  adminSignal(
    workspaceId: string,
    administratorId: string,
    name: string,
    session: string | null,
    signal: AudioSignal | { kind: 'listen' },
    page: string | null = null,
  ): { session: string } | { error: 'not-broadcasting' | 'unreachable' | 'no-session' } {
    this.sweep();
    let entry: AdminSession | undefined;
    if (session) {
      entry = this.sessions.get(session);
      if (
        !entry ||
        entry.administratorId !== administratorId ||
        entry.workspaceId !== workspaceId
      ) {
        return { error: 'no-session' };
      }
    } else {
      if (signal.kind !== 'listen') return { error: 'no-session' };
      const report = this.get(workspaceId);
      if (!report) return { error: 'not-broadcasting' };
      const id = `admin-${randomUUID()}`;
      entry = {
        id,
        workspaceId,
        administratorId,
        ownerId: report.deviceId,
        name,
        listener: page ? `${administratorId}:${page}`.slice(0, AUDIO_SESSION_MAX) : id,
        lastPollAt: this.now(),
        queue: [],
        nextSeq: 1,
        iceGiven: false,
      };
      this.sessions.set(entry.id, entry);
    }
    const full = { ...signal, session: entry.id } as AudioSignal;
    if (!this.toBroadcaster(workspaceId, entry.ownerId, entry.name, full, entry.listener)) {
      this.sessions.delete(entry.id);
      return { error: 'unreachable' };
    }
    if (signal.kind === 'close') this.sessions.delete(entry.id);
    return { session: entry.id };
  }

  /** A signal from the broadcaster for an administrator's session. */
  fromBroadcaster(workspaceId: string, deviceId: string, signal: AudioSignal): void {
    const entry = this.sessions.get(signal.session);
    if (!entry || entry.workspaceId !== workspaceId || entry.ownerId !== deviceId) return;
    entry.queue.push({ seq: entry.nextSeq++, at: this.now(), signal });
    if (entry.queue.length > QUEUE_MAX) entry.queue.shift();
  }

  /**
   * The answers after `after`, in order. Null when the session is not this administrator's,
   * or is gone. `first` is true until the ICE list has been given with one poll.
   */
  poll(
    workspaceId: string,
    administratorId: string,
    session: string,
    after: number,
  ): { signals: { seq: number; signal: AudioSignal }[]; first: boolean } | null {
    this.sweep();
    const entry = this.sessions.get(session);
    if (!entry || entry.administratorId !== administratorId || entry.workspaceId !== workspaceId) {
      return null;
    }
    entry.lastPollAt = this.now();
    entry.queue = entry.queue.filter((item) => item.seq > after);
    const first = !entry.iceGiven;
    entry.iceGiven = true;
    return { signals: entry.queue.map(({ seq, signal }) => ({ seq, signal })), first };
  }

  /** Drops old answers, and closes sessions that stopped polling. */
  sweep(): void {
    const now = this.now();
    for (const entry of [...this.sessions.values()]) {
      entry.queue = entry.queue.filter((item) => now - item.at <= ADMIN_SIGNAL_TTL_MS);
      if (now - entry.lastPollAt > ADMIN_SESSION_IDLE_MS) {
        this.sessions.delete(entry.id);
        this.toBroadcaster(
          entry.workspaceId,
          entry.ownerId,
          entry.name,
          { kind: 'close', session: entry.id, reason: AUDIO_CLOSE.timeout },
          entry.listener,
        );
      }
    }
  }
}
