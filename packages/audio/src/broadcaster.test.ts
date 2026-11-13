import type { AudioListener, AudioSignal, IceServer } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  Broadcaster,
  DEAD_SESSION_MS,
  OLD_SESSION_MS,
  type BroadcastPeer,
  type BroadcastPeerEvents,
} from './broadcaster';
import { FakeClock, settle } from './fakeClock';

interface FakePeer extends BroadcastPeer<string> {
  events: BroadcastPeerEvents;
  track: string | null;
  iceServers: IceServer[];
  answers: string[];
  candidates: string[];
  restarts: number;
  closed: boolean;
}

function setup(options: { iceServers?: IceServer[] } = {}) {
  const clock = new FakeClock();
  const peers: FakePeer[] = [];
  const sent: { route: string; signal: AudioSignal }[] = [];
  const counts: number[] = [];
  const broadcaster = new Broadcaster<string, string>({
    clock,
    iceServers: async () => options.iceServers ?? [],
    send: (route, signal) => sent.push({ route, signal }),
    onCount: (count) => counts.push(count),
    createPeer: ({ track, iceServers, events }) => {
      const peer: FakePeer = {
        events,
        track,
        iceServers,
        answers: [],
        candidates: [],
        restarts: 0,
        closed: false,
        offer: async (restart) => {
          if (restart) peer.restarts++;
          return `offer-${peers.indexOf(peer)}${restart ? '-restart' : ''}`;
        },
        answer: async (sdp) => {
          peer.answers.push(sdp);
        },
        addCandidate: async (candidate) => {
          peer.candidates.push(candidate.candidate);
        },
        setTrack: async (next) => {
          peer.track = next;
        },
        close: () => {
          peer.closed = true;
        },
      };
      peers.push(peer);
      return peer;
    },
  });
  return { clock, peers, sent, counts, broadcaster };
}

const desktop = (id: string): AudioListener => ({ kind: 'desktop', deviceId: id, name: id });
const phone = (id: string): AudioListener => ({ kind: 'phone', grantId: id, name: id });
const admin = (id: string): AudioListener => ({ kind: 'admin', sessionId: id, name: id });
const listen = (session: string): AudioSignal => ({ kind: 'listen', session });
const kinds = (sent: { signal: AudioSignal }[]) => sent.map((each) => each.signal.kind);

