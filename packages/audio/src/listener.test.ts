import type { AudioSignal, IceServer } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { FakeClock, settle } from './fakeClock';
import {
  BUFFER_FRESH_EVERY_MS,
  FRESH_WAIT_MS,
  Listener,
  NO_BROADCAST_MS,
  OFFER_WAIT_MS,
  UNREACHABLE_MS,
  type Broadcast,
  type ListenPeerEvents,
  type ListenStatus,
} from './listener';

interface FakePeer {
  events: ListenPeerEvents<string>;
  iceServers: IceServer[];
  offers: string[];
  candidates: string[];
  closed: boolean;
}

function setup(options: { iceServers?: IceServer[] } = {}) {
  const clock = new FakeClock();
  const peers: FakePeer[] = [];
  const sent: { to: string; signal: AudioSignal }[] = [];
  const streams: (string | null)[] = [];
  const statuses: ListenStatus[] = [];
  let n = 0;
  const listener = new Listener<string>({
    clock,
    newId: () => `s${++n}`,
    send: (to, signal) => sent.push({ to, signal }),
    iceServers: async () => options.iceServers ?? [],
    onStream: (stream) => streams.push(stream),
    onStatus: (status) => statuses.push(status),
    createPeer: ({ iceServers, events }) => {
      const peer: FakePeer = { events, iceServers, offers: [], candidates: [], closed: false };
      peers.push(peer);
      return {
        answer: async (offer, tune) => {
          peer.offers.push(offer);
          return tune(`answer-to-${offer}`);
        },
        addCandidate: async (candidate) => {
          peer.candidates.push(candidate.candidate);
        },
        close: () => {
          peer.closed = true;
        },
      };
    },
  });
  return { clock, peers, sent, streams, statuses, listener };
}

const live = (patch: Partial<Broadcast> = {}): Broadcast => ({
  ownerId: 'A',
  activatedAt: '2026-11-13T09:00:00.000Z',
  active: true,
  status: 'live',
  ...patch,
});

const offer = (session: string, sdp = 'o', iceServers?: IceServer[]): AudioSignal => ({
  kind: 'offer',
  session,
  sdp,
  ...(iceServers ? { iceServers } : {}),
});

/** Presses Listen and connects the first session to the end. */
async function connect(env: ReturnType<typeof setup>, session = 's1', peerIndex = 0) {
  env.listener.signal(offer(session));
  await settle();
  const peer = env.peers[peerIndex]!;
  peer.events.stream(`stream-${session}`);
  peer.events.state('connected');
  return peer;
}

describe('connecting (M3.1)', () => {
  it('does nothing until Listen is pressed', () => {
    const env = setup();
    env.listener.setBroadcast(live());
    expect(env.sent).toEqual([]);
  });

  it('asks the owner, answers with the tuned description, and plays the track', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    expect(env.sent).toEqual([{ to: 'A', signal: { kind: 'listen', session: 's1' } }]);
    await connect(env);
    expect(env.sent[1]).toEqual({
      to: 'A',
      signal: { kind: 'answer', session: 's1', sdp: 'answer-to-o' },
    });
    expect(env.streams).toEqual(['stream-s1']);
    expect(env.listener.status).toEqual({ kind: 'playing' });
  });

  it('holds candidates until it has answered, and sends its own', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    env.listener.signal({ kind: 'candidate', session: 's1', candidate: { candidate: 'early' } });
    env.listener.signal(offer('s1'));
    await settle();
    expect(env.peers[0]!.candidates).toEqual(['early']);
    env.peers[0]!.events.candidate({ candidate: 'mine' });
    expect(env.sent.at(-1)!.signal).toEqual({
      kind: 'candidate',
      session: 's1',
      candidate: { candidate: 'mine' },
    });
  });

  it('keeps one session when pressed twice, and closes a late offer after release', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    env.listener.start();
    expect(env.sent.filter((s) => s.signal.kind === 'listen')).toHaveLength(1);
    env.listener.stop();
    env.listener.signal(offer('s1'));
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'close', session: 's1', reason: 'stopped' });
  });

  it('asks again with a new session when no offer comes in 5 s, waiting longer each time', () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    env.clock.advance(OFFER_WAIT_MS);
    env.clock.advance(1000);
    const listens = () =>
      env.sent.filter((s) => s.signal.kind === 'listen').map((s) => s.signal.session);
    expect(listens()).toEqual(['s1', 's2']);
    env.clock.advance(OFFER_WAIT_MS + 1999);
    expect(listens()).toEqual(['s1', 's2']);
    env.clock.advance(1);
    expect(listens()).toEqual(['s1', 's2', 's3']);
  });

  it('shows full and retries nothing until pressed again', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    env.listener.signal({ kind: 'full', session: 's1' });
    expect(env.listener.status).toEqual({ kind: 'full' });
    env.clock.advance(60_000);
    expect(env.sent.filter((s) => s.signal.kind === 'listen')).toHaveLength(1);
    env.listener.stop();
    env.listener.start();
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'listen', session: 's2' });
  });

  it('closes, empties the element and says off when released', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    const peer = await connect(env);
    env.listener.stop();
    expect(peer.closed).toBe(true);
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'close', session: 's1', reason: 'stopped' });
    expect(env.streams.at(-1)).toBeNull();
    expect(env.listener.status).toEqual({ kind: 'off' });
  });
});

