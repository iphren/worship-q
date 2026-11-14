/** Recording on the desktop: the session and its queue (service records M3.1, M3.2; §5.2). */
import { describe, expect, it } from 'vitest';
import type { CaptureTrack } from './input';
import { RecorderSession, type RecorderEvents, type RecorderPort } from './recorder';
import { memoryRecordStorage, RecordQueue } from './recordQueue';

function track(label = 'Mixer'): CaptureTrack {
  return { label, deviceId: label, muted: false, stop: () => undefined, on: () => undefined };
}

/** A recorder that hands over what the test says, when it says. */
function fakePort(type: string | null = 'audio/webm;codecs=opus') {
  const running: { track: CaptureTrack; events: RecorderEvents; stopped: boolean }[] = [];
  const port: RecorderPort<CaptureTrack> = {
    type: () => type,
    start(captured, _type, events) {
      const entry = { track: captured, events, stopped: false };
      running.push(entry);
      return {
        stop() {
          if (entry.stopped) return;
          entry.stopped = true;
          // The last chunk comes before the end, as `MediaRecorder` hands it over.
          events.data(new Uint8Array([9]));
          events.stopped();
        },
      };
    },
  };
  const live = () => running.filter((r) => !r.stopped);
  return { port, running, live };
}

function setup(options: { type?: string | null; offered?: boolean; limit?: number } = {}) {
  let ids = 0;
  let offered = options.offered ?? true;
  let now = Date.parse('2026-11-15T10:00:00.000Z');
  const storage = memoryRecordStorage();
  const queue = new RecordQueue(storage, options.limit);
  const fake = fakePort(options.type === undefined ? 'audio/webm;codecs=opus' : options.type);
  const session = new RecorderSession({
    port: fake.port,
    queue,
    offered: () => offered,
    inputName: () => 'Mixer',
    newId: () => `rec-${++ids}`,
    now: () => now,
  });
  return {
    session,
    queue,
    storage,
    ...fake,
    setOffered: (value: boolean) => (offered = value),
    advance: (ms: number) => (now += ms),
  };
}

describe('the recorder session (§5.2)', () => {
  it('opens a recording for a live track with the switch on and a server that takes them', async () => {
    const { session, queue, live } = setup();
    session.setEnabled(true);
    session.setTrack(track());
    await session.settled();
    expect(live()).toHaveLength(1);
    expect(await queue.list()).toMatchObject([
      { id: 'rec-1', container: 'webm', mimeType: 'audio/webm;codecs=opus', inputName: 'Mixer' },
    ]);
    expect(session.status).toMatchObject({ recording: true, idle: null });
  });

  it('opens none against a server that does not take recordings, or names none', async () => {
    const { session, queue, live } = setup({ offered: false });
    session.setEnabled(true);
    session.setTrack(track());
    await session.settled();
    expect(live()).toHaveLength(0);
    expect(await queue.list()).toEqual([]);
    expect(session.status.idle).toBe('not-offered');
  });

  it('opens none where the webview can record neither format', async () => {
    const { session, live } = setup({ type: null });
    session.setEnabled(true);
    session.setTrack(track());
    expect(live()).toHaveLength(0);
    expect(session.status.idle).toBe('unsupported');
  });

  it('records nothing while waiting for input', async () => {
    const { session, queue, live } = setup();
    session.setEnabled(true);
    session.setTrack(null);
    await session.settled();
    expect(live()).toHaveLength(0);
    expect(await queue.list()).toEqual([]);
    expect(session.status.idle).toBe('no-input');
  });

  it('closes on each ending, and opens again only for a new track', async () => {
    // Unplugged, then plugged in again: two recordings.
    const unplug = setup();
    unplug.session.setEnabled(true);
    unplug.session.setTrack(track());
    unplug.session.setTrack(null);
    unplug.session.setTrack(track());
    await unplug.session.settled();
    expect((await unplug.queue.list()).map((r) => [r.id, r.endedAt !== null])).toEqual([
      ['rec-1', true],
      ['rec-2', false],
    ]);

    // Muted and taken again, or another input picked: the track is replaced.
    const replaced = setup();
    replaced.session.setEnabled(true);
    replaced.session.setTrack(track());
    replaced.session.setTrack(track('Other'));
    await replaced.session.settled();
    expect(await replaced.queue.list()).toHaveLength(2);
    expect(replaced.live()).toHaveLength(1);

    // The switch off, take-over (the switch goes off here), quitting: closed, nothing opens.
    const off = setup();
    off.session.setEnabled(true);
    const same = track();
    off.session.setTrack(same);
    off.session.setEnabled(false);
    off.session.setTrack(same);
    await off.session.settled();
    expect(off.live()).toHaveLength(0);
    expect((await off.queue.list()).map((r) => r.endedAt !== null)).toEqual([true]);
  });

  it('numbers the chunks in order, the last one before the end', async () => {
    const { session, queue, running, storage } = setup();
    session.setEnabled(true);
    session.setTrack(track());
    running[0]!.events.data(new Uint8Array([1]));
    running[0]!.events.data(new Uint8Array([2, 2]));
    session.setEnabled(false);
    await session.settled();
    const [recording] = await queue.list();
    expect(recording).toMatchObject({ chunks: 3, bytes: 4 });
    expect(await storage.getChunk('rec-1', 0)).toEqual(new Uint8Array([1]));
    expect(await storage.getChunk('rec-1', 2)).toEqual(new Uint8Array([9]));
    expect(session.status.waitingBytes).toBe(4);
  });

  it('drops the oldest waiting recording whole at the limit, never the one recording', async () => {
    const { session, queue, running, storage } = setup({ limit: 10 });
    session.setEnabled(true);
    session.setTrack(track());
    running[0]!.events.data(new Uint8Array(4));
    session.setTrack(track('Other')); // rec-1 ends with its last chunk: 5 bytes
    running[1]!.events.data(new Uint8Array(4));
    await session.settled();
    expect((await queue.list()).map((r) => r.id)).toEqual(['rec-1', 'rec-2']);
    running[1]!.events.data(new Uint8Array(4));
    await session.settled();
    expect((await queue.list()).map((r) => r.id)).toEqual(['rec-2']);
    expect(storage.chunkCount()).toBe(2);
    expect(session.status.dropped).toBe(1);
    // Alone over the limit, the recording going on is kept.
    running[1]!.events.data(new Uint8Array(8));
    await session.settled();
    expect((await queue.list()).map((r) => r.id)).toEqual(['rec-2']);
  });
});

