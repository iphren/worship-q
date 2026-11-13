/**
 * The broadcaster and a listener run against each other, signals passed straight across, so
 * what one end does on a timer is seen by the other. Each end is tested alone elsewhere.
 */
import {
  AUDIO_LISTENER_LIMIT,
  type AudioListener,
  type AudioSignal,
  type IceServer,
} from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  Broadcaster,
  OLD_SESSION_MS,
  type BroadcastPeer,
  type BroadcastPeerEvents,
} from './broadcaster';
import { FakeClock, settle } from './fakeClock';
import {
  FRESH_WAIT_MS,
  Listener,
  RESTART_WAIT_MS,
  type Broadcast,
  type ListenPeerEvents,
  type ListenStatus,
} from './listener';

interface SendPeer extends BroadcastPeer<string> {
  events: BroadcastPeerEvents;
  iceServers: IceServer[];
  track: string | null;
  offers: number;
  answers: string[];
  closed: boolean;
}

interface ReceivePeer {
  events: ListenPeerEvents<string>;
  iceServers: IceServer[];
  offers: string[];
  closed: boolean;
}

const me: AudioListener = { kind: 'desktop', deviceId: 'L', name: 'Booth' };
const other = (i: number): AudioListener => ({ kind: 'desktop', deviceId: `D${i}`, name: '' });

function broadcasterEnd(clock: FakeClock, ownerId: string, deliver: (s: AudioSignal) => void) {
  const peers: SendPeer[] = [];
  let servers: IceServer[] = [{ urls: 'turn:t', username: 'early', credential: 'old' }];
  const broadcaster = new Broadcaster<string, string>({
    clock,
    iceServers: async () => servers,
    // Only the listener under test is wired; the others' signals go nowhere.
    send: (route, signal) => {
      if (route === 'L') deliver(signal);
    },
    createPeer: ({ track, iceServers, events }) => {
      const peer: SendPeer = {
        events,
        iceServers,
        track,
        offers: 0,
        answers: [],
        closed: false,
        offer: async (restart) =>
          `${ownerId}-offer-${peers.indexOf(peer)}-${++peer.offers}${restart ? 'r' : ''}`,
        answer: async (sdp) => {
          peer.answers.push(sdp);
        },
        addCandidate: async () => undefined,
        setTrack: async (next) => {
          peer.track = next;
        },
        setIceServers: (next) => {
          peer.iceServers = next;
        },
        close: () => {
          peer.closed = true;
        },
      };
      peers.push(peer);
      return peer;
    },
  });
  return {
    broadcaster,
    peers,
    setIceServers: (next: IceServer[]) => {
      servers = next;
    },
  };
}

function setup() {
  const clock = new FakeClock();
  const receivers: ReceivePeer[] = [];
  const streams: (string | null)[] = [];
  const statuses: ListenStatus[] = [];
  let servers: IceServer[] = [{ urls: 'turn:t', username: 'early', credential: 'old' }];
  let n = 0;
  const ends: Record<string, ReturnType<typeof broadcasterEnd>> = {};
  const listener: Listener<string> = new Listener<string>({
    clock,
    newId: () => `s${++n}`,
    send: (ownerId, signal) => ends[ownerId]?.broadcaster.signal('L', me, signal),
    iceServers: async () => servers,
    onStream: (stream) => streams.push(stream),
    onStatus: (status) => statuses.push(status),
    createPeer: ({ iceServers, events }) => {
      const peer: ReceivePeer = { events, iceServers, offers: [], closed: false };
      receivers.push(peer);
      return {
        answer: async (offer, tune) => {
          peer.offers.push(offer);
          return tune(`answer-to-${offer}`);
        },
        addCandidate: async () => undefined,
        setIceServers: (next) => {
          peer.iceServers = next;
        },
        close: () => {
          peer.closed = true;
        },
      };
    },
  });
  ends.A = broadcasterEnd(clock, 'A', (signal) => listener.signal(signal));
  ends.B = broadcasterEnd(clock, 'B', (signal) => listener.signal(signal));
  const state = (ownerId: string, patch: Partial<Broadcast> = {}): Broadcast => ({
    ownerId,
    activatedAt: ownerId === 'A' ? '2026-11-13T09:00:00.000Z' : '2026-11-13T09:30:00.000Z',
    active: true,
    status: 'live',
    ...patch,
  });
  /** Sound arrives on the listener's newest connection, and both ends see it connected. */
  const sound = (end = ends.A!) => {
    const receive = receivers.at(-1)!;
    receive.events.stream(`stream-${receivers.length}`);
    receive.events.state('connected');
    end.peers.at(-1)!.events.state('connected');
  };
  return {
    clock,
    listener,
    receivers,
    streams,
    statuses,
    a: ends.A!,
    b: ends.B!,
    state,
    sound,
    setListenerIceServers: (next: IceServer[]) => {
      servers = next;
    },
  };
}

/** Listen pressed, connected to A and playing. */
async function playing(env: ReturnType<typeof setup>) {
  await env.a.broadcaster.setTrack('mic-1');
  env.listener.setBroadcast(env.state('A'));
  env.listener.start();
  await settle();
  env.sound();
  expect(env.listener.status).toEqual({ kind: 'playing' });
}

