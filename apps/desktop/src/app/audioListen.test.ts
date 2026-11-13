import type { BrowserAudioOutput, ListenPeerEvents } from '@worship-q/audio';
import type { AudioSignal, AudioState } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { AudioListen, prepareMonitor, type ListenMedia } from './audioListen';
import type { AudioShared } from './audioShare';
import type { AudioDevice } from './deviceSettings';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const speakers: AudioDevice = { id: 'out-1', name: 'Booth speakers' };
const output = (id: string, label: string) =>
  ({ kind: 'audiooutput', deviceId: id, label }) as MediaDeviceInfo;

const state = (patch: Partial<AudioState> = {}): AudioState => ({
  ownerId: 'B',
  ownerName: 'Sound desk',
  activatedAt: '2026-11-13T09:00:00.000Z',
  revision: 1,
  active: true,
  status: 'live',
  inputName: null,
  listeners: 0,
  ...patch,
});

function setup(options: { monitor?: AudioDevice | null; holdUnlock?: boolean } = {}) {
  const log: string[] = [];
  const sent: { to: string; signal: AudioSignal }[] = [];
  const peers: { events: ListenPeerEvents<MediaStream>; closed: boolean }[] = [];
  const unlocks: (() => void)[] = [];
  let monitor = options.monitor === undefined ? speakers : options.monitor;
  let outputs = [output('out-1', 'Booth speakers'), output('out-2', 'Headphones')];
  let view = { state: state(), local: false } as AudioShared;
  let toListener: ((signal: AudioSignal) => void) | null = null;
  const shareSubscribers = new Set<() => void>();
  const deviceListeners = new Set<() => void>();
  const media: ListenMedia = {
    getUserMedia: async () => {
      log.push('unlock-ids');
      if (options.holdUnlock) await new Promise<void>((resolve) => unlocks.push(resolve));
      return { getTracks: () => [{ stop: () => log.push('unlock-stopped') }] } as never;
    },
    enumerateDevices: async () => {
      log.push('devices');
      return outputs;
    },
    addEventListener: ((_type: string, listener: () => void) =>
      deviceListeners.add(listener)) as never,
    removeEventListener: ((_type: string, listener: () => void) =>
      deviceListeners.delete(listener)) as never,
  };
  const element: BrowserAudioOutput = {
    unlock: () => log.push('play-unlocked'),
    play: (stream) => log.push(`play:${stream as unknown as string}`),
    setSink: async (id) => void log.push(`element-sink:${id}`),
    remove: () => log.push('removed'),
  };
  const listen = new AudioListen({
    share: {
      get view() {
        return view;
      },
      subscribe: (listener) => {
        shareSubscribers.add(listener);
        return () => shareSubscribers.delete(listener);
      },
      listenerLink: (onSignal) => {
        toListener = onSignal;
        return {
          send: (to, signal) => {
            log.push(`send:${signal.kind}`);
            sent.push({ to, signal });
          },
          close: () => log.push('link-closed'),
        };
      },
    },
    iceServers: async () => [],
    monitor: () => monitor,
    applySink: async (id) => void log.push(`sink:${id}`),
    media,
    output: element,
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
  });
  return {
    listen,
    log,
    sent,
    peers,
    unlocks,
    deviceListeners,
    signal: (signal: AudioSignal) => toListener?.(signal),
    setMonitor: (next: AudioDevice | null) => {
      monitor = next;
    },
    setOutputs: (next: MediaDeviceInfo[]) => {
      outputs = next;
    },
    setView: (next: Partial<AudioShared>) => {
      view = { ...view, ...next };
      for (const listener of [...shareSubscribers]) listener();
    },
  };
}

/** Pressed, the offer answered, the sound arrived. */
async function playing(env: ReturnType<typeof setup>) {
  env.listen.start();
  await settle();
  const session = env.sent.at(-1)!.signal.session;
  env.signal({ kind: 'offer', session, sdp: 'o' });
  await settle();
  env.peers[0]!.events.stream('stream' as unknown as MediaStream);
  env.peers[0]!.events.state('connected');
}

