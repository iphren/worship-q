/**
 * Watching the broadcast's input device (live audio plan, *Watching the input device*; A8,
 * A15, A19; task breakdown M2.2, M2.3). With the switch on, the broadcaster always ends up
 * capturing the chosen input when it is there, waits without failing when it is not, and
 * never shows the operator an error for a device that came or went.
 *
 * The decisions are here; the calls to `getUserMedia` and `enumerateDevices` are behind a
 * port, so the same logic runs on fakes in tests.
 *
 * Things the spike found that shape it: a track's `ended` is what marks an unplugged device
 * (L8); the first `devicechange` after plugging in can list the inputs without the device
 * (W5); another window's capture mutes this one's track on macOS (L7), so a muted track is
 * taken again; and `getUserMedia` neither resolves nor fails while the main window is out of
 * view on macOS (L17), so a request that is not answered says so (A19) rather than failing.
 */
import { systemClock, type Clock } from './timers';

export interface InputDevice {
  id: string;
  name: string;
}

/** The broadcast's input as the sending computer shows it; `hidden` is A19's. */
export type InputStatus = 'off' | 'live' | 'waiting' | 'refused' | 'hidden';

/** A capture track, as the watcher uses it. */
export interface CaptureTrack {
  readonly label: string;
  /** The device it captures, as `getSettings().deviceId` says; empty when unknown. */
  readonly deviceId: string;
  readonly muted: boolean;
  stop(): void;
  on(event: 'ended' | 'mute' | 'unmute', listener: () => void): void;
}

export interface MediaPort<T extends CaptureTrack> {
  /**
   * The audio inputs listed now, and the label of the system's default entry if any.
   * `locked` says there are inputs whose ids are hidden: a webview names no device until a
   * capture has been made in the page.
   */
  list(): Promise<{ inputs: InputDevice[]; defaultLabel: string | null; locked?: boolean }>;
  /** Opens the device, or the system default for null. Throws an error with a `name`. */
  open(deviceId: string | null): Promise<T>;
  /** Whether the window is in view. */
  visible(): boolean;
}

export interface InputWatcherDeps<T extends CaptureTrack> {
  port: MediaPort<T>;
  /** The track to send from now on: put in place on every connection; null while none. */
  onTrack(track: T | null): void;
  /** The status, the input's name, or whether a pick failed changed. */
  onChange?(): void;
  /** The chosen device was found by its name under another id: save the new id. */
  onDeviceMoved?(device: InputDevice): void;
  clock?: Clock;
}

/** An unanswered request is reported after this long (A19), and asked again. */
export const REQUEST_WAIT_MS = 5000;
/** Then asked again every this long while visible. */
export const REQUEST_RETRY_MS = 15_000;
/** The inputs are listed this often while the device is missing. */
export const LIST_EVERY_MS = 3000;
/** A mute followed by an unmute within this long is ignored. */
export const MUTE_GRACE_MS = 500;
/**
 * How long a mute lasts before the input is taken again: the grace first, then longer each
 * time the track taken is muted too, the last one repeated. Every retake makes each listener
 * connect afresh, so a mute that stays (a hardware switch) must not ask twice a second.
 */
export const MUTE_RETRY_MS = [MUTE_GRACE_MS, 2000, 5000, 15_000];

/** The chosen device among those listed: by id, else the first by name. */
export function findInput(inputs: readonly InputDevice[], chosen: InputDevice): InputDevice | null {
  return (
    inputs.find((device) => device.id === chosen.id) ??
    inputs.find((device) => device.name !== '' && device.name === chosen.name) ??
    null
  );
}

const REFUSED = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);

export class InputWatcher<T extends CaptureTrack> {
  private enabled = false;
  private chosen: InputDevice | null = null;
  private track_: T | null = null;
  private status_: InputStatus = 'off';
  private inputName_: string | null = null;
  private pickFailed_ = false;
  /** Numbers each request; only the newest one's result is used. */
  private seq = 0;
  /** The newest request is waiting for its answer. */
  private pending = false;
  private listing = false;
  private requestTimer: unknown = null;
  private retryTimer: unknown = null;
  private listTimer: unknown = null;
  private muteTimer: unknown = null;
  private retries = 0;
  /** Tracks taken again for a mute that arrived muted themselves, in a row. */
  private muteTries = 0;
  /** A capture was made to unlock the device ids; it is made once per switching on. */
  private unlocked = false;
  private defaultLabel: string | null = null;
  private readonly clock: Clock;

  constructor(private readonly deps: InputWatcherDeps<T>) {
    this.clock = deps.clock ?? systemClock;
  }

  get status(): InputStatus {
    return this.status_;
  }