describe('broadcaster sessions (M2.6)', () => {
  it('answers a listen with an offer, on a connection carrying the track', async () => {
    const { broadcaster, peers, sent } = setup();
    await broadcaster.setTrack('mic-1');
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    expect(peers).toHaveLength(1);
    expect(peers[0]!.track).toBe('mic-1');
    expect(sent).toEqual([
      { route: 'B', signal: { kind: 'offer', session: 's1', sdp: 'offer-0' } },
    ]);
    expect(broadcaster.count).toBe(1);
  });

  it('accepts a tenth listener and refuses an eleventh with full', async () => {
    const { broadcaster, sent, peers } = setup();
    for (let i = 0; i < 9; i++) broadcaster.signal(`D${i}`, desktop(`D${i}`), listen(`s${i}`));
    broadcaster.signal('D9', desktop('D9'), listen('s9'));
    await settle();
    expect(broadcaster.count).toBe(10);
    broadcaster.signal('D10', desktop('D10'), listen('s10'));
    await settle();
    expect(sent.at(-1)).toEqual({ route: 'D10', signal: { kind: 'full', session: 's10' } });
    expect(peers).toHaveLength(10);
    expect(broadcaster.count).toBe(10);
  });

  it('lets one of the ten connect afresh, counting it once, and closes its old session later', async () => {
    const { broadcaster, peers, clock, sent } = setup();
    for (let i = 0; i < 10; i++) broadcaster.signal(`D${i}`, desktop(`D${i}`), listen(`s${i}`));
    await settle();
    broadcaster.signal('D0', desktop('D0'), listen('s0-fresh'));
    await settle();
    expect(broadcaster.count).toBe(10);
    expect(broadcaster.sessionIds).toContain('s0-fresh');
    expect(broadcaster.sessionIds).toContain('s0');
    clock.advance(OLD_SESSION_MS);
    expect(broadcaster.sessionIds).not.toContain('s0');
    expect(peers[0]!.closed).toBe(true);
    expect(sent.at(-1)).toEqual({
      route: 'D0',
      signal: { kind: 'close', session: 's0', reason: 'replaced' },
    });
  });

  it('ignores the same session asked for twice', async () => {
    const { broadcaster, peers } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    expect(peers).toHaveLength(1);
  });

  it('lets an eleventh in once one of the ten leaves', async () => {
    const { broadcaster, sent } = setup();
    for (let i = 0; i < 10; i++) broadcaster.signal(`D${i}`, desktop(`D${i}`), listen(`s${i}`));
    await settle();
    broadcaster.signal('D3', desktop('D3'), { kind: 'close', session: 's3', reason: 'stopped' });
    broadcaster.signal('D10', desktop('D10'), listen('s10'));
    await settle();
    expect(sent.at(-1)!.signal).toMatchObject({ kind: 'offer', session: 's10' });
  });

  it('counts a desktop, a phone and an administrator as one each, and two phones as two', async () => {
    const { broadcaster } = setup();
    broadcaster.signal('B', desktop('B'), listen('a'));
    broadcaster.signal('B', phone('g1'), listen('b'));
    broadcaster.signal('B', phone('g2'), listen('c'));
    broadcaster.signal('server', admin('x'), listen('d'));
    await settle();
    expect(broadcaster.count).toBe(4);
  });

  it('accepts a listener while its input is missing, sending nothing until it returns', async () => {
    const { broadcaster, peers, sent } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    expect(peers[0]!.track).toBeNull();
    expect(kinds(sent)).toEqual(['offer']);
  });

  it('answers close to a listen once switched off', async () => {
    const { broadcaster, sent } = setup();
    broadcaster.stop();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    expect(sent).toEqual([
      { route: 'B', signal: { kind: 'close', session: 's1', reason: 'not-broadcasting' } },
    ]);
  });

  it('ignores an answer for an unknown session, and a second answer', async () => {
    const { broadcaster, peers } = setup();
    broadcaster.signal('B', desktop('B'), { kind: 'answer', session: 'nope', sdp: 'x' });
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    broadcaster.signal('B', desktop('B'), { kind: 'answer', session: 's1', sdp: 'first' });
    broadcaster.signal('B', desktop('B'), { kind: 'answer', session: 's1', sdp: 'second' });
    await settle();
    expect(peers[0]!.answers).toEqual(['first']);
  });

  it('holds candidates until the answer is set, and drops them for a closed session', async () => {
    const { broadcaster, peers } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    const candidate = (c: string): AudioSignal => ({
      kind: 'candidate',
      session: 's1',
      candidate: { candidate: c },
    });
    broadcaster.signal('B', desktop('B'), candidate('early'));
    expect(peers[0]!.candidates).toEqual([]);
    broadcaster.signal('B', desktop('B'), { kind: 'answer', session: 's1', sdp: 'a' });
    await settle();
    expect(peers[0]!.candidates).toEqual(['early']);
    broadcaster.signal('B', desktop('B'), candidate('late'));
    await settle();
    expect(peers[0]!.candidates).toEqual(['early', 'late']);
    broadcaster.signal('B', desktop('B'), { kind: 'close', session: 's1', reason: 'stopped' });
    broadcaster.signal('B', desktop('B'), candidate('after'));
    await settle();
    expect(peers[0]!.candidates).toEqual(['early', 'late']);
  });

  it('sends its own candidates on to the listener', async () => {
    const { broadcaster, peers, sent } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    peers[0]!.events.candidate({ candidate: 'c1' });
    expect(sent.at(-1)).toEqual({
      route: 'B',
      signal: { kind: 'candidate', session: 's1', candidate: { candidate: 'c1' } },
    });
  });

  it('closes the sessions of a listener that is gone, and the count falls', async () => {
    const { broadcaster, peers } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    broadcaster.signal('B', phone('g1'), listen('s2'));
    broadcaster.signal('C', desktop('C'), listen('s3'));
    await settle();
    broadcaster.listenerGone((_listener, route) => route === 'B');
    expect(peers.map((peer) => peer.closed)).toEqual([true, true, false]);
    expect(broadcaster.count).toBe(1);
  });

  it('closes a connection failed or disconnected for 30 s with no word', async () => {
    const { broadcaster, peers, clock, sent } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    peers[0]!.events.state('disconnected');
    clock.advance(DEAD_SESSION_MS - 1);
    expect(broadcaster.count).toBe(1);
    peers[0]!.events.state('connected');
    clock.advance(DEAD_SESSION_MS);
    expect(broadcaster.count).toBe(1);
    peers[0]!.events.state('failed');
    clock.advance(DEAD_SESSION_MS);
    expect(broadcaster.count).toBe(0);
    expect(sent.at(-1)!.signal).toEqual({ kind: 'close', session: 's1', reason: 'timeout' });
  });

  it('tells every listener and closes every connection when switched off', async () => {
    const { broadcaster, peers, sent } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    broadcaster.signal('C', desktop('C'), listen('s2'));
    await settle();
    sent.length = 0;
    broadcaster.stop();
    expect(sent.map((each) => each.signal)).toEqual([
      { kind: 'close', session: 's1', reason: 'stopped' },
      { kind: 'close', session: 's2', reason: 'stopped' },
    ]);
    expect(peers.every((peer) => peer.closed)).toBe(true);
    expect(broadcaster.count).toBe(0);
  });

  it('publishes the number of listeners, never above ten', async () => {
    const { broadcaster, counts } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    broadcaster.signal('B', desktop('B'), listen('s1b'));
    broadcaster.signal('C', desktop('C'), listen('s2'));
    await settle();
    expect(counts).toEqual([1, 2]);
  });
});

