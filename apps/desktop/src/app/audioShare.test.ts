import type { AudioDown, AudioUp } from '@worship-q/live-state';
import type { AudioSignal, AudioState } from '@worship-q/protocol';
import type { BroadcastPeerEvents, CaptureTrack } from '@worship-q/audio';
import { describe, expect, it } from 'vitest';
import { audioSwitchStore, readAudioSwitch, switchOn } from './audioSettings';
import { AudioShare, COUNT_PUBLISH_MS, type AudioTransport } from './audioShare';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

class Track implements CaptureTrack {
  muted = false;
  stopped = false;
  constructor(
    readonly label = 'Scarlett 2i2 USB',
    readonly deviceId = 'sc',
  ) {}
  stop() {
    this.stopped = true;
  }
  on() {}
}

function storage() {
  const disk = new Map<string, string>();
  return {
    disk,
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => void disk.set(k, v),
  };
}

function setup(options: { id?: string; inputs?: boolean; supports?: boolean } = {}) {
  let now = Date.parse('2026-11-13T09:00:00.000Z');
  const timers: { at: number; fn: () => void }[] = [];
  const up: AudioUp[] = [];
  const down: { to: string; message: AudioDown }[] = [];
  const server: AudioSignal[] = [];
  const phones: { grantId: string; signal: AudioSignal }[] = [];
  const peers: { events: BroadcastPeerEvents; closed: boolean }[] = [];
  const awake: boolean[] = [];
  const tracks: Track[] = [];
  const disk = storage();
  const share = new AudioShare({
    deviceId: () => options.id ?? 'A',
    deviceName: () => 'Sound desk',
    chosenInput: () => null,
    media: {
      list: async () => ({
        inputs: options.inputs === false ? [] : [{ id: 'sc', name: 'Scarlett 2i2 USB' }],
        defaultLabel: null,
      }),
      open: async () => {
        const track = new Track();
        tracks.push(track);
        return track;
      },
      visible: () => true,
    },
    createPeer: ({ events }) => {
      const peer = { events, closed: false };
      peers.push(peer);
      return {
        offer: async () => 'v=0 offer',
        answer: async () => undefined,
        addCandidate: async () => undefined,
        setTrack: async () => undefined,
        close: () => {
          peer.closed = true;
        },
      };
    },
    iceServers: async () => [],
    keepAwake: (on) => awake.push(on),
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.push({ at: now + ms, fn });
      return timers.length;
    },
    clearTimeout: () => undefined,
  });
  const transport: AudioTransport = {
    toCoordinator: (message) => up.push(message),
    toFollower: (to, message) => down.push({ to, message }),
    toServer: (signal) => server.push(signal),
    sharing: () => options.supports !== false,
    serverSupports: () => options.supports !== false,
    nameOf: (id) => ({ B: 'Booth', C: 'Laptop' })[id] ?? '',
  };
  share.setPhones({
    changed: () => undefined,
    deliver: (grantId, signal) => phones.push({ grantId, signal }),
  });
  const store = audioSwitchStore(() => disk, 'ws');
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (timer.at <= now) timer.fn();
      else timers.push(timer);
    }
  };
  return { share, transport, store, disk, up, down, server, phones, peers, awake, tracks, advance };
}

const states = (up: AudioUp[]) =>
  up
    .filter((m): m is Extract<AudioUp, { type: 'audioState' }> => m.type === 'audioState')
    .map((m) => m.state);

function remote(ownerId: string, patch: Partial<AudioState> = {}): AudioState {
  return {
    ownerId,
    ownerName: `Computer ${ownerId}`,
    activatedAt: '2026-11-13T09:05:00.000Z',
    revision: 1,
    active: true,
    status: 'live',
    inputName: null,
    listeners: 0,
    ...patch,
  };
}

