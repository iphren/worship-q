import { describe, expect, it } from 'vitest';
import { FakeClock, settle } from './fakeClock';
import {
  InputWatcher,
  LIST_EVERY_MS,
  MUTE_GRACE_MS,
  REQUEST_RETRY_MS,
  REQUEST_WAIT_MS,
  type CaptureTrack,
  type InputDevice,
} from './input';

class FakeTrack implements CaptureTrack {
  muted = false;
  stopped = false;
  private readonly listeners: Record<string, (() => void)[]> = {};
  constructor(
    readonly label: string,
    readonly deviceId: string,
  ) {}
  stop() {
    this.stopped = true;
  }
  on(event: string, listener: () => void) {
    (this.listeners[event] ??= []).push(listener);
  }
  fire(event: 'ended' | 'mute' | 'unmute') {
    if (event === 'mute') this.muted = true;
    if (event === 'unmute') this.muted = false;
    for (const listener of this.listeners[event] ?? []) listener();
  }
}

interface Request {
  deviceId: string | null;
  resolve(track: FakeTrack): void;
  reject(name: string): void;
}

function setup() {
  const clock = new FakeClock();
  let inputs: InputDevice[] = [];
  let defaultLabel: string | null = null;
  let visible = true;
  const requests: Request[] = [];
  const tracks: (FakeTrack | null)[] = [];
  const moved: InputDevice[] = [];
  const watcher = new InputWatcher<FakeTrack>({
    clock,
    port: {
      list: async () => ({ inputs, defaultLabel }),
      open: (deviceId) =>
        new Promise<FakeTrack>((resolve, reject) => {
          requests.push({
            deviceId,
            resolve,
            reject: (name) => reject(Object.assign(new Error(name), { name })),
          });
        }),
      visible: () => visible,
    },
    onTrack: (track) => tracks.push(track),
    onDeviceMoved: (device) => moved.push(device),
  });
  return {
    clock,
    watcher,
    requests,
    tracks,
    moved,
    setInputs: (next: InputDevice[], label: string | null = null) => {
      inputs = next;
      defaultLabel = label;
    },
    setVisible: (next: boolean) => {
      visible = next;
    },
  };
}

const scarlett = { id: 'sc-1', name: 'Scarlett 2i2 USB' };
const builtIn = { id: 'mb-1', name: 'MacBook Pro Microphone' };

