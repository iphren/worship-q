import { describe, expect, it } from 'vitest';
import { needsSteadyPace, SteadyPace, type ToneContext } from './steadyPace';

class FakeTone implements ToneContext {
  state = 'suspended';
  resumed = 0;
  closed = 0;
  changed: (() => void) | null = null;
  watch(changed: (() => void) | null): void {
    this.changed = changed;
  }
  resume(): Promise<void> {
    this.resumed += 1;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

function setup() {
  const tones: FakeTone[] = [];
  let gesture: (() => void) | null = null;
  let listening = 0;
  const pace = new SteadyPace({
    open: () => {
      const tone = new FakeTone();
      tones.push(tone);
      return tone;
    },
    onGesture: (retry) => {
      gesture = retry;
      listening += 1;
      return () => {
        gesture = null;
        listening -= 1;
      };
    },
  });
  return { pace, tones, gesture: () => gesture?.(), listening: () => listening };
}

describe('SteadyPace', () => {
  it('plays one tone however often it is switched on, and closes it once', () => {
    const { pace, tones, listening } = setup();
    pace.set(true);
    pace.set(true);
    expect(tones).toHaveLength(1);
    pace.set(false);
    pace.set(false);
    expect(tones[0]!.closed).toBe(1);
    expect(listening()).toBe(0);
  });

  it('starts a tone the page was not yet allowed to play when the operator clicks', () => {
    const { pace, tones, gesture } = setup();
    pace.set(true);
    expect(tones[0]!.resumed).toBe(1);
    gesture();
    expect(tones[0]!.resumed).toBe(2);
    tones[0]!.state = 'running';
    gesture();
    expect(tones[0]!.resumed).toBe(2);
  });

  it('starts the tone again when the system stops it', () => {
    const { pace, tones } = setup();
    pace.set(true);
    tones[0]!.state = 'running';
    tones[0]!.state = 'interrupted';
    tones[0]!.changed?.();
    expect(tones[0]!.resumed).toBe(2);
  });

  it('plays a new tone when switched on again', () => {
    const { pace, tones } = setup();
    pace.set(true);
    pace.set(false);
    pace.set(true);
    expect(tones).toHaveLength(2);
    expect(tones[1]!.closed).toBe(0);
  });

  it('does nothing where there is no Web Audio', () => {
    const pace = new SteadyPace({ open: () => null, onGesture: () => () => undefined });
    pace.set(true);
    pace.set(false);
  });

  it('is needed on macOS only', () => {
    expect(needsSteadyPace('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605')).toBe(
      true,
    );
    expect(needsSteadyPace('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120')).toBe(false);
  });
});
