/**
 * **Listen** as a page uses it (live audio plan A5; task breakdown M3.2, M3.6, M4.4, M5.8):
 * the `Listener`, what it plays into, and the delay figure, with a state the page shows. The
 * desktop, the phone page and the admin page each supply the connection, the way signals
 * travel and the output; everything they share is here, once.
 *
 * A press unlocks playback at once, inside the gesture, then does whatever the page must do
 * first (`prepare`: the desktop sets its Monitor device) and only then asks the broadcaster.
 * A release during that wait is obeyed: nothing is asked, nothing plays.
 */
import { Listener, type Broadcast, type ListenStatus, type ListenerDeps } from './listener';
import type { AudioSignal } from '@worship-q/protocol';
import { DelayMeter, readStats, type DelayFigure } from './stats';
import { systemClock, type Clock } from './timers';

/** The statistics are read this often while listening. */
export const STATS_EVERY_MS = 2000;

/** Where the sound goes: an `<audio>` element in the app, a fake in tests. */
export interface ListenOutput<S> {
  /** Called inside the press, before anything is awaited, so the browser lets it play. */
  unlock(): void;
  /** Plays the stream, or nothing for null. */
  play(stream: S | null): void;
}

export interface ListenState {
  status: ListenStatus;
  delay: DelayFigure | null;
}

export interface ListenPlayerDeps<S> extends Omit<ListenerDeps<S>, 'onStream' | 'onStatus'> {
  output: ListenOutput<S>;
  /** Done after the press and before the broadcaster is asked; a failure does not stop it. */
  prepare?(): Promise<void>;
  /** **Listen** went on (the broadcaster is about to be asked) or off. */
  onListening?(on: boolean): void;
}

export class ListenPlayer<S> {
  readonly listener: Listener<S>;
  private readonly meter = new DelayMeter();
  private readonly clock: Clock;
  private state_: ListenState = { status: { kind: 'off' }, delay: null };
  private readonly subscribers = new Set<() => void>();
  /** Pressed and not released: true from the press, before the listener itself is on. */
  private wanted = false;
  /** Numbers each press, so a `prepare` overtaken by a release and another press is dropped. */
  private press = 0;
  private statsTimer: unknown = null;

  constructor(private readonly deps: ListenPlayerDeps<S>) {
    this.clock = deps.clock ?? systemClock;
    this.listener = new Listener<S>({
      ...deps,
      onStream: (stream) => deps.output.play(stream),
      onStatus: (status) => {
        if (status.kind === 'off') return this.wentOff();
        this.update({ status });
      },
    });
  }

  get state(): ListenState {
    return this.state_;
  }

  /** Whether **Listen** is pressed, including while it prepares. */
  get listening(): boolean {
    return this.wanted;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  /** **Listen** pressed. A second press while on, or while preparing, does nothing. */
  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    const press = ++this.press;
    this.deps.output.unlock();
    this.meter.reset();
    this.update({ status: { kind: 'connecting' }, delay: null });
    const begin = () => {
      if (!this.wanted || press !== this.press) return;
      this.deps.onListening?.(true);
      this.listener.start();
      // With no broadcast the listener says connecting too; its status is the one shown.
      if (this.wanted) this.update({ status: this.listener.status });
      this.armStats();
    };
    if (!this.deps.prepare) return begin();
    void this.deps
      .prepare()
      .catch(() => undefined)
      .then(begin);
  }

  /** **Listen** released, at any moment after the press. */
  stop(): void {
    if (!this.wanted) return;
    if (this.listener.listening) this.listener.stop();
    else this.wentOff();
  }

  setBroadcast(broadcast: Broadcast | null): void {
    this.listener.setBroadcast(broadcast);
  }

  /** A signal from the broadcaster. */
  signal(signal: AudioSignal): void {
    this.listener.signal(signal);
  }

  /** The page came back into view, or its way to the broadcaster changed: connect afresh. */
  refresh(): void {
    this.listener.refresh();
  }

  private wentOff(): void {
    const was = this.wanted;
    this.wanted = false;
    if (this.statsTimer !== null) this.clock.clearTimeout(this.statsTimer);
    this.statsTimer = null;
    this.update({ status: { kind: 'off' }, delay: null });
    if (was) this.deps.onListening?.(false);
  }

  private armStats(): void {
    if (this.statsTimer !== null || !this.wanted) return;
    this.statsTimer = this.clock.setTimeout(() => {
      this.statsTimer = null;
      void this.readStats().finally(() => this.armStats());
    }, STATS_EVERY_MS);
  }

  private async readStats(): Promise<void> {
    const session = this.listener.sessionId;
    if (!session) return;
    const report = await this.listener.stats().catch(() => null);
    // Not mixed with another connection's, and not shown after a release.
    if (!report || !this.wanted || this.listener.sessionId !== session) return;
    const figure = this.meter.push(session, readStats(report, this.clock.now()));
    this.listener.reportBuffer(figure.bufferMs);
    if (this.wanted) this.update({ delay: figure });
  }

  private update(patch: Partial<ListenState>): void {
    const next = { ...this.state_, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.state_)) return;
    this.state_ = next;
    for (const listener of [...this.subscribers]) listener();
  }
}
