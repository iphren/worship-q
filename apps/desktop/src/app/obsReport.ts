/**
 * Reports this computer's OBS state to the church server, for the admin app: soon after it
 * changes, and every `OBS_REPORT_EVERY_MS` while the link is on, so the admin app can tell a
 * silent OBS computer from one with nothing new. When the link is turned off, that is
 * reported once.
 *
 * The relay only forwards OBS messages between desktops and keeps none, and they never reach
 * the server when the OBS computer presents alone or the desktops meet on the LAN; so the
 * OBS computer says it itself, as the live state is backed up.
 */
import { OBS_REPORT_EVERY_MS, type ObsState } from '@worship-q/protocol';

/** A change is sent this long after it was seen, so a burst of changes makes one request. */
export const OBS_REPORT_DEBOUNCE_MS = 500;

export interface ObsReporterDeps {
  /** This computer's own OBS state, durations as of now; see `ObsShare.ownState`. */
  state(): ObsState | null;
  /** Calls the listener whenever the shared OBS state may have changed. */
  subscribe(listener: () => void): () => void;
  /** Sends a report; a failure is left for the next change or heartbeat to make up. */
  put(state: ObsState): Promise<void>;
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}

/** What decides whether a report is due; durations advance on their own and are left out. */
function reportKey(state: ObsState | null): string {
  if (!state) return '';
  const output = ({ active, phase, paused }: ObsState['stream']) => [active, phase, paused];
  return JSON.stringify([
    state.ownerId,
    state.ownerName,
    state.activatedAt,
    state.active,
    state.status,
    state.scenes,
    state.currentScene,
    state.favourites,
    output(state.stream),
    output(state.record),
    output(state.virtualCam),
  ]);
}

export class ObsReporter {
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly unsubscribe: () => void;
  /** The key of the last state reported, or being reported. */
  private reportedKey = '';
  private debounce: unknown = null;
  private heartbeat: unknown = null;
  private sending = false;
  /** A report became due while one was being sent. */
  private again = false;
  private stopped = false;

  constructor(private readonly deps: ObsReporterDeps) {
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
    if (reportKey(this.deps.state()) === this.reportedKey) return;
    this.debounce = this.setTimer(() => {
      this.debounce = null;
      void this.send();
    }, OBS_REPORT_DEBOUNCE_MS);
  }

  private async send(): Promise<void> {
    if (this.stopped) return;
    if (this.sending) {
      this.again = true;
      return;
    }
    const state = this.deps.state();
    this.schedule(state);
    if (!state) {
      this.reportedKey = '';
      return;
    }
    this.sending = true;
    // Counted as reported even if it fails: an older server lacks the route, or the network
    // is down, and the next change or heartbeat tries again rather than a quick retry.
    this.reportedKey = reportKey(state);
    try {
      await this.deps.put(state);
    } catch {
      // See above.
    } finally {
      this.sending = false;
    }
    if (this.again) {
      this.again = false;
      void this.send();
    } else {
      // A change seen while sending.
      this.changed();
    }
  }

  /** The next heartbeat, while the link is on; none while it is off. */
  private schedule(state: ObsState | null): void {
    if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
    this.heartbeat = null;
    if (!state?.active || this.stopped) return;
    this.heartbeat = this.setTimer(() => {
      this.heartbeat = null;
      void this.send();
    }, OBS_REPORT_EVERY_MS);
  }
}