describe('the switch (M2.1)', () => {
  it('reads a damaged or missing entry as off', () => {
    expect(readAudioSwitch(null)).toEqual({ broadcast: false, activatedAt: null });
    expect(readAudioSwitch({ broadcast: true })).toEqual({ broadcast: false, activatedAt: null });
    expect(readAudioSwitch({ broadcast: true, activatedAt: 'nonsense' }).broadcast).toBe(false);
  });

  it('round-trips, one workspace apart from another', () => {
    const disk = storage();
    audioSwitchStore(() => disk, 'one').set(switchOn(0, null));
    expect(audioSwitchStore(() => disk, 'one').get().broadcast).toBe(true);
    expect(audioSwitchStore(() => disk, 'two').get().broadcast).toBe(false);
  });

  it('stamps a press after the newest activation seen when the clock is behind', () => {
    expect(
      switchOn(Date.parse('2026-11-13T09:00:00.000Z'), '2026-11-13T09:05:00.000Z').activatedAt,
    ).toBe('2026-11-13T09:05:00.001Z');
  });
});

describe('broadcasting and sharing (M2.8)', () => {
  it('captures as soon as the workspace opens with the switch on, before anyone listens', async () => {
    const env = setup();
    env.store.set(switchOn(0, null));
    env.share.start(env.store);
    await settle();
    expect(env.tracks).toHaveLength(1);
    expect(env.share.view).toMatchObject({ local: true, switchOn: true, input: 'live' });
    expect(env.awake).toEqual([true]);
  });

  it('captures with no coordinator reachable, and publishes once one appears', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(0, null));
    env.share.start(env.store);
    await settle();
    expect(env.up).toEqual([]);
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    expect(states(env.up).at(-1)).toMatchObject({ ownerId: 'B', status: 'live', active: true });
  });

  it('as coordinator, sends its state to every device that takes audio', async () => {
    const env = setup();
    env.store.set(switchOn(0, null));
    env.share.start(env.store);
    await settle();
    env.share.attach(env.transport);
    env.share.becomeCoordinator(['A', 'B', 'C']);
    const sent = env.down.filter((d) => d.message.type === 'audioState' && d.message.state);
    expect(sent.map((d) => d.to).sort()).toEqual(['B', 'C']);
  });

  it('publishes again to a new coordinator, keeping its listener count', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(0, null));
    env.share.start(env.store);
    await settle();
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.fromCoordinator({
      type: 'audioSignal',
      from: 'D',
      listener: { kind: 'desktop', deviceId: 'D', name: 'D' },
      signal: { kind: 'listen', session: 's1' },
    });
    await settle();
    env.advance(COUNT_PUBLISH_MS);
    env.share.becomeFollower('E');
    expect(states(env.up).at(-1)).toMatchObject({ listeners: 1 });
  });

  it('says nothing to an old server, keeps capturing, and shows the note', async () => {
    const env = setup({ supports: false });
    env.store.set(switchOn(0, null));
    env.share.start(env.store);
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    await settle();
    expect(env.up).toEqual([]);
    expect(env.share.view).toMatchObject({ input: 'live', sharingBlocked: true });
  });

  it('publishes a status change at once, and the count at most once a second', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(0, null));
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    await settle();
    const listen = (from: string, session: string) =>
      env.share.fromCoordinator({
        type: 'audioSignal',
        from,
        listener: { kind: 'desktop', deviceId: from, name: from },
        signal: { kind: 'listen', session },
      });
    listen('D', 'a');
    listen('E', 'b');
    listen('F', 'c');
    await settle();
    const counts = () => states(env.up).map((s) => s.listeners);
    expect(counts().filter((n) => n > 0)).toEqual([1]);
    env.advance(COUNT_PUBLISH_MS);
    expect(counts().at(-1)).toBe(3);
  });

  it('switches off silently when a later activation from another computer arrives, and stays off', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(Date.parse('2026-11-13T09:00:00.000Z'), null));
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    await settle();
    const before = env.up.length;
    env.share.fromCoordinator({ type: 'audioState', state: remote('A') });
    expect(env.up.length).toBe(before);
    expect(env.share.view).toMatchObject({
      local: false,
      switchOn: false,
      takenOverBy: 'Computer A',
    });
    expect(env.tracks[0]!.stopped).toBe(true);
    expect(env.awake.at(-1)).toBe(false);
    expect(readAudioSwitch(JSON.parse(env.disk.disk.get('wq.audio.ws')!)).broadcast).toBe(false);
  });

  it('takes it back with a press that wins over the activation it saw', async () => {
    const env = setup({ id: 'B' });
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    env.share.fromCoordinator({
      type: 'audioState',
      state: remote('A', { activatedAt: '2026-11-13T10:00:00.000Z' }),
    });
    env.share.setSwitch(true);
    await settle();
    expect(states(env.up).at(-1)!.activatedAt).toBe('2026-11-13T10:00:00.001Z');
  });

  it('sends the state again when the coordinator holds an older activation', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(Date.parse('2026-11-13T09:10:00.000Z'), null));
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    await settle();
    const before = states(env.up).length;
    env.share.fromCoordinator({ type: 'audioState', state: remote('A') });
    expect(states(env.up).length).toBe(before + 1);
    expect(env.share.view.local).toBe(true);
  });

  it('switched off: every connection closes and the workspace is told it is inactive', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(0, null));
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    await settle();
    env.share.fromCoordinator({
      type: 'audioSignal',
      from: 'D',
      listener: { kind: 'desktop', deviceId: 'D', name: 'D' },
      signal: { kind: 'listen', session: 's1' },
    });
    await settle();
    env.share.setSwitch(false);
    expect(env.peers.every((p) => p.closed)).toBe(true);
    expect(states(env.up).at(-1)).toMatchObject({ active: false, listeners: 0 });
    expect(env.share.view.switchOn).toBe(false);
  });

  it('closing the workspace stops capture but keeps the switch on for next time', async () => {
    const env = setup();
    env.store.set(switchOn(0, null));
    env.share.start(env.store);
    await settle();
    env.share.stop();
    expect(env.tracks[0]!.stopped).toBe(true);
    expect(audioSwitchStore(() => env.disk, 'ws').get().broadcast).toBe(true);
  });
});