describe('starting (§3.5)', () => {
  it('asks once for the chosen device when it is there, then is live', async () => {
    const env = setup();
    env.setInputs([builtIn, scarlett]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    expect(env.requests.map((r) => r.deviceId)).toEqual(['sc-1']);
    env.requests[0]!.resolve(new FakeTrack('Scarlett 2i2 USB', 'sc-1'));
    await settle();
    expect(env.watcher.status).toBe('live');
    expect(env.watcher.inputName).toBe('Scarlett 2i2 USB');
    expect(env.tracks).toHaveLength(1);
  });

  it('waits, naming the device, and asks nothing while it is not there', async () => {
    const env = setup();
    env.setInputs([builtIn]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    expect(env.watcher.status).toBe('waiting');
    expect(env.watcher.inputName).toBe('Scarlett 2i2 USB');
    expect(env.requests).toEqual([]);
  });

  it('takes the device within one listing of it appearing, with no press', async () => {
    const env = setup();
    env.setInputs([builtIn]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    env.setInputs([builtIn, scarlett]);
    env.clock.advance(LIST_EVERY_MS);
    await settle();
    expect(env.requests.map((r) => r.deviceId)).toEqual(['sc-1']);
  });

  it('ignores a devicechange listing without the device, and takes it on the next (W5)', async () => {
    const env = setup();
    env.setInputs([builtIn]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    env.watcher.devicesChanged();
    await settle();
    expect(env.requests).toEqual([]);
    env.setInputs([builtIn, scarlett]);
    env.watcher.devicesChanged();
    await settle();
    expect(env.requests.map((r) => r.deviceId)).toEqual(['sc-1']);
  });

  it('takes the device by name when its id changed, and saves the new id', async () => {
    const env = setup();
    env.setInputs([{ id: 'sc-2', name: 'Scarlett 2i2 USB' }]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    expect(env.requests[0]!.deviceId).toBe('sc-2');
    env.requests[0]!.resolve(new FakeTrack('Scarlett 2i2 USB', 'sc-2'));
    await settle();
    expect(env.moved).toEqual([{ id: 'sc-2', name: 'Scarlett 2i2 USB' }]);
  });

  it('with two of the same name, takes the saved id, else the first, every time', async () => {
    const env = setup();
    const twin = { id: 'sc-9', name: 'Scarlett 2i2 USB' };
    env.setInputs([twin, scarlett]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    expect(env.requests[0]!.deviceId).toBe('sc-1');
    const other = setup();
    other.setInputs([twin, { id: 'sc-8', name: 'Scarlett 2i2 USB' }]);
    other.watcher.setEnabled(true, scarlett);
    await settle();
    expect(other.requests[0]!.deviceId).toBe('sc-9');
  });

  it('follows the system default, and asks again when the default changes', async () => {
    const env = setup();
    env.setInputs([builtIn, scarlett], 'Default - MacBook Pro Microphone');
    env.watcher.setEnabled(true, null);
    await settle();
    expect(env.requests[0]!.deviceId).toBeNull();
    env.requests[0]!.resolve(new FakeTrack('MacBook Pro Microphone', 'mb-1'));
    await settle();
    env.watcher.devicesChanged();
    await settle();
    expect(env.requests).toHaveLength(1);
    env.setInputs([builtIn, scarlett], 'Default - Scarlett 2i2 USB');
    env.watcher.devicesChanged();
    await settle();
    expect(env.requests.map((r) => r.deviceId)).toEqual([null, null]);
  });

  it('is refused, and asks again only when the switch is pressed or an input picked', async () => {
    const env = setup();
    env.setInputs([scarlett]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    env.requests[0]!.reject('NotAllowedError');
    await settle();
    expect(env.watcher.status).toBe('refused');
    env.clock.advance(60_000);
    env.watcher.devicesChanged();
    await settle();
    expect(env.requests).toHaveLength(1);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    expect(env.requests).toHaveLength(2);
    env.watcher.choose(scarlett);
    await settle();
    expect(env.requests).toHaveLength(3);
  });

  it('says the window must be seen when a request waits 5 s while hidden (A19)', async () => {
    const env = setup();
    env.setInputs([scarlett]);
    env.setVisible(false);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    env.clock.advance(REQUEST_WAIT_MS);
    expect(env.watcher.status).toBe('hidden');
    env.clock.advance(60_000);
    await settle();
    expect(env.requests).toHaveLength(1);
    // Seen: the pending request resolves.
    env.setVisible(true);
    env.watcher.visibilityChanged();
    env.requests[0]!.resolve(new FakeTrack('Scarlett 2i2 USB', 'sc-1'));
    await settle();
    expect(env.watcher.status).toBe('live');
  });

  it('asks again on being seen when the pending request does not resolve', async () => {
    const env = setup();
    env.setInputs([scarlett]);
    env.setVisible(false);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    env.clock.advance(REQUEST_WAIT_MS);
    env.setVisible(true);
    env.watcher.visibilityChanged();
    env.clock.advance(1000);
    await settle();
    expect(env.requests).toHaveLength(2);
  });

  it('asks again after 5 s, then every 15 s, when a request is not answered while visible', async () => {
    const env = setup();
    env.setInputs([scarlett]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    env.clock.advance(REQUEST_WAIT_MS);
    expect(env.watcher.status).toBe('waiting');
    env.clock.advance(REQUEST_WAIT_MS);
    await settle();
    expect(env.requests).toHaveLength(2);
    env.clock.advance(REQUEST_WAIT_MS + REQUEST_RETRY_MS - 1);
    await settle();
    expect(env.requests).toHaveLength(2);
    env.clock.advance(1);
    await settle();
    expect(env.requests).toHaveLength(3);
  });

  it('waits once more, with no error, when the device vanished between listing and opening', async () => {
    const env = setup();
    env.setInputs([scarlett]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    env.requests[0]!.reject('NotFoundError');
    await settle();
    expect(env.watcher.status).toBe('waiting');
    env.clock.advance(LIST_EVERY_MS);
    await settle();
    expect(env.requests).toHaveLength(2);
  });
});

async function liveOn(env: ReturnType<typeof setup>, device = scarlett) {
  env.setInputs([builtIn, scarlett]);
  env.watcher.setEnabled(true, device);
  await settle();
  const track = new FakeTrack(device.name, device.id);
  env.requests.at(-1)!.resolve(track);
  await settle();
  return track;
}

describe('while live (§3.5)', () => {
  it('waits at once when the track ends, and takes the device again when it returns', async () => {
    const env = setup();
    const track = await liveOn(env);
    env.setInputs([builtIn]);
    track.fire('ended');
    await settle();
    expect(env.watcher.status).toBe('waiting');
    expect(env.tracks.at(-1)).toBeNull();
    env.setInputs([builtIn, scarlett]);
    env.watcher.devicesChanged();
    await settle();
    const back = new FakeTrack('Scarlett 2i2 USB', 'sc-1');
    env.requests.at(-1)!.resolve(back);
    await settle();
    expect(env.watcher.status).toBe('live');
    expect(env.tracks.at(-1)).toBe(back);
  });

  it('asks again when the track is muted, ignoring a mute undone within 500 ms', async () => {
    const env = setup();
    const track = await liveOn(env);
    track.fire('mute');
    env.clock.advance(MUTE_GRACE_MS - 100);
    track.fire('unmute');
    env.clock.advance(1000);
    await settle();
    expect(env.requests).toHaveLength(1);
    track.fire('mute');
    env.clock.advance(MUTE_GRACE_MS);
    await settle();
    expect(env.requests).toHaveLength(2);
    const next = new FakeTrack('Scarlett 2i2 USB', 'sc-1');
    env.requests[1]!.resolve(next);
    await settle();
    expect(env.tracks.at(-1)).toBe(next);
    expect(track.stopped).toBe(true);
  });

  it('makes one request when muted and unplugged at once', async () => {
    const env = setup();
    const track = await liveOn(env);
    track.fire('mute');
    track.fire('ended');
    env.clock.advance(MUTE_GRACE_MS);
    await settle();
    expect(env.requests).toHaveLength(2);
  });

  it('puts a newly picked input in place before stopping the old one', async () => {
    const env = setup();
    const old = await liveOn(env);
    env.watcher.choose(builtIn);
    await settle();
    expect(old.stopped).toBe(false);
    const next = new FakeTrack('MacBook Pro Microphone', 'mb-1');
    env.requests.at(-1)!.resolve(next);
    await settle();
    expect(env.tracks.at(-1)).toBe(next);
    expect(old.stopped).toBe(true);
  });

  it('keeps the old input and says so when the pick cannot be opened', async () => {
    const env = setup();
    const old = await liveOn(env);
    env.watcher.choose(builtIn);
    await settle();
    env.requests.at(-1)!.reject('NotReadableError');
    await settle();
    expect(old.stopped).toBe(false);
    expect(env.watcher.pickFailed).toBe(true);
    expect(env.watcher.status).toBe('live');
  });

  it('stops the old track and waits when the pick is not connected', async () => {
    const env = setup();
    const old = await liveOn(env);
    env.watcher.choose({ id: 'x', name: 'Behringer UMC22' });
    await settle();
    expect(old.stopped).toBe(true);
    expect(env.watcher.status).toBe('waiting');
    expect(env.watcher.inputName).toBe('Behringer UMC22');
  });

  it('stops a track that arrives after the switch went off, sending nothing', async () => {
    const env = setup();
    env.setInputs([scarlett]);
    env.watcher.setEnabled(true, scarlett);
    await settle();
    env.watcher.setEnabled(false, scarlett);
    const late = new FakeTrack('Scarlett 2i2 USB', 'sc-1');
    env.requests[0]!.resolve(late);
    await settle();
    expect(late.stopped).toBe(true);
    expect(env.tracks).toEqual([]);
    expect(env.watcher.status).toBe('off');
  });

  it('stops the track when the switch goes off', async () => {
    const env = setup();
    const track = await liveOn(env);
    env.watcher.setEnabled(false, scarlett);
    expect(track.stopped).toBe(true);
    expect(env.tracks.at(-1)).toBeNull();
    expect(env.watcher.status).toBe('off');
  });

  it('goes on capturing when the window is hidden, asking nothing', async () => {
    const env = setup();
    await liveOn(env);
    env.setVisible(false);
    env.watcher.visibilityChanged();
    env.clock.advance(60_000);
    await settle();
    expect(env.requests).toHaveLength(1);
    expect(env.watcher.status).toBe('live');
  });

  it('handles ten returns in a minute, one request open at a time', async () => {
    const env = setup();
    let track = await liveOn(env);
    for (let i = 0; i < 10; i++) {
      track.fire('ended');
      await settle();
      const open = env.requests.length;
      env.watcher.devicesChanged();
      await settle();
      expect(env.requests.length).toBe(open);
      track = new FakeTrack('Scarlett 2i2 USB', 'sc-1');
      env.requests.at(-1)!.resolve(track);
      await settle();
      expect(env.watcher.status).toBe('live');
      env.clock.advance(6000);
    }
    expect(env.requests).toHaveLength(11);
  });
});
