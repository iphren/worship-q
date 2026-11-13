import type { AudioSignal } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { FakeClock, settle } from './fakeClock';
import type { Broadcast, ListenPeerEvents } from './listener';
import { ListenPlayer, STATS_EVERY_MS, type ListenState } from './player';

interface FakePeer {
  events: ListenPeerEvents<string>;
  /** What `getStats` gives next. */
  report: unknown;
  closed: boolean;
}

/** Statistics after `seconds` of sound, with the buffer holding `bufferMs`. */
const report = (seconds: number, bufferMs: number) => [
  {
    id: 'in',
    type: 'inbound-rtp',
    kind: 'audio',
    jitterBufferDelay: (seconds * 48_000 * bufferMs) / 1000,
    jitterBufferEmittedCount: seconds * 48_000,
  },
];

function setup(options: { prepare?: boolean } = {}) {
  const clock = new FakeClock();
  const peers: FakePeer[] = [];
  const sent: AudioSignal[] = [];
  const log: string[] = [];
  const states: ListenState[] = [];
  const prepares: { resolve(): void; reject(): void }[] = [];
  let n = 0;
  const player = new ListenPlayer<string>({
    clock,
    newId: () => `s${++n}`,
    send: (_to, signal) => {
      log.push(`send:${signal.kind}`);
      sent.push(signal);
    },
    output: {
      unlock: () => log.push('unlock'),
      play: (stream) => log.push(`play:${stream}`),
    },
    onListening: (on) => log.push(on ? 'on' : 'off'),
    ...(options.prepare
      ? {
          prepare: () => {
            log.push('prepare');
            return new Promise<void>((resolve, reject) => prepares.push({ resolve, reject }));
          },
        }
      : {}),
    createPeer: ({ events }) => {
      const peer: FakePeer = { events, report: null, closed: false };
      peers.push(peer);
      return {
        answer: async (offer, tune) => tune(`answer-to-${offer}`),
        addCandidate: async () => undefined,
        close: () => {
          peer.closed = true;
        },
        stats: async () => peer.report,
      };
    },
  });
  player.subscribe(() => states.push(player.state));
  return { clock, player, peers, sent, log, states, prepares };
}

const live: Broadcast = {
  ownerId: 'A',
  activatedAt: '2026-11-13T09:00:00.000Z',
  active: true,
  status: 'live',
};

async function connect(env: ReturnType<typeof setup>, session = 's1') {
  env.player.signal({ kind: 'offer', session, sdp: 'o' });
  await settle();
  const peer = env.peers.at(-1)!;
  peer.events.stream(`stream-${session}`);
  peer.events.state('connected');
  return peer;
}

