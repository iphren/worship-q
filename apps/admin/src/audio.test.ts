import type { ListenPeerEvents } from '@worship-q/audio';
import type { AudioSignal, IceServer } from '@worship-q/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { AdminListen, POLL_CONNECTING_MS, POLL_PLAYING_MS } from './audio';

/** A signal as it is posted and queued: without its session, which the server names. */
type Body = AudioSignal extends infer S ? (S extends unknown ? Omit<S, 'session'> : never) : never;

interface Post {
  session: string | null;
  signal: { kind: string };
  listener: string | undefined;
}

function setup() {
  const posts: Post[] = [];
  const polls: { session: string; after: number }[] = [];
  const queues = new Map<string, { seq: number; signal: AudioSignal }[]>();
  const forgotten = new Set<string>();
  const heldPolls: (() => void)[] = [];
  const heldListens: (() => void)[] = [];
  const peers: {
    events: ListenPeerEvents<MediaStream>;
    iceServers: IceServer[];
    offers: string[];
    closed: boolean;
  }[] = [];
  const played: (string | null)[] = [];
  const control = { holdPolls: false, holdListens: false, failListens: false };
  let made = 0;
  let inFlight = 0;
  let mostInFlight = 0;
  const iceServers: IceServer[] = [{ urls: 'stun:stun.example.org:3478' }];
  const listen = new AdminListen('ws', {
    pageId: 'page-1',
    api: {
      audioSignal: async (_id, session, signal, listener) => {
        posts.push({ session, signal, listener });
        if (session) return { session };
        if (control.holdListens) await new Promise<void>((resolve) => heldListens.push(resolve));
        if (control.failListens) throw new ApiError(409, 'unreachable');
        const id = `srv-${++made}`;
        queues.set(id, []);
        return { session: id };
      },
      audioSignals: async (_id, session, after) => {
        polls.push({ session, after });
        mostInFlight = Math.max(mostInFlight, ++inFlight);
        if (control.holdPolls) await new Promise<void>((resolve) => heldPolls.push(resolve));
        inFlight--;
        if (forgotten.has(session)) throw new ApiError(404, 'no-session');
        const first = !polls.slice(0, -1).some((poll) => poll.session === session);
        return {
          signals: (queues.get(session) ?? []).filter((each) => each.seq > after),
          ...(first ? { iceServers } : {}),
        };
      },
    },
    output: {
      unlock: () => undefined,
      play: (stream) => played.push(stream as unknown as string | null),
    },
    createPeer: ({ events, iceServers: servers }) => {
      const peer = { events, iceServers: servers, offers: [] as string[], closed: false };
      peers.push(peer);
      return {
        answer: async (offer, tune) => {
          peer.offers.push(offer);
          return tune(`answer-to-${offer}`);
        },
        addCandidate: async () => undefined,
        close: () => {
          peer.closed = true;
        },
      };
    },
  });
  /** The broadcaster's answer, as the server queues it for a session. */
  const answer = (session: string, signal: Body) => {
    const queue = queues.get(session)!;
    queue.push({ seq: queue.length + 1, signal: { ...signal, session } as AudioSignal });
  };
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const kinds = () => posts.map((post) => post.signal.kind);
  return {
    listen,
    posts,
    polls,
    peers,
    played,
    control,
    heldPolls,
    heldListens,
    forgotten,
    answer,
    tick,
    kinds,
    mostInFlight: () => mostInFlight,
  };
}

const live = { ownerName: 'Sound desk', status: 'live' as const, connected: true };

/** Listen pressed, the first session offered and answered, its sound arrived. */
async function playing(env: ReturnType<typeof setup>) {
  env.listen.follow(live);
  env.listen.start();
  await env.tick(0);
  env.answer('srv-1', { kind: 'offer', sdp: 'o' });
  await env.tick(POLL_CONNECTING_MS);
  env.peers[0]!.events.stream('stream-1' as unknown as MediaStream);
  env.peers[0]!.events.state('connected');
  expect(env.listen.state.status).toEqual({ kind: 'playing' });
}