  /** The input's name: the captured track's, or the chosen device's while waiting for it. */
  get inputName(): string | null {
    return this.inputName_;
  }

  /** The track sent now; null while none. */
  get track(): T | null {
    return this.track_;
  }

  /** The operator picked an input that could not be opened; the old one carries on. */
  get pickFailed(): boolean {
    return this.pickFailed_;
  }

  // ── What the app tells it ────────────────────────────────────────────────

  /** The switch, and the input chosen in Settings (null for the system default). */
  setEnabled(enabled: boolean, chosen: InputDevice | null): void {
    this.chosen = chosen;
    if (enabled === this.enabled) {
      // Pressing the switch again after a refusal asks again.
      if (enabled && this.status_ === 'refused') this.check(true);
      return;
    }
    this.enabled = enabled;
    if (!enabled) return this.shutDown();
    this.retries = 0;
    this.check(false);
  }

  /** The operator picked another input in Settings. */
  choose(device: InputDevice | null): void {
    this.chosen = device;
    if (!this.enabled) return;
    this.pickFailed_ = false;
    this.retries = 0;
    this.muteTries = 0;
    this.check(true);
  }

  /** `devicechange`. */
  devicesChanged(): void {
    if (!this.enabled) return;
    if (this.status_ !== 'live' || !this.chosen) this.check(false);
  }

  /** `visibilitychange`: a request that waited for the window may be answered or asked again. */
  visibilityChanged(): void {
    if (!this.enabled || !this.deps.port.visible()) return;
    if (this.status_ === 'hidden') {
      this.setStatus(this.track_ ? 'live' : 'waiting');
      // The pending request usually resolves now; if not, it is asked again shortly.
      this.clearTimer('retryTimer');
      this.retryTimer = this.clock.setTimeout(() => {
        this.retryTimer = null;
        if (this.enabled && !this.track_) {
          this.pending = false;
          this.check(false);
        }
      }, 1000);
    }
  }

  stop(): void {
    this.enabled = false;
    this.shutDown();
  }

  // ── Looking for the device ───────────────────────────────────────────────

  /**
   * Lists the inputs and asks for the chosen one when it is there, or waits for it. With
   * `switching`, the current track is replaced by the chosen device's, or stopped when that
   * device is not connected.
   */
  private check(switching: boolean): void {
    if (!this.enabled || this.listing) return;
    if (this.pending && !switching) return;
    // A refusal is asked again only on a press or a pick, never on a loop.
    if (this.status_ === 'refused' && !switching) return;
    // On the system default, a change of default is looked for below.
    if (this.track_ && !switching && this.status_ === 'live' && this.chosen) return;
    this.listing = true;
    void this.deps.port
      .list()
      .catch(() => ({ inputs: [] as InputDevice[], defaultLabel: null, locked: false }))
      .then(({ inputs, defaultLabel, locked }) => {
        this.listing = false;
        if (!this.enabled) return;
        if (locked && !this.track_ && (!this.chosen || !this.unlocked)) {
          // The ids are hidden until a capture is made (A15). On the system default that
          // capture is the one wanted; for a chosen device it is stopped at once and the
          // inputs are listed again, now by id.
          this.defaultLabel = defaultLabel;
          this.inputName_ = this.chosen?.name ?? null;
          this.setStatus('waiting');
          return this.request(null, this.chosen !== null);
        }
        const defaultChanged =
          !this.chosen && this.track_ !== null && defaultLabel !== this.defaultLabel;
        this.defaultLabel = defaultLabel;
        const chosen = this.chosen;
        const target = chosen ? findInput(inputs, chosen) : inputs.length > 0 ? null : undefined;
        if (target === undefined || (chosen && !target)) {
          // Not connected: wait for it, listing again on `devicechange` and every 3 s.
          if (switching && this.track_) this.replace(null);
          this.inputName_ = chosen?.name ?? null;
          this.setStatus(this.track_ ? 'live' : 'waiting');
          this.armList();
          return;
        }
        if (this.track_ && !switching && !defaultChanged && this.status_ === 'live') return;
        this.request(target);
      });
  }

  private request(target: InputDevice | null, unlocking = false): void {
    const seq = ++this.seq;
    this.pending = true;
    this.clearTimer('listTimer');
    this.clearTimer('requestTimer');
    this.requestTimer = this.clock.setTimeout(() => {
      this.requestTimer = null;
      if (seq !== this.seq || !this.pending) return;
      if (!this.deps.port.visible()) {
        // macOS answers only once the window is seen (L17): said, and nothing more is asked.
        if (!this.track_) this.setStatus('hidden');
        return;
      }
      if (!this.track_) this.setStatus('waiting');
      // Asked again: after 5 s, then every 15 s. A late answer to this one is still used
      // while no newer request has been made.
      const wait = this.retries === 0 ? REQUEST_WAIT_MS : REQUEST_RETRY_MS;
      this.retries++;
      this.clearTimer('retryTimer');
      this.retryTimer = this.clock.setTimeout(() => {
        this.retryTimer = null;
        if (seq === this.seq && this.pending && this.enabled) {
          this.pending = false;
          this.check(true);
        }
      }, wait);
    }, REQUEST_WAIT_MS);
    this.deps.port.open(target?.id ?? null).then(
      (track) => this.opened(seq, target, track, unlocking),
      (error: unknown) => this.refused(seq, error),
    );
  }