describe('staying connected (M3.1)', () => {
  it('asks for an ICE restart on disconnected, and plays on when back', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    const peer = await connect(env);
    peer.events.state('disconnected');
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'listen', session: 's1', restart: true });
    expect(env.listener.status).toEqual({ kind: 'reconnecting' });
    env.listener.signal(offer('s1', 'restart'));
    await settle();
    expect(env.peers).toHaveLength(1);
    expect(peer.offers).toEqual(['o', 'restart']);
    peer.events.state('connected');
    expect(env.listener.status).toEqual({ kind: 'playing' });
  });

  it('closes on failed and asks again after 1 s, growing; a success resets the wait', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    const peer = await connect(env);
    peer.events.state('failed');
    expect(peer.closed).toBe(true);
    env.clock.advance(999);
    expect(env.sent.at(-1)!.signal.kind).toBe('close');
    env.clock.advance(1);
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'listen', session: 's2' });
    await connect(env, 's2', 1);
    env.peers[1]!.events.state('failed');
    env.clock.advance(1000);
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'listen', session: 's3' });
  });

  it('stays connected in silence while the broadcaster waits for its input', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    env.listener.setBroadcast(live({ status: 'waiting' }));
    expect(env.listener.status).toEqual({ kind: 'waiting' });
    expect(env.sent.filter((s) => s.signal.kind === 'listen')).toHaveLength(1);
    env.listener.setBroadcast(live());
    expect(env.listener.status).toEqual({ kind: 'playing' });
  });

  it('asks again by itself when the broadcaster restarts', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    env.listener.setBroadcast(null);
    env.listener.setBroadcast(live({ activatedAt: '2026-11-13T10:00:00.000Z' }));
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'listen', session: 's2' });
  });

  it('moves to another computer that takes over', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    const peer = await connect(env);
    env.listener.setBroadcast(live({ ownerId: 'B', activatedAt: '2026-11-13T09:30:00.000Z' }));
    expect(peer.closed).toBe(true);
    expect(env.sent.slice(-2)).toEqual([
      { to: 'A', signal: { kind: 'close', session: 's1', reason: 'stopped' } },
      { to: 'B', signal: { kind: 'listen', session: 's2' } },
    ]);
  });

  it('turns off after the broadcast has been gone a minute, and picks one up within it', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    env.listener.setBroadcast(null);
    env.clock.advance(NO_BROADCAST_MS - 1);
    expect(env.listener.listening).toBe(true);
    env.listener.setBroadcast(live());
    env.clock.advance(NO_BROADCAST_MS);
    expect(env.listener.listening).toBe(true);
    env.listener.setBroadcast(null);
    env.clock.advance(NO_BROADCAST_MS);
    expect(env.listener.listening).toBe(false);
    expect(env.listener.status).toEqual({ kind: 'off' });
  });
});

