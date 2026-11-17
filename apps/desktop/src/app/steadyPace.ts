/**
 * Keeps the main window's page at full speed while the workspace is live and the window is
 * out of view on macOS. Minimized, or on another desktop for a minute, the page's process
 * is slowed by the system: a message from a remote waits up to a fifth of a second to be
 * seen and timers come late, whatever the throttling policy and the app's own activity say.
 * A page that is making sound is left alone, and a silent one is not counted as making any;
 * so the page plays a tone too low and too quiet to hear, for as long as it is needed.
 */

/** Below what a speaker gives out and an ear takes in. */
const TONE_HZ = 10;
/** 60 dB below full scale; at no volume at all the page counts as silent. */
const TONE_GAIN = 0.001;

/** What the tone needs of Web Audio. */
export interface ToneContext {
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  /** Has `changed` called when the sound starts, stops or is interrupted; null for no more. */
  watch(changed: (() => void) | null): void;
}

export interface SteadyPaceDeps {
  /** Starts the tone in a new context; null where there is no Web Audio. */
  open?: () => ToneContext | null;
  /** Calls `retry` when the operator next clicks or types, and returns how to stop that. */
  onGesture?: (retry: () => void) => () => void;
}

function openTone(): ToneContext | null {
  if (typeof AudioContext === 'undefined') return null;
  const context = new AudioContext();
  const tone = context.createOscillator();
  const gain = context.createGain();
  tone.frequency.value = TONE_HZ;
  gain.gain.value = TONE_GAIN;
  tone.connect(gain).connect(context.destination);
  tone.start();
  return {
    get state() {
      return context.state;
    },
    resume: () => context.resume(),
    close: () => context.close(),
    watch: (changed) => {
      context.onstatechange = changed;
    },
  };
}

function onGesture(retry: () => void): () => void {
  const events = ['pointerdown', 'keydown'] as const;
  for (const event of events) window.addEventListener(event, retry, true);
  return () => {
    for (const event of events) window.removeEventListener(event, retry, true);
  };
}

export class SteadyPace {
  private context: ToneContext | null = null;
  private stopGestures: (() => void) | null = null;
  private readonly open: () => ToneContext | null;
  private readonly onGesture: (retry: () => void) => () => void;

  constructor(deps: SteadyPaceDeps = {}) {
    this.open = deps.open ?? openTone;
    this.onGesture = deps.onGesture ?? onGesture;
  }

  /** Plays the tone, or stops it. On twice plays one tone; off alone is harmless. */
  set(on: boolean): void {
    if (on && !this.context) {
      const context = this.open();
      if (!context) return;
      this.context = context;
      // The system may stop the sound, as when the output device changes; it is started again.
      context.watch(() => this.keepRunning());
      // A page nobody has touched yet may not make sound; it may after a click or a key.
      this.stopGestures = this.onGesture(() => this.keepRunning());
      this.keepRunning();
    } else if (!on && this.context) {
      this.stopGestures?.();
      this.stopGestures = null;
      this.context.watch(null);
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }

  private keepRunning(): void {
    if (this.context && this.context.state !== 'running') {
      void this.context.resume().catch(() => undefined);
    }
  }
}

/** True where the page is slowed out of view whatever it asks for: WebKit on macOS. */
export function needsSteadyPace(userAgent: string): boolean {
  return /Mac/.test(userAgent);
}
