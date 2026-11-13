import type { AudioState } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { AUDIO_REPORT_DEBOUNCE_MS, AUDIO_REPORT_EVERY_MS, AudioReporter } from './audioReport';
import { ICE_REUSE_MS, IceServers } from './iceServers';

function harness() {
  let now = 0;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let next = 1;
  let state: AudioState | null = null;
  let listener: () => void = () => undefined;
  const puts: AudioState[] = [];
  const reporter = new AudioReporter({
    state: () => state,
    subscribe: (fn) => {
      listener = fn;
      return () => undefined;
    },
    put: async (s) => void puts.push(s),
    setTimeout: (run, ms) => {
      const id = next++;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      due.run();
    }
  };
  return {
    reporter,
    puts,
    advance,
    set: (next: AudioState | null) => {
      state = next;
      listener();
    },
  };
}

const live = (patch: Partial<AudioState> = {}): AudioState => ({
  ownerId: 'A',
  ownerName: 'Sound desk',
  activatedAt: '2026-11-13T09:00:00.000Z',
  revision: 1,
  active: true,
  status: 'live',
  inputName: null,
  listeners: 0,
  ...patch,
});

describe('the audio report (A21, M5.5)', () => {
  it('reports soon after a change, then every half minute while on', () => {
    const env = harness();
    env.set(live());
    env.advance(AUDIO_REPORT_DEBOUNCE_MS);
    expect(env.puts).toHaveLength(1);
    env.advance(AUDIO_REPORT_EVERY_MS);
    expect(env.puts).toHaveLength(2);
  });

  it('reports once that the switch went off, then stops', () => {
    const env = harness();
    env.set(live({ listeners: 3 }));
    env.advance(AUDIO_REPORT_DEBOUNCE_MS);
    env.set(null);
    env.advance(AUDIO_REPORT_DEBOUNCE_MS);
    expect(env.puts.at(-1)).toMatchObject({ active: false, listeners: 0 });
    const count = env.puts.length;
    env.advance(AUDIO_REPORT_EVERY_MS * 3);
    expect(env.puts).toHaveLength(count);
  });
});

describe('the ICE list (M5.2)', () => {
  it('asks for each connection, reusing one answer for five minutes', async () => {
    let now = 0;
    let calls = 0;
    const ice = new IceServers(
      async () => {
        calls++;
        return { iceServers: [{ urls: 'stun:a' }] };
      },
      () => now,
    );
    await ice.get();
    now += ICE_REUSE_MS - 1;
    await ice.get();
    expect(calls).toBe(1);
    now += 1;
    expect(await ice.get()).toEqual([{ urls: 'stun:a' }]);
    expect(calls).toBe(2);
  });

  it('gives an empty list when the server cannot be reached, or none is joined', async () => {
    expect(await new IceServers(async () => Promise.reject(new Error('offline'))).get()).toEqual(
      [],
    );
    expect(await new IceServers(null).get()).toEqual([]);
  });
});