describe('preparing the Monitor device (§3.8)', () => {
  it('finds the saved device by id, then by name, else uses the system default', async () => {
    const applied: string[] = [];
    const media = (devices: MediaDeviceInfo[]) => ({
      getUserMedia: async () => ({ getTracks: () => [] }) as never,
      enumerateDevices: async () => devices,
    });
    const apply = async (id: string) => void applied.push(id);
    expect(await prepareMonitor(media([output('out-1', 'x')]), speakers, apply)).toBe('out-1');
    expect(await prepareMonitor(media([output('out-9', 'Booth speakers')]), speakers, apply)).toBe(
      'out-9',
    );
    expect(await prepareMonitor(media([output('out-2', 'Headphones')]), speakers, apply)).toBe('');
    expect(await prepareMonitor(media([output('out-1', 'x')]), null, apply)).toBe('');
    expect(applied).toEqual(['out-1', 'out-9', '', '']);
  });

  it('still looks for the device when the microphone is refused or cannot be listed', async () => {
    const applied: string[] = [];
    const apply = async (id: string) => void applied.push(id);
    const refused = {
      getUserMedia: async () => {
        throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
      },
      enumerateDevices: async () => [output('out-1', '')],
    };
    expect(await prepareMonitor(refused, speakers, apply)).toBe('out-1');
    const broken = {
      getUserMedia: async () => ({ getTracks: () => [] }) as never,
      enumerateDevices: async () => {
        throw new Error('no');
      },
    };
    expect(await prepareMonitor(broken, speakers, apply)).toBe('');
    expect(await prepareMonitor(undefined, speakers, apply)).toBe('');
    expect(applied).toEqual(['out-1', '', '']);
  });

  it('goes on when the device cannot be set', async () => {
    const media = {
      getUserMedia: async () => ({ getTracks: () => [] }) as never,
      enumerateDevices: async () => [output('out-1', '')],
    };
    const failing = async () => {
      throw new Error('no');
    };
    expect(await prepareMonitor(media, speakers, failing)).toBe('out-1');
  });
});

describe('Listen on the desktop (M3.2)', () => {
  it('on a press: unlocks playback, unlocks the ids, sets the device, then asks', async () => {
    const env = setup();
    env.listen.start();
    expect(env.listen.state.status).toEqual({ kind: 'connecting' });
    await settle();
    expect(env.log).toEqual([
      'play-unlocked',
      'unlock-ids',
      'unlock-stopped',
      'devices',
      'sink:out-1',
      'send:listen',
    ]);
    expect(env.sent[0]!.to).toBe('B');
  });

  it('obeys Stop pressed while the device is being set: nothing is asked or played', async () => {
    const env = setup({ holdUnlock: true });
    env.listen.start();
    await settle();
    // The system's permission prompt is still up.
    env.listen.stop();
    expect(env.listen.state.status).toEqual({ kind: 'off' });
    env.unlocks[0]!();
    await settle();
    expect(env.sent).toEqual([]);
    expect(env.listen.state.status).toEqual({ kind: 'off' });
  });

  it('prepares once when Listen is pressed twice', async () => {
    const env = setup({ holdUnlock: true });
    env.listen.start();
    env.listen.start();
    await settle();
    expect(env.log.filter((each) => each === 'unlock-ids')).toHaveLength(1);
    env.unlocks[0]!();
    await settle();
    expect(env.sent).toHaveLength(1);
  });

  it('plays what arrives, and stops when released', async () => {
    const env = setup();
    await playing(env);
    expect(env.log.at(-1)).toBe('play:stream');
    expect(env.listen.state.status).toEqual({ kind: 'playing' });
    env.listen.stop();
    expect(env.peers[0]!.closed).toBe(true);
    expect(env.log.at(-1)).toBe('play:null');
    expect(env.listen.state).toEqual({ status: { kind: 'off' }, delay: null });
  });

  it('does not listen to its own broadcast', async () => {
    const env = setup();
    env.setView({ local: true });
    env.listen.start();
    await settle();
    expect(env.sent).toEqual([]);
    // Another computer takes over: now there is something to hear.
    env.setView({ local: false, state: state({ ownerId: 'C' }) });
    expect(env.sent.map((each) => each.to)).toEqual(['C']);
  });

  it('follows the broadcast’s status', async () => {
    const env = setup();
    await playing(env);
    env.setView({ state: state({ status: 'waiting' }) });
    expect(env.listen.state.status).toEqual({ kind: 'waiting' });
  });

  it('moves to a newly chosen Monitor device while listening, and not while off', async () => {
    const env = setup();
    env.setMonitor({ id: 'out-2', name: 'Headphones' });
    await env.listen.monitorChanged();
    expect(env.log).toEqual([]);
    await playing(env);
    env.setMonitor(speakers);
    await env.listen.monitorChanged();
    expect(env.log.at(-1)).toBe('sink:out-1');
    expect(env.listen.state.status).toEqual({ kind: 'playing' });
  });

  it('moves to the system default when the Monitor device is unplugged', async () => {
    const env = setup();
    await playing(env);
    env.setOutputs([output('out-2', 'Headphones')]);
    for (const listener of env.deviceListeners) listener();
    await settle();
    expect(env.log.at(-1)).toBe('sink:');
    // On the system default already: a later change of devices moves nothing.
    env.setMonitor(null);
    await env.listen.monitorChanged();
    const before = env.log.length;
    for (const listener of env.deviceListeners) listener();
    await settle();
    expect(env.log.slice(before)).toEqual([]);
  });

  it('moves the element when the native core calls back, and cleans up when disposed', async () => {
    const env = setup();
    await globalThis.__worshipQMonitor?.('out-2');
    expect(env.log).toEqual(['element-sink:out-2']);
    await playing(env);
    env.listen.dispose();
    expect(env.log.slice(-3)).toEqual(['play:null', 'link-closed', 'removed']);
    expect(globalThis.__worshipQMonitor).toBeUndefined();
    expect(env.deviceListeners.size).toBe(0);
  });
});
