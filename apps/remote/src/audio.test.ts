import type { ListenPeerEvents } from '@worship-q/audio';
import type { AudioSignal, RemoteAudioView } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { PhoneListen, phoneDelayText, phoneListenText } from './audio';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const audio: RemoteAudioView = {
  ownerId: 'B',
  ownerName: 'Sound desk',
  activatedAt: '2026-11-13T09:00:00.000Z',
  status: 'live',
};

function setup() {
  const sent: AudioSignal[] = [];
  const log: string[] = [];
  const peers: { events: ListenPeerEvents<MediaStream>; closed: boolean }[] = [];
  let toPhone: (signal: AudioSignal) => void = () => undefined;
  let rejoin: () => void = () => undefined;
  let visible: () => void = () => undefined;
  const listen = new PhoneListen(
    {
      sendAudio: (signal) => sent.push(signal),
      onAudioSignal: (listener) => {
        toPhone = listener;
        return () => undefined;
      },
      onRejoin: (listener) => {
        rejoin = listener;
        return () => undefined;
      },
    },
    {
      output: {
        unlock: () => log.push('unlock'),
        play: (stream) => log.push(`play:${stream as unknown as string}`),
      },
      onVisible: (listener) => {
        visible = listener;
      },
      createPeer: ({ events }) => {
        const peer = { events, closed: false };
        peers.push(peer);
        return {
          answer: async (offer, tune) => tune(`answer-to-${offer}`),
          addCandidate: async () => undefined,
          close: () => {
            peer.closed = true;
          },
        };
      },
    },
  );
  const listens = () => sent.filter((signal) => signal.kind === 'listen');
  /** The newest session is offered, answered, and its sound arrives. */
  const connect = async () => {
    toPhone({ kind: 'offer', session: listens().at(-1)!.session, sdp: 'o' });
    await settle();
    peers.at(-1)!.events.stream(`stream-${peers.length}` as unknown as MediaStream);
    peers.at(-1)!.events.state('connected');
  };
  return {
    listen,
    sent,
    log,
    peers,
    listens,
    connect,
    rejoin: () => rejoin(),
    visible: () => visible(),
  };
}

describe('Listen on the phone (M4.4)', () => {
  it('unlocks playback inside the tap, asks through its desktop, and plays', async () => {
    const env = setup();
    env.listen.follow(audio);
    env.listen.start();
    expect(env.log).toEqual(['unlock']);
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]).toMatchObject({ kind: 'listen' });
    await env.connect();
    expect(env.log.at(-1)).toBe('play:stream-1');
    expect(env.listen.state.status).toEqual({ kind: 'playing' });
    expect(env.sent.at(-1)).toMatchObject({ kind: 'answer', sdp: 'answer-to-o' });
  });

  it('asks nothing until tapped, and nothing when no desktop broadcasts', () => {
    const env = setup();
    env.listen.follow(audio);
    env.rejoin();
    env.visible();
    expect(env.sent).toEqual([]);
    env.listen.follow(null);
    env.listen.start();
    expect(env.sent).toEqual([]);
    expect(env.listen.state.status).toEqual({ kind: 'connecting' });
  });

  it('asks again when let in by a desktop after losing its own, and plays on meanwhile (§3.9)', async () => {
    const env = setup();
    env.listen.follow(audio);
    env.listen.start();
    await env.connect();
    // The desktop it used went away; another one let it in with its grant.
    env.rejoin();
    expect(env.listens()).toHaveLength(2);
    expect(env.peers[0]!.closed).toBe(false);
    expect(env.listen.state.status).toEqual({ kind: 'playing' });
    await env.connect();
    // The new connection has the sound: the one set up through the old desktop is closed.
    expect(env.log.at(-1)).toBe('play:stream-2');
    expect(env.peers[0]!.closed).toBe(true);
    expect(env.sent.at(-1)).toEqual({
      kind: 'close',
      session: env.listens()[0]!.session,
      reason: 'replaced',
    });
  });

  it('connects afresh when the page comes back into view (A24)', async () => {
    const env = setup();
    env.listen.follow(audio);
    env.listen.start();
    env.visible();
    expect(env.listens()).toHaveLength(1);
    await env.connect();
    env.visible();
    expect(env.listens()).toHaveLength(2);
  });

  it('stops, and shows off, when released or when the broadcast is gone a minute', async () => {
    const env = setup();
    env.listen.follow(audio);
    env.listen.start();
    await env.connect();
    env.listen.stop();
    expect(env.listen.state).toEqual({ status: { kind: 'off' }, delay: null });
    expect(env.peers[0]!.closed).toBe(true);
    expect(env.log.at(-1)).toBe('play:null');
  });
});

describe('what the phone says', () => {
  it('puts every status in words', () => {
    expect(phoneListenText({ kind: 'off' })).toBe('Not listening');
    expect(phoneListenText({ kind: 'full' })).toContain('ten');
    expect(phoneListenText({ kind: 'unreachable', relay: true })).toContain('relay was tried');
    expect(phoneListenText({ kind: 'unreachable', relay: false })).toContain('offers no relay');
  });

  it('shows the delay with its path, a dash while unknown, nothing with no figure', () => {
    expect(phoneDelayText(null)).toBeNull();
    expect(phoneDelayText({ delayMs: 120, bufferMs: 100, stale: false, path: 'relayed' })).toBe(
      'Network and buffer: 120 ms · Relayed',
    );
    expect(phoneDelayText({ delayMs: null, bufferMs: null, stale: false, path: null })).toBe(
      'Network and buffer: –',
    );
  });
});