describe('the record queue (M3.2)', () => {
  it('keeps recordings and chunks across a restart of the app', async () => {
    const storage = memoryRecordStorage();
    const first = new RecordQueue(storage);
    await first.create({
      id: 'a',
      startedAt: 't',
      container: 'webm',
      mimeType: 'audio/webm',
      inputName: 'Mixer',
    });
    await first.append('a', new Uint8Array([1, 2]));
    await first.append('a', new Uint8Array([3]));
    const second = new RecordQueue(storage);
    expect(await second.list()).toMatchObject([{ id: 'a', chunks: 2, bytes: 3 }]);
    expect(await second.next('a')).toEqual({ seq: 0, bytes: new Uint8Array([1, 2]) });
    await second.create({
      id: 'b',
      startedAt: 't',
      container: 'webm',
      mimeType: 'audio/webm',
      inputName: 'Mixer',
    });
    expect((await second.list()).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('ends at its last chunk a recording the app quit or failed in the middle of', async () => {
    const storage = memoryRecordStorage();
    const first = new RecordQueue(storage, undefined, () => '2026-11-15T10:05:00.000Z');
    await first.create({
      id: 'a',
      startedAt: '2026-11-15T10:00:00.000Z',
      container: 'webm',
      mimeType: 'audio/webm',
      inputName: 'Mixer',
    });
    await first.append('a', new Uint8Array([1]));
    // The app stops here, with no `finish`.
    const second = new RecordQueue(storage);
    expect((await second.list())[0]).toMatchObject({ endedAt: '2026-11-15T10:05:00.000Z' });
    expect((await new RecordQueue(storage).list())[0]!.endedAt).toBe('2026-11-15T10:05:00.000Z');
  });

  it('drops what the server acknowledged, and marks a recording cut short when it cannot go on', async () => {
    const queue = new RecordQueue(memoryRecordStorage());
    await queue.create({
      id: 'a',
      startedAt: 't',
      container: 'webm',
      mimeType: 'audio/webm',
      inputName: 'Mixer',
    });
    for (const byte of [1, 2, 3]) await queue.append('a', new Uint8Array([byte]));
    expect(await queue.acknowledge('a', 2)).toBe(true);
    expect(await queue.next('a')).toEqual({ seq: 2, bytes: new Uint8Array([3]) });
    expect((await queue.list())[0]).toMatchObject({ sent: 2, bytes: 1 });
    // The server expects chunk 0 again, which is gone here.
    expect(await queue.acknowledge('a', 0)).toBe(false);
    expect((await queue.list())[0]).toMatchObject({ sent: 3, bytes: 0, cutShort: true });
    expect(await queue.next('a')).toBeNull();
  });
});