describe('signals (M2.8, M3.2, M4.1, M5.6)', () => {
  it('answers a listener with an offer through the coordinator', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(0, null));
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    await settle();
    env.share.fromCoordinator({
      type: 'audioSignal',
      from: 'D',
      listener: { kind: 'desktop', deviceId: 'D', name: 'D' },
      signal: { kind: 'listen', session: 's1' },
    });
    await settle();
    expect(env.up.at(-1)).toEqual({
      type: 'audioSignal',
      to: 'D',
      signal: { kind: 'offer', session: 's1', sdp: 'v=0 offer' },
    });
  });

  it('closes a listen when this computer does not broadcast', () => {
    const env = setup({ id: 'B' });
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.fromCoordinator({
      type: 'audioSignal',
      from: 'D',
      listener: { kind: 'desktop', deviceId: 'D', name: 'D' },
      signal: { kind: 'listen', session: 's1' },
    });
    expect(env.up.at(-1)).toEqual({
      type: 'audioSignal',
      to: 'D',
      signal: { kind: 'close', session: 's1', reason: 'not-broadcasting' },
    });
  });

  it('closes every session of a device that left', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(0, null));
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    await settle();
    const listen = (listener: AudioDown & { type: 'audioSignal' }) =>
      env.share.fromCoordinator(listener);
    listen({
      type: 'audioSignal',
      from: 'D',
      listener: { kind: 'desktop', deviceId: 'D', name: '' },
      signal: { kind: 'listen', session: 'a' },
    });
    listen({
      type: 'audioSignal',
      from: 'D',
      listener: { kind: 'phone', grantId: 'g', name: '' },
      signal: { kind: 'listen', session: 'b' },
    });
    await settle();
    listen({
      type: 'audioSignal',
      from: 'D',
      listener: { kind: 'desktop', deviceId: 'D', name: '' },
      signal: { kind: 'close', session: '*', reason: 'gone' },
    });
    expect(env.peers.every((p) => p.closed)).toBe(true);
  });

  it('routes this desktop’s Listen to the broadcaster and the answers back', () => {
    const env = setup({ id: 'D' });
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    const got: AudioSignal[] = [];
    const link = env.share.listenerLink((signal) => got.push(signal));
    link.send('B', { kind: 'listen', session: 's' });
    expect(env.up.at(-1)).toEqual({
      type: 'audioSignal',
      to: 'B',
      signal: { kind: 'listen', session: 's' },
    });
    env.share.fromCoordinator({
      type: 'audioSignal',
      from: 'B',
      listener: { kind: 'desktop', deviceId: 'D', name: '' },
      signal: { kind: 'offer', session: 's', sdp: 'v=0' },
    });
    expect(got).toEqual([{ kind: 'offer', session: 's', sdp: 'v=0' }]);
  });

  it('forwards a phone’s signal in its name, and the broadcaster’s answers to that phone only', () => {
    const env = setup({ id: 'D' });
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.fromCoordinator({ type: 'audioState', state: remote('B') });
    const phone = { grantId: 'g1', name: 'Anna' };
    env.share.fromPhone(phone, { kind: 'listen', session: 'p' });
    expect(env.up.at(-1)).toEqual({
      type: 'audioSignal',
      to: 'B',
      phone,
      signal: { kind: 'listen', session: 'p' },
    });
    env.share.fromCoordinator({
      type: 'audioSignal',
      from: 'B',
      listener: { kind: 'phone', grantId: 'g1', name: 'Anna' },
      signal: { kind: 'offer', session: 'p', sdp: 'v=0' },
    });
    expect(env.phones).toEqual([
      { grantId: 'g1', signal: { kind: 'offer', session: 'p', sdp: 'v=0' } },
    ]);
  });

  it('closes a phone’s sessions at the broadcaster when it is gone', () => {
    const env = setup({ id: 'D' });
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.fromCoordinator({ type: 'audioState', state: remote('B') });
    env.share.fromPhone({ grantId: 'g1', name: 'Anna' }, { kind: 'listen', session: 'p' });
    env.share.phoneGone('g1');
    expect(env.up.at(-1)).toMatchObject({
      type: 'audioSignal',
      to: 'B',
      signal: { kind: 'close', session: 'p', reason: 'gone' },
    });
  });

  it('serves a phone connected to the broadcaster itself', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(0, null));
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    await settle();
    env.share.fromPhone({ grantId: 'g1', name: 'Anna' }, { kind: 'listen', session: 'p' });
    await settle();
    expect(env.phones.at(-1)).toEqual({
      grantId: 'g1',
      signal: { kind: 'offer', session: 'p', sdp: 'v=0 offer' },
    });
  });

  it('answers an administrator through the server, counting them as a listener', async () => {
    const env = setup({ id: 'B' });
    env.store.set(switchOn(0, null));
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.start(env.store);
    await settle();
    env.share.fromAdmin('Pastor', { kind: 'listen', session: 'admin-1' });
    await settle();
    expect(env.server).toEqual([{ kind: 'offer', session: 'admin-1', sdp: 'v=0 offer' }]);
    env.advance(COUNT_PUBLISH_MS);
    expect(states(env.up).at(-1)!.listeners).toBe(1);
  });

  it('shows phones the broadcast without its listener count', async () => {
    const env = setup({ id: 'D' });
    env.share.attach(env.transport);
    env.share.becomeFollower('C');
    env.share.fromCoordinator({ type: 'audioState', state: remote('B', { listeners: 4 }) });
    expect(env.share.remoteView()).toEqual({
      ownerId: 'B',
      ownerName: 'Computer B',
      activatedAt: '2026-11-13T09:05:00.000Z',
      status: 'live',
    });
  });
});
