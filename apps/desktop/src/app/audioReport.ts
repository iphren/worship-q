/**
 * Reports this computer's live audio broadcast to the church server, for the admin app (live
 * audio A21; task breakdown M5.5): soon after it changes, and every half minute while the
 * switch is on, so the server forgets a broadcaster that went silent. When the switch goes
 * off, that is reported once.
 *
 * The relay forwards audio messages and keeps none, and they never reach the server when the
 * desktops meet only on the LAN; so the broadcaster says it itself, as the OBS computer does.
 */
import type { AudioState } from '@worship-q/protocol';

/** The broadcaster reports at least this often while its switch is on. */
export const AUDIO_REPORT_EVERY_MS = 30_000;
/** A change is sent this long after it was seen, so a burst makes one request. */
export const AUDIO_REPORT_DEBOUNCE_MS = 500;

export interface AudioReporterDeps {
  /** This computer's own audio state; null while its switch is off. */
  state(): AudioState | null;
  subscribe(listener: () => void): () => void;
  /** A failure is left for the next change or heartbeat to make up. */
  put(state: AudioState): Promise<void>;
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}

const keyOf = (state: AudioState | null) =>
  state
    ? JSON.stringify([
        state.ownerName,
        state.activatedAt,
        state.active,
        state.status,
        state.inputName,
        state.listeners,
      ])
    : '';

export class AudioReporter {
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly unsubscribe: () => void;
  private reportedKey = '';
  /** The last active state reported, to report it switched off. */
  private last: AudioState | null = null;
  private debounce: unknown = null;
  private heartbeat: unknown = null;
  private stopped = false;

  constructor(private readonly deps: AudioReporterDeps) {
    this.setTimer = deps.setTimeout ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer =
      deps.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.unsubscribe = deps.subscribe(() => this.changed());
    this.changed();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe();
    if (this.debounce !== null) this.clearTimer(this.debounce);
    if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
    this.debounce = this.heartbeat = null;
  }

  private changed(): void {
    if (this.stopped || this.debounce !== null) return;
    if (keyOf(this.deps.state()) === this.reportedKey) return;
    this.debounce = this.setTimer(() => {
      this.debounce = null;
      this.send();
    }, AUDIO_REPORT_DEBOUNCE_MS);
  }

  private send(): void {
    if (this.stopped) return;
    if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
    this.heartbeat = null;
    const state = this.deps.state();
    if (!state) {
      const last = this.last;
      this.last = null;
      this.reportedKey = '';
      if (last) void this.deps.put({ ...last, active: false, listeners: 0 }).catch(() => undefined);
      return;
    }
    this.last = state;
    this.reportedKey = keyOf(state);
    void this.deps.put(state).catch(() => undefined);
    this.heartbeat = this.setTimer(() => {
      this.heartbeat = null;
      this.send();
    }, AUDIO_REPORT_EVERY_MS);
  }
}