describe('connecting afresh (A17, A18)', () => {
  it('opens a new session on retaken, moves the sound once it arrives, then closes the old', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    const old = await connect(env);
    env.listener.signal({ kind: 'retaken', session: 's1' });
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'listen', session: 's2' });
    expect(old.closed).toBe(false);
    await connect(env, 's2', 1);
    expect(env.streams).toEqual(['stream-s1', 'stream-s2']);
    expect(old.closed).toBe(true);
    expect(env.sent.at(-1)!.signal).toEqual({ kind: 'close', session: 's1', reason: 'replaced' });
    expect(env.listener.sessionId).toBe('s2');
  });

  it('keeps the old connection when the new one brings no sound in 3 s', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    const old = await connect(env);
    env.listener.signal({ kind: 'retaken', session: 's1' });
    env.listener.signal(offer('s2'));
    await settle();
    env.clock.advance(FRESH_WAIT_MS);
    expect(env.peers[1]!.closed).toBe(true);
    expect(old.closed).toBe(false);
    expect(env.listener.sessionId).toBe('s1');
  });

  it('starts one fresh connection for two retaken within a second', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    env.listener.signal({ kind: 'retaken', session: 's1' });
    env.clock.advance(500);
    env.listener.signal({ kind: 'retaken', session: 's1' });
    expect(env.sent.filter((s) => s.signal.kind === 'listen')).toHaveLength(2);
  });

  it('connects afresh after a buffer above 300 ms for 3 s, and not at 299 ms or for 2.9 s', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    const listens = () => env.sent.filter((s) => s.signal.kind === 'listen').length;
    env.listener.reportBuffer(299);
    env.clock.advance(5000);
    env.listener.reportBuffer(299);
    expect(listens()).toBe(1);
    env.listener.reportBuffer(350);
    env.clock.advance(2900);
    env.listener.reportBuffer(350);
    expect(listens()).toBe(1);
    env.clock.advance(100);
    env.listener.reportBuffer(350);
    expect(listens()).toBe(2);
  });

  it('asks nothing more by the buffer for 10 s after, but still obeys retaken', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    const listens = () => env.sent.filter((s) => s.signal.kind === 'listen').length;
    env.listener.reportBuffer(400);
    env.clock.advance(3000);
    env.listener.reportBuffer(400);
    expect(listens()).toBe(2);
    env.clock.advance(1000);
    env.listener.reportBuffer(400);
    env.clock.advance(3000);
    env.listener.reportBuffer(400);
    expect(listens()).toBe(2);
    env.listener.signal({ kind: 'retaken', session: 's1' });
    expect(listens()).toBe(3);
    env.clock.advance(BUFFER_FRESH_EVERY_MS);
  });

  it('drops a fresh connection still being made for the latest one', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    env.listener.signal({ kind: 'retaken', session: 's1' });
    env.clock.advance(1500);
    env.listener.signal({ kind: 'retaken', session: 's1' });
    expect(env.sent.slice(-2).map((s) => s.signal)).toEqual([
      { kind: 'close', session: 's2', reason: 'replaced' },
      { kind: 'listen', session: 's3' },
    ]);
  });

  it('keeps the old connection when a fresh one is refused as full', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    env.listener.signal({ kind: 'retaken', session: 's1' });
    env.listener.signal({ kind: 'full', session: 's2' });
    expect(env.listener.sessionId).toBe('s1');
    expect(env.listener.status).toEqual({ kind: 'playing' });
  });
});

describe('could not connect (M5.4)', () => {
  it('says so after 15 s, naming that no relay was offered', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    env.listener.signal(offer('s1'));
    await settle();
    env.clock.advance(UNREACHABLE_MS);
    expect(env.listener.status).toEqual({ kind: 'unreachable', relay: false });
  });

  it('says the relay was tried when the list had one', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    env.listener.signal(
      offer('s1', 'o', [{ urls: 'turn:turn.example.org:3478', username: 'u', credential: 'c' }]),
    );
    await settle();
    env.clock.advance(UNREACHABLE_MS);
    expect(env.listener.status).toEqual({ kind: 'unreachable', relay: true });
  });

  it('connects with no list at all, and shows no message', async () => {
    const env = setup();
    env.listener.setBroadcast(live());
    env.listener.start();
    await connect(env);
    env.clock.advance(UNREACHABLE_MS);
    expect(env.peers[0]!.iceServers).toEqual([]);
    expect(env.listener.status).toEqual({ kind: 'playing' });
  });

  it('uses the offer’s ICE servers over its own', async () => {
    const env = setup({ iceServers: [{ urls: 'stun:mine' }] });
    env.listener.setBroadcast(live());
    env.listener.start();
    env.listener.signal(offer('s1', 'o', [{ urls: 'stun:theirs' }]));
    await settle();
    expect(env.peers[0]!.iceServers).toEqual([{ urls: 'stun:theirs' }]);
  });
});