  private opened(seq: number, target: InputDevice | null, track: T, unlocking: boolean): void {
    if (seq !== this.seq || !this.enabled) {
      // A request made before the switch went off, or overtaken by a newer one.
      track.stop();
      return;
    }
    this.pending = false;
    this.retries = 0;
    this.clearTimer('requestTimer');
    this.clearTimer('retryTimer');
    this.clearTimer('listTimer');
    if (unlocking) {
      // Only there to make the ids visible: never sent, and the chosen device is looked for.
      track.stop();
      this.unlocked = true;
      return this.check(false);
    }
    this.pickFailed_ = false;
    if (!track.muted) this.muteTries = 0;
    this.replace(track);
    track.on('ended', () => this.ended(track));
    track.on('mute', () => this.muted(track));
    track.on('unmute', () => {
      if (track !== this.track_) return;
      this.clearTimer('muteTimer');
      this.muteTries = 0;
    });
    this.inputName_ = track.label || target?.name || null;
    const chosen = this.chosen;
    if (chosen && target && target.id !== chosen.id) this.deps.onDeviceMoved?.(target);
    this.setStatus('live');
    if (track.muted) this.muted(track);
  }

  private refused(seq: number, error: unknown): void {
    if (seq !== this.seq || !this.enabled) return;
    this.pending = false;
    this.clearTimer('requestTimer');
    this.clearTimer('retryTimer');
    const name = (error as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && REFUSED.has(name)) {
      // Asked again only when the operator presses the switch or picks an input.
      if (this.track_) this.replace(null);
      this.setStatus('refused');
      return;
    }
    if (this.track_) {
      // The pick could not be opened: the old input carries on (§3.5).
      this.pickFailed_ = true;
      this.changed();
      return;
    }
    // Gone between listing and opening, or busy: one more wait, no error shown.
    this.setStatus('waiting');
    this.armList();
  }

  /** The device was unplugged: waiting, listeners stay connected in silence. */
  private ended(track: T): void {
    if (track !== this.track_) return;
    this.clearTimer('muteTimer');
    this.replace(null);
    this.setStatus('waiting');
    this.check(false);
  }

  /** Another window took the microphone (L7): the input is asked for again. */
  private muted(track: T): void {
    if (track !== this.track_ || this.muteTimer !== null) return;
    const wait = MUTE_RETRY_MS[Math.min(this.muteTries, MUTE_RETRY_MS.length - 1)]!;
    this.muteTimer = this.clock.setTimeout(() => {
      this.muteTimer = null;
      if (track !== this.track_ || !track.muted || !this.enabled || this.pending) return;
      this.muteTries++;
      this.check(true);
    }, wait);
  }

  /** The new track goes in place first, and only then is the old one stopped. */
  private replace(track: T | null): void {
    const old = this.track_;
    this.track_ = track;
    this.deps.onTrack(track);
    if (old && old !== track) old.stop();
  }

  private armList(): void {
    if (this.listTimer !== null || !this.enabled) return;
    this.listTimer = this.clock.setTimeout(() => {
      this.listTimer = null;
      if (this.enabled && !this.track_) this.check(false);
      if (this.enabled && !this.track_ && !this.pending) this.armList();
    }, LIST_EVERY_MS);
  }

  private shutDown(): void {
    this.seq++;
    this.pending = false;
    for (const name of ['requestTimer', 'retryTimer', 'listTimer', 'muteTimer'] as const) {
      this.clearTimer(name);
    }
    if (this.track_) this.replace(null);
    this.pickFailed_ = false;
    this.muteTries = 0;
    this.unlocked = false;
    this.inputName_ = null;
    this.setStatus('off');
  }

  private clearTimer(name: 'requestTimer' | 'retryTimer' | 'listTimer' | 'muteTimer'): void {
    if (this[name] !== null) this.clock.clearTimeout(this[name]);
    this[name] = null;
  }

  private setStatus(status: InputStatus): void {
    if (status === this.status_) return this.changed();
    this.status_ = status;
    this.changed();
  }

  private changed(): void {
    this.deps.onChange?.();
  }
}