describe('Listen in the admin app (M5.8)', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('starts a session on the server, naming its page, and answers under the server’s id', async () => {
    const env = setup();
    env.listen.follow(live);
    env.listen.start();
    await env.tick(0);
    expect(env.posts).toEqual([{ session: null, signal: { kind: 'listen' }, listener: 'page-1' }]);
    env.answer('srv-1', { kind: 'offer', sdp: 'o' });
    await env.tick(POLL_CONNECTING_MS);
    // The offer reached the listener under its own id; the answer goes back under the server's.
    expect(env.peers[0]!.offers).toEqual(['o']);
    expect(env.posts.at(-1)).toEqual({
      session: 'srv-1',
      signal: { kind: 'answer', sdp: 'answer-to-o' },
      listener: undefined,
    });
  });

  it('makes its connection with the ICE list the first poll brings', async () => {
    const env = setup();
    await playing(env);
    expect(env.peers[0]!.iceServers).toEqual([{ urls: 'stun:stun.example.org:3478' }]);
  });

  it('does nothing when the broadcaster is not connected to the server', async () => {
    const env = setup();
    env.listen.follow({ ...live, connected: false });
    env.listen.start();
    await env.tick(POLL_PLAYING_MS);
    expect(env.posts).toEqual([]);
  });

  it('polls every half second while connecting, and every five once playing', async () => {
    const env = setup();
    env.listen.follow(live);
    env.listen.start();
    await env.tick(0);
    const before = env.polls.length;
    await env.tick(POLL_CONNECTING_MS * 4);
    expect(env.polls.length - before).toBe(4);
    env.answer('srv-1', { kind: 'offer', sdp: 'o' });
    await env.tick(POLL_CONNECTING_MS);
    env.peers[0]!.events.stream('s' as unknown as MediaStream);
    env.peers[0]!.events.state('connected');
    await env.tick(POLL_CONNECTING_MS);
    const settled = env.polls.length;
    await env.tick(POLL_PLAYING_MS - 1);
    expect(env.polls.length).toBe(settled);
    await env.tick(1);
    expect(env.polls.length).toBe(settled + 1);
  });

  it('asks only for the answers after the last one it had', async () => {
    const env = setup();
    await playing(env);
    env.answer('srv-1', { kind: 'candidate', candidate: { candidate: 'c' } });
    await env.tick(POLL_PLAYING_MS);
    await env.tick(POLL_PLAYING_MS);
    expect(env.polls.slice(-2).map((poll) => poll.after)).toEqual([1, 2]);
  });

  it('never polls twice at once, so an offer is answered once', async () => {
    const env = setup();
    await playing(env);
    // A fresh connection is asked for while a poll is on its way.
    env.control.holdPolls = true;
    await env.tick(POLL_PLAYING_MS);
    expect(env.heldPolls).toHaveLength(1);
    env.listen['player'].refresh();
    await env.tick(0);
    await env.tick(POLL_CONNECTING_MS * 3);
    expect(env.heldPolls).toHaveLength(1);
    expect(env.mostInFlight()).toBe(1);
    // It is answered; the next poll follows at once and brings the fresh session's offer.
    env.answer('srv-2', { kind: 'offer', sdp: 'fresh' });
    env.control.holdPolls = false;
    env.heldPolls.splice(0).forEach((resolve) => resolve());
    await env.tick(0);
    await env.tick(0);
    expect(env.peers).toHaveLength(2);
    expect(env.peers[1]!.offers).toEqual(['fresh']);
    expect(env.kinds().filter((kind) => kind === 'answer')).toHaveLength(2);
    expect(env.mostInFlight()).toBe(1);
  });

  it('sends its page’s id with every session it starts, so they count as one (A20)', async () => {
    const env = setup();
    await playing(env);
    env.listen['player'].refresh();
    await env.tick(0);
    const listens = env.posts.filter((post) => post.signal.kind === 'listen');
    expect(listens.map((post) => post.listener)).toEqual(['page-1', 'page-1']);
  });

  it('holds what it has to say until the server has named the session, then says it in order', async () => {
    const env = setup();
    env.control.holdListens = true;
    env.listen.follow(live);
    env.listen.start();
    await env.tick(0);
    // Released before the server answered.
    env.listen.stop();
    await env.tick(0);
    expect(env.kinds()).toEqual(['listen']);
    env.heldListens[0]!();
    await env.tick(0);
    expect(env.posts.at(-1)).toEqual({
      session: 'srv-1',
      signal: { kind: 'close', reason: 'stopped' },
      listener: undefined,
    });
    // Nothing is polled once released.
    const polls = env.polls.length;
    await env.tick(POLL_PLAYING_MS * 2);
    expect(env.polls.length).toBe(polls);
  });

  it('asks again after a wait when the server cannot start a session', async () => {
    const env = setup();
    env.control.failListens = true;
    env.listen.follow(live);
    env.listen.start();
    await env.tick(0);
    expect(env.kinds()).toEqual(['listen']);
    expect(env.listen.state.status).toEqual({ kind: 'connecting' });
    env.control.failListens = false;
    await env.tick(1000);
    expect(env.kinds()).toEqual(['listen', 'listen']);
  });

  it('asks again when the server has forgotten the session', async () => {
    const env = setup();
    await playing(env);
    env.forgotten.add('srv-1');
    await env.tick(POLL_PLAYING_MS);
    expect(env.peers[0]!.closed).toBe(true);
    expect(env.listen.state.status).toEqual({ kind: 'reconnecting' });
    await env.tick(1000);
    expect(env.posts.at(-1)).toMatchObject({ session: null, signal: { kind: 'listen' } });
    // Nothing more is asked about the forgotten one.
    const before = env.polls.length;
    await env.tick(POLL_CONNECTING_MS);
    expect(env.polls.slice(before).every((poll) => poll.session === 'srv-2')).toBe(true);
  });

  it('closes its session and stops polling when released or when the page goes', async () => {
    const env = setup();
    await playing(env);
    env.listen.stop();
    await env.tick(0);
    expect(env.posts.at(-1)).toMatchObject({ session: 'srv-1', signal: { kind: 'close' } });
    expect(env.listen.state).toEqual({ status: { kind: 'off' }, delay: null });
    expect(env.played.at(-1)).toBeNull();
    const polls = env.polls.length;
    await env.tick(POLL_PLAYING_MS * 3);
    expect(env.polls.length).toBe(polls);
    env.listen.start();
    env.listen.dispose();
    await env.tick(POLL_PLAYING_MS);
    expect(env.listen.state.status).toEqual({ kind: 'off' });
  });
});