describe('a broadcaster and a listener together', () => {
  it('connects: listen, offer, answer, and the count is one', async () => {
    const env = setup();
    await playing(env);
    expect(env.a.peers).toHaveLength(1);
    expect(env.a.peers[0]!.track).toBe('mic-1');
    expect(env.a.peers[0]!.answers).toEqual(['answer-to-A-offer-0-1']);
    expect(env.receivers[0]!.offers).toEqual(['A-offer-0-1']);
    expect(env.a.broadcaster.count).toBe(1);
    expect(env.streams).toEqual(['stream-1']);
  });

  it('moves to a fresh connection when the input is taken again, as one listener throughout', async () => {
    const env = setup();
    await playing(env);
    await env.a.broadcaster.setTrack('mic-2');
    await settle();
    expect(env.a.broadcaster.sessionIds).toEqual(['s1', 's2']);
    expect(env.a.broadcaster.count).toBe(1);
    env.sound();
    expect(env.streams).toEqual(['stream-1', 'stream-2']);
    expect(env.a.broadcaster.sessionIds).toEqual(['s2']);
    expect(env.a.peers[0]!.closed).toBe(true);
    expect(env.receivers[0]!.closed).toBe(true);
    env.clock.advance(OLD_SESSION_MS * 2);
    expect(env.a.broadcaster.sessionIds).toEqual(['s2']);
    expect(env.listener.status).toEqual({ kind: 'playing' });
    expect(env.listener.sessionId).toBe('s2');
  });

  it('goes on playing on the old connection when the fresh one brings no sound', async () => {
    const env = setup();
    await playing(env);
    await env.a.broadcaster.setTrack('mic-2');
    await settle();
    // The fresh connection is answered but never connects.
    env.clock.advance(FRESH_WAIT_MS);
    expect(env.receivers[1]!.closed).toBe(true);
    expect(env.a.broadcaster.sessionIds).toEqual(['s1']);
    env.clock.advance(OLD_SESSION_MS * 2);
    await settle();
    expect(env.a.broadcaster.sessionIds).toEqual(['s1']);
    expect(env.a.peers[0]!.closed).toBe(false);
    expect(env.receivers[0]!.closed).toBe(false);
    expect(env.listener.sessionId).toBe('s1');
    expect(env.listener.status).toEqual({ kind: 'playing' });
    expect(env.statuses.map((s) => s.kind)).toEqual(['connecting', 'playing']);
    expect(env.streams).toEqual(['stream-1']);
  });

  it('restarts ICE on the same connection with a new list at both ends', async () => {
    const env = setup();
    await playing(env);
    const fresh: IceServer[] = [{ urls: 'turn:t', username: 'later', credential: 'new' }];
    env.a.setIceServers(fresh);
    env.setListenerIceServers(fresh);
    env.receivers[0]!.events.state('disconnected');
    await settle();
    expect(env.a.peers).toHaveLength(1);
    expect(env.receivers).toHaveLength(1);
    expect(env.a.peers[0]!.iceServers).toEqual(fresh);
    expect(env.receivers[0]!.iceServers).toEqual(fresh);
    expect(env.receivers[0]!.offers).toEqual(['A-offer-0-1', 'A-offer-0-2r']);
    expect(env.a.peers[0]!.answers).toEqual(['answer-to-A-offer-0-1', 'answer-to-A-offer-0-2r']);
    env.receivers[0]!.events.state('connected');
    env.clock.advance(RESTART_WAIT_MS);
    expect(env.listener.status).toEqual({ kind: 'playing' });
    expect(env.a.broadcaster.sessionIds).toEqual(['s1']);
  });

  it('is refused as the eleventh, and is let in by the computer that takes over', async () => {
    const env = setup();
    for (let i = 0; i < AUDIO_LISTENER_LIMIT; i++) {
      env.a.broadcaster.signal(`D${i}`, other(i), { kind: 'listen', session: `d${i}` });
    }
    env.listener.setBroadcast(env.state('A'));
    env.listener.start();
    await settle();
    expect(env.listener.status).toEqual({ kind: 'full' });
    expect(env.a.broadcaster.sessionIds).not.toContain('s1');
    env.a.broadcaster.stop();
    env.listener.setBroadcast(env.state('B'));
    await settle();
    env.sound(env.b);
    expect(env.listener.status).toEqual({ kind: 'playing' });
    expect(env.b.broadcaster.count).toBe(1);
  });

  it('closes at both ends when Listen is released', async () => {
    const env = setup();
    await playing(env);
    env.listener.stop();
    expect(env.a.broadcaster.sessionIds).toEqual([]);
    expect(env.a.broadcaster.count).toBe(0);
    expect(env.a.peers[0]!.closed).toBe(true);
    expect(env.receivers[0]!.closed).toBe(true);
  });

  it('asks again, and is told there is no broadcast, when the broadcaster switches off', async () => {
    const env = setup();
    await playing(env);
    env.a.broadcaster.stop();
    expect(env.receivers[0]!.closed).toBe(true);
    expect(env.listener.status).toEqual({ kind: 'reconnecting' });
    // Its state has not reached the listener yet: the next ask is answered with a close.
    env.clock.advance(1000);
    await settle();
    expect(env.receivers).toHaveLength(1);
    expect(env.listener.listening).toBe(true);
    env.listener.setBroadcast(null);
    env.clock.advance(60_000);
    expect(env.listener.status).toEqual({ kind: 'off' });
  });
});
