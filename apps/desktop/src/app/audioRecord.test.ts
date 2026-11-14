/** Sending recordings to the server (service records M3.3; rules §5.2). */
import { memoryRecordStorage, RecordQueue } from '@worship-q/audio';
import { describe, expect, it } from 'vitest';
import {
  RecordingUploader,
  uploadAnswer,
  type RecordingApi,
  type UploadAnswer,
} from './audioRecord';

/** A server that keeps what it is sent, and fails when told to. */
function fakeServer() {
  const files = new Map<string, number[]>();
  const opened = new Set<string>();
  const completed = new Map<string, { endedAt: string; cutShort?: boolean }>();
  const calls: string[] = [];
  let failing: ((call: string) => boolean) | null = null;
  let refuse = false;
  const api: RecordingApi = {
    async open(body) {
      calls.push(`open ${body.id}`);
      if (failing?.(`open ${body.id}`)) return { kind: 'retry' };
      if (refuse) return { kind: 'refused' };
      opened.add(body.id);
      if (!files.has(body.id)) files.set(body.id, []);
      return { kind: 'ok' };
    },
    async chunk(id, seq, bytes): Promise<UploadAnswer> {
      calls.push(`chunk ${id} ${seq}`);
      if (failing?.(`chunk ${id} ${seq}`)) return { kind: 'retry' };
      if (refuse) return { kind: 'refused' };
      const file = files.get(id)!;
      const expected = file.length;
      if (seq < expected) return { kind: 'ok', next: expected };
      if (seq > expected) return { kind: 'gap', expected };
      file.push(bytes[0]!);
      return { kind: 'ok', next: file.length };
    },
    async complete(id, body) {
      calls.push(`complete ${id}`);
      if (failing?.(`complete ${id}`)) return { kind: 'retry' };
      completed.set(id, body);
      return { kind: 'ok' };
    },
  };
  return {
    api,
    files,
    opened,
    completed,
    calls,
    failWhen: (test: ((call: string) => boolean) | null) => (failing = test),
    refuseAll: () => (refuse = true),
  };
}

async function recording(queue: RecordQueue, id: string, bytes: number[], ended = true) {
  await queue.create({
    id,
    startedAt: 't',
    container: 'webm',
    mimeType: 'audio/webm',
    inputName: 'Mixer',
  });
  for (const byte of bytes) await queue.append(id, new Uint8Array([byte]));
  if (ended) await queue.finish(id, 'end');
}

function setup(storage = memoryRecordStorage()) {
  const queue = new RecordQueue(storage);
  const server = fakeServer();
  const timers: { fn: () => void; ms: number }[] = [];
  let reachable = true;
  const uploader = new RecordingUploader({
    queue,
    api: server.api,
    reachable: () => reachable,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => undefined,
  });
  /** Runs the waiting retry. */
  const retry = async () => {
    timers.shift()?.fn();
    for (let i = 0; i < 5; i++) await new Promise((done) => setTimeout(done, 0));
  };
  return {
    queue,
    server,
    uploader,
    timers,
    retry,
    setReachable: (v: boolean) => (reachable = v),
    storage,
  };
}

describe('the recording uploader (§5.2)', () => {
  it('sends a recording whole and in order, completes it and empties the queue', async () => {
    const { queue, server, uploader } = setup();
    await recording(queue, 'a', [1, 2, 3]);
    await uploader.run();
    expect(server.files.get('a')).toEqual([1, 2, 3]);
    expect(server.completed.get('a')).toEqual({ endedAt: 'end' });
    expect(await queue.list()).toEqual([]);
  });

  it('keeps the order whatever fails: chunk 4 failing holds 5 and 6 until 4 is stored', async () => {
    const { queue, server, uploader, timers, retry } = setup();
    await recording(queue, 'a', [0, 1, 2, 3, 4, 5, 6]);
    server.failWhen((call) => call === 'chunk a 4');
    await uploader.run();
    expect(server.files.get('a')).toEqual([0, 1, 2, 3]);
    expect(server.calls).not.toContain('chunk a 5');
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    // Waits grow while it keeps failing.
    await retry();
    expect(timers.map((t) => t.ms)).toEqual([2000]);
    server.failWhen(null);
    await retry();
    expect(server.files.get('a')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(await queue.list()).toEqual([]);
  });

  it('never sends a chunk twice into the file', async () => {
    const { queue, server, uploader } = setup();
    await recording(queue, 'a', [1, 2, 3]);
    await uploader.run();
    const sent = server.calls.filter((c) => c.startsWith('chunk'));
    expect(new Set(sent).size).toBe(sent.length);
  });

  it('follows the server’s expected number, and cuts a recording short when it lacks the chunk', async () => {
    const { queue, server, uploader } = setup();
    await recording(queue, 'a', [0, 1, 2, 3, 4, 5]);
    await queue.markOpened('a');
    // The server lost what it had beyond chunk 2: it expects 3 while this sends 5.
    server.files.set('a', [0, 1, 2]);
    await queue.acknowledge('a', 5);
    await uploader.run();
    expect(server.completed.get('a')).toEqual({ endedAt: 'end', cutShort: true });
    expect(await queue.list()).toEqual([]);
  });

  it('carries on after a restart, finishing the old recording beside a new one', async () => {
    const storage = memoryRecordStorage();
    const before = setup(storage);
    await recording(before.queue, 'old', [1, 2, 3]);
    before.server.failWhen((call) => call === 'chunk old 2');
    await before.uploader.run();
    before.uploader.stop();
    const after = setup(storage);
    after.server.files.set('old', [1, 2]);
    await recording(after.queue, 'new', [7, 8], false);
    await after.uploader.run();
    expect(after.server.files.get('old')).toEqual([1, 2, 3]);
    expect(after.server.files.get('new')).toEqual([7, 8]);
    expect(after.server.completed.has('new')).toBe(false);
    expect((await after.queue.list()).map((r) => r.id)).toEqual(['new']);
  });

  it('drops a recording the server refuses for good', async () => {
    const { queue, server, uploader } = setup();
    await recording(queue, 'a', [1]);
    server.refuseAll();
    await uploader.run();
    expect(await queue.list()).toEqual([]);
  });

  it('sends nothing while unreachable, and everything once reached', async () => {
    const { queue, server, uploader, setReachable } = setup();
    setReachable(false);
    await recording(queue, 'a', [1, 2]);
    await uploader.run();
    expect(server.calls).toEqual([]);
    setReachable(true);
    await uploader.run();
    expect(server.files.get('a')).toEqual([1, 2]);
  });

  it('reads the server’s answers', async () => {
    const answer = (status: number, body: unknown) =>
      uploadAnswer(new Response(JSON.stringify(body), { status }));
    expect(await answer(200, { stored: true, next: 4 })).toEqual({ kind: 'ok', next: 4 });
    expect(await answer(409, { error: 'gap', expected: 2 })).toEqual({ kind: 'gap', expected: 2 });
    expect(await answer(403, { error: 'recording-off' })).toEqual({ kind: 'refused' });
    expect(await answer(403, { error: 'completed' })).toEqual({ kind: 'refused' });
    expect(await answer(409, { error: 'conflict' })).toEqual({ kind: 'refused' });
    expect(await answer(503, {})).toEqual({ kind: 'retry' });
    expect(await answer(413, { error: 'too-large' })).toEqual({ kind: 'retry' });
  });
});
