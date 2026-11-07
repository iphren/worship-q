import { OBS_REPORT_EVERY_MS, type ObsState } from '@worship-q/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OBS_REPORT_DEBOUNCE_MS, ObsReporter } from './obsReport';

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

function harness(options: { fail?: boolean; slow?: boolean } = {}) {
  let state: ObsState | null = obsState();
  const listeners = new Set<() => void>();
  const sent: ObsState[] = [];
  const pending: (() => void)[] = [];
  const reporter = new ObsReporter({
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    put: (s) => {
      sent.push(s);
      if (options.fail) return Promise.reject(new Error('http-404'));
      if (options.slow) return new Promise<void>((resolve) => pending.push(resolve));
      return Promise.resolve();
    },
  });
  return {
    reporter,
    sent,
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

  it('sends a burst of changes as one report', async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(1);
    h.set(obsState({ currentScene: 'Slides' }));
    h.set(obsState({ currentScene: 'Camera', stream: { ...idle, phase: 'starting' } }));
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.stream.phase).toBe('starting');
  });

  it('leaves out durations that only advanced, which the heartbeat carries', async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    const running = { active: true, phase: null, paused: false } as const;
    h.set(obsState({ stream: { ...running, durationMs: 0 } }));
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    h.set(obsState({ stream: { ...running, durationMs: 5000 } }));
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(OBS_REPORT_EVERY_MS);
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]!.stream.durationMs).toBe(5000);
  });

  it('beats while the link is on, reports once that it was turned off, then goes quiet', async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS + OBS_REPORT_EVERY_MS * 2);
    expect(h.sent).toHaveLength(3);
    h.set(obsState({ active: false, status: 'not-running' }));
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS + OBS_REPORT_EVERY_MS * 3);
    expect(h.sent).toHaveLength(4);
    expect(h.sent[3]!.active).toBe(false);
  });

  it('tries again at the next heartbeat after a failure, not at once', async () => {
    const h = harness({ fail: true });
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(OBS_REPORT_EVERY_MS - 1);
    expect(h.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent).toHaveLength(2);
  });

  it('sends one report at a time, and a change made meanwhile after it', async () => {
    const h = harness({ slow: true });
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    h.set(obsState({ currentScene: 'Slides' }));
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS * 4);
    expect(h.sent).toHaveLength(1);
    h.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.currentScene).toBe('Slides');
  });

  it('sends nothing without a state, and stops when asked', async () => {
    const h = harness();
    h.set(null);
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS + OBS_REPORT_EVERY_MS);
    expect(h.sent).toHaveLength(0);
    h.reporter.stop();
    expect(h.listeners.size).toBe(0);
    h.set(obsState());
    await vi.advanceTimersByTimeAsync(OBS_REPORT_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(0);
  });
});
