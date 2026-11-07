import { OBS_REPORT_EVERY_MS, type ObsSnapshot, type ObsState } from '@worship-q/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OBS_REPORT_DEBOUNCE_MS, OBS_SCENE_SNAPSHOT_MS, ObsReporter } from './obsReport';

const idle = { active: false, phase: null, durationMs: null, paused: false } as const;

function obsState(patch: Partial<ObsState> = {}): ObsState {
  return {
    ownerId: 'mac',
    ownerName: 'OBS Mac',
    activatedAt: '2026-11-01T10:00:00.000Z',
    revision: 1,
    active: true,
    status: 'connected',
    scenes: ['Camera', 'Slides'],
    currentScene: 'Camera',
    favourites: [null, null],
    stream: idle,
    record: idle,
    virtualCam: idle,
    ...patch,
  };
}

function harness(options: { initial?: ObsState | null; fail?: boolean; slow?: boolean } = {}) {
  let state: ObsState | null = options.initial === undefined ? obsState() : options.initial;
  const listeners = new Set<() => void>();
  const sent: { state: ObsState; snapshot: ObsSnapshot | null }[] = [];
  const pending: (() => void)[] = [];
  let shots = 0;
  const reporter = new ObsReporter({
    state: () => state,
    // Each image names the scene on program when it was taken.
    snapshot: async () => ({
      image: `data:image/jpeg;base64,${btoa(`${state?.currentScene}-${++shots}`)}`,
      takenAt: '2026-11-01T10:00:00.000Z',
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    put: (s, snapshot) => {
      sent.push({ state: s, snapshot });
      if (options.fail) return Promise.reject(new Error('http-404'));
      if (options.slow) return new Promise<void>((resolve) => pending.push(resolve));
      return Promise.resolve();
    },
  });
  return {
    reporter,
    sent,
    /** The scene each sent image showed, null for a report without one. */
    images: () => sent.map((s) => (s.snapshot ? atob(s.snapshot.image.split(',')[1]!) : null)),
    set(next: ObsState | null) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
    finish: () => pending.shift()?.(),
    listeners,
  };
}

describe('ObsReporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports at once, with an image of the program shortly after', async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.images()).toEqual([null]);
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS - OBS_REPORT_DEBOUNCE_MS);
    expect(h.images()).toEqual([null, 'Camera-1']);
  });

  it('sends a burst of changes as one report, without an image', async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS);
    h.set(obsState({ stream: { ...idle, phase: 'starting' } }));
    h.set(obsState({ stream: { ...idle, active: true, durationMs: 0 } }));
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]!.state.stream.active).toBe(true);
    expect(h.sent[2]!.snapshot).toBeNull();
  });

  it('takes an image a second after the scene changes, then beats on from there', async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS + 10_000);
    h.set(obsState({ currentScene: 'Slides' }));
    // The change itself goes first, and does not put the image off.
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.images()).toEqual([null, 'Camera-1', null]);
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS - OBS_REPORT_DEBOUNCE_MS);
    expect(h.images()).toEqual([null, 'Camera-1', null, 'Slides-2']);
    // The heartbeat that was due 20 s later now comes 30 s after this image.
    await vi.advanceTimersByTimeAsync(OBS_REPORT_EVERY_MS - 1);
    expect(h.sent).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.images().at(-1)).toBe('Slides-3');
  });

  it('carries durations that only advanced with the heartbeat, not a report of their own', async () => {
    const running = { active: true, phase: null, paused: false } as const;
    const h = harness({ initial: obsState({ stream: { ...running, durationMs: 0 } }) });
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS);
    h.set(obsState({ stream: { ...running, durationMs: 5000 } }));
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(OBS_REPORT_EVERY_MS);
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]!.state.stream.durationMs).toBe(5000);
  });

  it('beats while the link is on, reports once that it was turned off, then goes quiet', async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS + OBS_REPORT_EVERY_MS * 2);
    expect(h.sent).toHaveLength(4);
    h.set(obsState({ active: false, status: 'not-running', currentScene: null }));
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS + OBS_REPORT_EVERY_MS * 3);
    expect(h.sent).toHaveLength(5);
    expect(h.sent[4]!.state.active).toBe(false);
    expect(h.sent[4]!.snapshot).toBeNull();
  });

  it('tries again at the next heartbeat after a failure, not at once', async () => {
    const h = harness({ fail: true });
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS);
    expect(h.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(OBS_REPORT_EVERY_MS - 1);
    expect(h.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent).toHaveLength(3);
  });

  it('sends one report at a time, and what came due meanwhile after it', async () => {
    const h = harness({ slow: true });
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    h.set(obsState({ currentScene: 'Slides' }));
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS * 2);
    expect(h.sent).toHaveLength(1);
    h.finish();
    await vi.advanceTimersByTimeAsync(0);
    // The image came due while the first report was out: it goes next, of the new scene.
    expect(h.images()).toEqual([null, 'Slides-1']);
  });

  it('sends nothing without a state, and stops when asked', async () => {
    const h = harness({ initial: null });
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS + OBS_REPORT_EVERY_MS);
    expect(h.sent).toHaveLength(0);
    h.reporter.stop();
    expect(h.listeners.size).toBe(0);
    h.set(obsState());
    await vi.advanceTimersByTimeAsync(OBS_SCENE_SNAPSHOT_MS);
    expect(h.sent).toHaveLength(0);
  });
});