describe('pressing and releasing Listen', () => {
  it('unlocks playback inside the press, then asks, and shows what the listener says', async () => {
    const env = setup();
    env.player.setBroadcast(live);
    env.player.start();
    expect(env.log).toEqual(['unlock', 'on', 'send:listen']);
    expect(env.player.state).toEqual({ status: { kind: 'connecting' }, delay: null });
    await connect(env);
    expect(env.log.at(-1)).toBe('play:stream-s1');
    expect(env.player.state.status).toEqual({ kind: 'playing' });
    env.player.stop();
    expect(env.player.state).toEqual({ status: { kind: 'off' }, delay: null });
    expect(env.log.slice(-2)).toEqual(['play:null', 'off']);
    expect(env.clock.pending).toBe(0);
  });

  it('prepares between the press and asking, in that order', async () => {
    const env = setup({ prepare: true });
    env.player.setBroadcast(live);
    env.player.start();
    expect(env.log).toEqual(['unlock', 'prepare']);
    expect(env.player.state.status).toEqual({ kind: 'connecting' });
    expect(env.player.listening).toBe(true);
    env.prepares[0]!.resolve();
    await settle();
    expect(env.log).toEqual(['unlock', 'prepare', 'on', 'send:listen']);
  });

  it('asks all the same when preparing fails', async () => {
    const env = setup({ prepare: true });
    env.player.setBroadcast(live);
    env.player.start();
    env.prepares[0]!.reject();
    await settle();
    expect(env.sent).toEqual([{ kind: 'listen', session: 's1' }]);
  });

  it('obeys a release while it prepares: nothing is asked, nothing plays', async () => {
    const env = setup({ prepare: true });
    env.player.setBroadcast(live);
    env.player.start();
    env.player.stop();
    expect(env.player.state.status).toEqual({ kind: 'off' });
    expect(env.player.listening).toBe(false);
    env.prepares[0]!.resolve();
    await settle();
    expect(env.sent).toEqual([]);
    expect(env.player.listener.listening).toBe(false);
    expect(env.player.state.status).toEqual({ kind: 'off' });
    expect(env.clock.pending).toBe(0);
  });

  it('prepares once for two presses, and once more for a press after a release', async () => {
    const env = setup({ prepare: true });
    env.player.setBroadcast(live);
    env.player.start();
    env.player.start();
    expect(env.prepares).toHaveLength(1);
    env.player.stop();
    env.player.start();
    expect(env.prepares).toHaveLength(2);
    // The first press's preparation ends late: only the second one's counts.
    env.prepares[0]!.resolve();
    await settle();
    expect(env.sent).toEqual([]);
    env.prepares[1]!.resolve();
    await settle();
    expect(env.sent).toEqual([{ kind: 'listen', session: 's1' }]);
  });

  it('shows off, and may be pressed again, when Listen turns itself off', () => {
    const env = setup();
    env.player.start();
    env.clock.advance(60_000);
    expect(env.player.state.status).toEqual({ kind: 'off' });
    expect(env.player.listening).toBe(false);
    expect(env.log.at(-1)).toBe('off');
    env.player.setBroadcast(live);
    env.player.start();
    expect(env.sent).toEqual([{ kind: 'listen', session: 's1' }]);
  });

  it('tells its subscribers only when something changed', async () => {
    const env = setup();
    env.player.setBroadcast(live);
    env.player.start();
    await connect(env);
    env.player.setBroadcast({ ...live });
    expect(env.states.map((s) => s.status.kind)).toEqual(['connecting', 'playing']);
  });
});

describe('the delay figure (M3.6)', () => {
  it('reads the statistics every two seconds while listening, and stops when released', async () => {
    const env = setup();
    env.player.setBroadcast(live);
    env.player.start();
    const peer = await connect(env);
    peer.report = report(1, 80);
    env.clock.advance(STATS_EVERY_MS);
    await settle();
    expect(env.player.state.delay).toMatchObject({ delayMs: null });
    peer.report = report(3, 80);
    env.clock.advance(STATS_EVERY_MS);
    await settle();
    expect(env.player.state.delay).toMatchObject({ delayMs: 80, stale: false });
    env.player.stop();
    expect(env.player.state.delay).toBeNull();
    env.clock.advance(STATS_EVERY_MS * 3);
    await settle();
    expect(env.player.state.delay).toBeNull();
  });

  it('asks for a fresh connection when the buffer stays above 300 ms (A18)', async () => {
    const env = setup();
    env.player.setBroadcast(live);
    env.player.start();
    const peer = await connect(env);
    for (let second = 2; second <= 10; second += 2) {
      peer.report = report(second, 400);
      env.clock.advance(STATS_EVERY_MS);
      await settle();
    }
    expect(env.sent.filter((s) => s.kind === 'listen')).toEqual([
      { kind: 'listen', session: 's1' },
      { kind: 'listen', session: 's2' },
    ]);
  });

  it('drops a reading that belongs to a connection since replaced', async () => {
    const env = setup();
    env.player.setBroadcast(live);
    env.player.start();
    const peer = await connect(env);
    peer.report = report(1, 80);
    env.clock.advance(STATS_EVERY_MS);
    // The session changes while the statistics are being read.
    env.player.signal({ kind: 'close', session: 's1', reason: 'timeout' });
    await settle();
    expect(env.player.state.delay).toBeNull();
  });
});
