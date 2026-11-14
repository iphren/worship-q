/**
 * Reports this computer's OBS state to the church server, for the admin app: soon after it
 * changes, and every `OBS_REPORT_EVERY_MS` while the link is on, so the admin app can tell a
 * silent OBS computer from one with nothing new. When the link is turned off, that is
 * reported once.
 *
 * Each heartbeat also carries one image of the scene on program; the admin app shows it in
 * place of a live monitor. When the scene on program changes, the next heartbeat comes
 * `OBS_SCENE_SNAPSHOT_MS` later instead, once the transition has finished, so the image
 * shows the new scene.
 *
 * The relay only forwards OBS messages between desktops and keeps none, and they never reach
 * the server when the OBS computer presents alone or the desktops meet on the LAN; so the
 * OBS computer says it itself, as the live state is backed up.
 */
import { OBS_REPORT_EVERY_MS, type ObsSnapshot, type ObsState } from '@worship-q/protocol';

/** A change is sent this long after it was seen, so a burst of changes makes one request. */
export const OBS_REPORT_DEBOUNCE_MS = 500;

/**
 * After the scene on program changes, the next heartbeat and its image come this soon, unless
 * OBS says first that the transition has finished.
 */
export const OBS_SCENE_SNAPSHOT_MS = 1000;

export interface ObsReporterDeps {
  /** This computer's own OBS state, durations as of now; see `ObsShare.ownState`. */
  state(): ObsState | null;
  /** One image of the scene on program, or null when OBS cannot give one. */
  snapshot(): Promise<ObsSnapshot | null>;
  /** Calls the listener whenever the shared OBS state may have changed. */
  subscribe(listener: () => void): () => void;
  /** Calls the listener when OBS finished a transition: the image is taken then. */
  transitionEnded?(listener: () => void): () => void;
  /** Sends a report; a failure is left for the next change or heartbeat to make up. */
  put(state: ObsState, snapshot: ObsSnapshot | null): Promise<void>;
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
  private readonly unsubscribeEnds: () => void;
  /** The key of the last state reported, or being reported. */
  private reportedKey = '';
  /** The scene on program when last looked; undefined before the first look. */
  private scene: string | null | undefined = undefined;
  private debounce: unknown = null;
  private heartbeat: unknown = null;
  private sending = false;
  /** A report became due while one was being sent; `true` when it is a heartbeat. */
  private again: boolean | null = null;
  private stopped = false;

  constructor(private readonly deps: ObsReporterDeps) {
    this.setTimer = deps.setTimeout ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer =
      deps.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.unsubscribe = deps.subscribe(() => this.changed());
    // The transition has finished, so the image shows the new scene in full; sooner than
    // `OBS_SCENE_SNAPSHOT_MS` after a quick one, later after a long one.
    this.unsubscribeEnds =
      deps.transitionEnded?.(() => {
        if (!this.stopped && this.deps.state()?.active) this.beat(0);
      }) ?? (() => undefined);
    this.changed();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe();
    this.unsubscribeEnds();
    if (this.debounce !== null) this.clearTimer(this.debounce);
    if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
    this.debounce = this.heartbeat = null;
  }

  private changed(): void {
    if (this.stopped) return;
    const state = this.deps.state();
    // A new scene on program, or the first one seen: its image comes shortly.
    const scene = state?.active ? state.currentScene : null;
    if (scene !== this.scene) {
      this.scene = scene;
      if (scene !== null) this.beat(OBS_SCENE_SNAPSHOT_MS);
    }
    if (this.debounce !== null || reportKey(state) === this.reportedKey) return;
    this.debounce = this.setTimer(() => {
      this.debounce = null;
      void this.send(false);
    }, OBS_REPORT_DEBOUNCE_MS);
  }

  /** The next heartbeat, `ms` from now, replacing the one waiting. */
  private beat(ms: number): void {
    if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
    this.heartbeat = this.setTimer(() => {
      this.heartbeat = null;
      void this.send(true);
    }, ms);
  }

  /** Sends a report; a heartbeat's carries an image of the program. */
  private async send(heartbeat: boolean): Promise<void> {
    if (this.stopped) return;
    if (this.sending) {
      this.again = this.again === true || heartbeat;
      return;
    }
    this.sending = true;
    try {
      const snapshot = heartbeat ? await this.deps.snapshot().catch(() => null) : null;
      if (this.stopped) return;
      const state = this.deps.state();
      if (!state?.active) {
        if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
        this.heartbeat = null;
      } else if (heartbeat || this.heartbeat === null) {
        this.beat(OBS_REPORT_EVERY_MS);
      }
      if (!state) {
        this.reportedKey = '';
        return;
      }
      // Counted as reported even if it fails: an older server lacks the route, or the
      // network is down, and the next change or heartbeat tries again rather than a quick
      // retry.
      this.reportedKey = reportKey(state);
      await this.deps.put(state, snapshot).catch(() => undefined);
    } finally {
      this.sending = false;
    }
    if (this.again !== null) {
      const next = this.again;
      this.again = null;
      void this.send(next);
    } else {
      // A change seen while sending.
      this.changed();
    }
  }
}