describe('a new capture track (M2.7, A17)', () => {
  it('is put on every open connection, and each listener is told once', async () => {
    const { broadcaster, peers, sent } = setup();
    await broadcaster.setTrack('mic-1');
    broadcaster.signal('B', desktop('B'), listen('s1'));
    broadcaster.signal('B', desktop('B'), listen('s1b'));
    broadcaster.signal('C', phone('g'), listen('s2'));
    await settle();
    sent.length = 0;
    await broadcaster.setTrack(null);
    expect(peers.every((peer) => peer.track === null)).toBe(true);
    expect(sent).toEqual([]);
    await broadcaster.setTrack('mic-2');
    expect(peers.every((peer) => peer.track === 'mic-2')).toBe(true);
    expect(sent).toEqual([
      { route: 'B', signal: { kind: 'retaken', session: 's1b' } },
      { route: 'C', signal: { kind: 'retaken', session: 's2' } },
    ]);
  });

  it('does nothing when the same track is set again', async () => {
    const { broadcaster, sent } = setup();
    await broadcaster.setTrack('mic');
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    sent.length = 0;
    await broadcaster.setTrack('mic');
    expect(sent).toEqual([]);
  });
});

describe('ICE servers (M4.3, M5.2)', () => {
  const servers: IceServer[] = [{ urls: 'stun:stun.example.org:3478' }];

  it('fetches the list for each new connection and carries it in a phone’s offer', async () => {
    const { broadcaster, peers, sent } = setup({ iceServers: servers });
    broadcaster.signal('B', phone('g'), listen('s1'));
    broadcaster.signal('B', desktop('B'), listen('s2'));
    await settle();
    expect(peers[0]!.iceServers).toEqual(servers);
    expect(sent[0]!.signal).toMatchObject({ kind: 'offer', iceServers: servers });
    expect(sent[1]!.signal).not.toHaveProperty('iceServers');
  });

  it('restarts ICE when the listener asks again on its session', async () => {
    const { broadcaster, peers, sent } = setup();
    broadcaster.signal('B', desktop('B'), listen('s1'));
    await settle();
    broadcaster.signal('B', desktop('B'), { kind: 'listen', session: 's1', restart: true });
    await settle();
    expect(peers).toHaveLength(1);
    expect(peers[0]!.restarts).toBe(1);
    expect(sent.at(-1)!.signal).toMatchObject({ kind: 'offer', sdp: 'offer-0-restart' });
  });
});
