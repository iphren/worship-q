/** Recordings of live audio on the server (service records M2.1–M2.4; rules §5.1). */
import { mkdtempSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_HEADER, PROTOCOL_VERSION, RECORDING_CHUNK_MAX_BYTES } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { openDatabase } from './db';
import { Instance } from './instance';
import { Recordings, recordingDaysFromEnv } from './recordings';
import { storageReport } from './storage';

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

function clock(start = '2026-11-15T10:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now).toISOString(), advance: (ms: number) => (now += ms) };
}

async function setup() {
  const time = clock();
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-rec-'));
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const { workspace, code } = instance.createWorkspace('North');
  const broadcaster = instance.enroll(code, 'Sound desk')!;
  const other = instance.enroll(code, 'Projector')!;
  const elsewhere = instance.createWorkspace('South');
  const stranger = instance.enroll(elsewhere.code, 'Far away')!;
  const { app } = await buildServer({ instance, dataDir, name: 'Test', sweep: false });
  const auth = (token: string) => ({
    authorization: `Bearer ${token}`,
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
  });
  const open = (token = broadcaster.token, id = ID) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/audio/recordings',
      headers: { ...auth(token), 'content-type': 'application/json' },
      payload: {
        id,
        startedAt: time.now(),
        container: 'webm',
        mimeType: 'audio/webm;codecs=opus',
        inputName: 'Mixer',
        sentAt: new Date(Date.parse(time.now()) + 1500).toISOString(),
      },
    });
  const chunk = (seq: number, bytes: string | Buffer, token = broadcaster.token, id = ID) =>
    app.inject({
      method: 'PUT',
      url: `/api/v1/audio/recordings/${id}/chunks/${seq}`,
      headers: { ...auth(token), 'content-type': 'application/octet-stream' },
      payload: typeof bytes === 'string' ? Buffer.from(bytes) : bytes,
    });
  const complete = (token = broadcaster.token, id = ID) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/audio/recordings/${id}/complete`,
      headers: { ...auth(token), 'content-type': 'application/json' },
      payload: { endedAt: time.now() },
    });
  const recordings = new Recordings(instance, dataDir);
  const file = () => readFileSync(join(dataDir, 'recordings', workspace.id, `${ID}.webm`), 'utf8');
  return {
    app,
    instance,
    dataDir,
    workspace,
    broadcaster,
    other,
    stranger,
    time,
    open,
    chunk,
    complete,
    recordings,
    file,
    auth,
  };
}

describe('recordings on the server (§5.1)', () => {
  it('says in info whether it takes recordings', async () => {
    const { app, instance } = await setup();
    expect((await app.inject('/api/v1/info')).json().records).toEqual({ audio: true, log: true });
    instance.setChurchSetting('recordLiveAudio', false);
    expect((await app.inject('/api/v1/info')).json().records).toEqual({ audio: false, log: true });
  });

  it('appends chunks 0, 1, 2 in order into one file', async () => {
    const { open, chunk, file, recordings } = await setup();
    expect((await open()).statusCode).toBe(200);
    for (const [seq, bytes] of ['aa', 'bb', 'cc'].entries()) {
      const answer = await chunk(seq, bytes);
      expect(answer.json()).toEqual({ stored: true, next: seq + 1 });
    }
    expect(file()).toBe('aabbcc');
    expect(recordings.get(ID)).toMatchObject({ bytes: 6, chunks: 3, status: 'receiving' });
  });

  it('stores the clock offset from the time of sending (R16)', async () => {
    const { open, recordings } = await setup();
    await open();
    expect(recordings.get(ID)!.clockOffsetMs).toBe(1500);
  });

  it('stores a repeated chunk once and says it is already stored', async () => {
    const { open, chunk, file } = await setup();
    await open();
    await chunk(0, 'aa');
    await chunk(1, 'bb');
    const again = await chunk(1, 'bb');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ stored: true, duplicate: true, next: 2 });
    expect(file()).toBe('aabb');
  });

  it('refuses a gap and names the chunk it expects', async () => {
    const { open, chunk, file } = await setup();
    await open();
    await chunk(0, 'aa');
    await chunk(1, 'bb');
    const gap = await chunk(3, 'dd');
    expect(gap.statusCode).toBe(409);
    expect(gap.json()).toEqual({ error: 'gap', expected: 2 });
    expect(file()).toBe('aabb');
  });

  it('refuses chunks from another device, and from another workspace', async () => {
    const { open, chunk, other, stranger } = await setup();
    await open();
    expect((await chunk(0, 'aa', other.token)).json()).toEqual({ error: 'not-owner' });
    expect((await chunk(0, 'aa', stranger.token)).statusCode).toBe(404);
  });

  it('opens the same recording twice as one; another device opening it is refused', async () => {
    const { open, chunk, other, recordings } = await setup();
    await open();
    await chunk(0, 'aa');
    const again = await open();
    expect(again.statusCode).toBe(200);
    expect(again.json().recording.chunks).toBe(1);
    expect((await open(other.token)).statusCode).toBe(409);
    expect(recordings.list(null)).toHaveLength(1);
  });

  it('refuses everything while the church’s switch is off (R3)', async () => {
    const { open, chunk, instance } = await setup();
    await open();
    instance.setChurchSetting('recordLiveAudio', false);
    expect((await chunk(0, 'aa')).json()).toEqual({ error: 'recording-off' });
    const fresh = await open(undefined, OTHER);
    expect(fresh.statusCode).toBe(403);
    expect(fresh.json()).toEqual({ error: 'recording-off' });
  });

  it('refuses a chunk over the limit and writes nothing', async () => {
    const { open, chunk, file } = await setup();
    await open();
    const answer = await chunk(0, Buffer.alloc(RECORDING_CHUNK_MAX_BYTES + 1));
    expect(answer.statusCode).toBe(413);
    expect(file()).toBe('');
  });

  it('sets the end time on complete, and refuses a chunk after it', async () => {
    const { open, chunk, complete, recordings, time } = await setup();
    await open();
    await chunk(0, 'aa');
    time.advance(60_000);
    const done = await complete();
    expect(done.json().recording).toMatchObject({
      status: 'complete',
      endedAt: '2026-11-15T10:01:00.000Z',
    });
    expect((await chunk(1, 'bb')).json()).toEqual({ error: 'completed' });
    expect(recordings.get(ID)!.chunks).toBe(1);
  });

  it('cuts a file longer than its row back at start, then takes the next chunk', async () => {
    const { open, chunk, recordings, dataDir, workspace, file } = await setup();
    await open();
    await chunk(0, 'aa');
    // A chunk half-written when the server stopped.
    appendFileSync(join(dataDir, 'recordings', workspace.id, `${ID}.webm`), 'b');
    expect(recordings.repair()).toBe(1);
    expect(file()).toBe('aa');
    expect((await chunk(1, 'bb')).json()).toEqual({ stored: true, next: 2 });
    expect(file()).toBe('aabb');
  });

  it('cuts back a half-written chunk before the next even without a restart', async () => {
    const { open, chunk, dataDir, workspace, file } = await setup();
    await open();
    await chunk(0, 'aa');
    writeFileSync(join(dataDir, 'recordings', workspace.id, `${ID}.webm`), 'aaXX');
    await chunk(1, 'bb');
    expect(file()).toBe('aabb');
  });

  it('reads as interrupted after ten minutes without a chunk, and receiving again after one', async () => {
    const { open, chunk, recordings, time } = await setup();
    await open();
    await chunk(0, 'aa');
    time.advance(10 * 60_000 + 1);
    expect(recordings.get(ID)!.status).toBe('interrupted');
    await chunk(1, 'bb');
    expect(recordings.get(ID)!.status).toBe('receiving');
  });
});

describe('recordings: retention and storage (M2.3)', () => {
  it('reads the retention period from the environment', () => {
    expect(recordingDaysFromEnv({})).toBe(90);
    expect(recordingDaysFromEnv({ WORSHIP_Q_RECORDING_DAYS: '30' })).toBe(30);
    expect(recordingDaysFromEnv({ WORSHIP_Q_RECORDING_DAYS: '0' })).toBe(0);
    expect(recordingDaysFromEnv({ WORSHIP_Q_RECORDING_DAYS: 'soon' })).toBe(90);
  });

  it('removes recordings older than the period with their files; 0 keeps them', async () => {
    const { open, chunk, recordings, time, dataDir, workspace } = await setup();
    await open();
    await chunk(0, 'aa');
    time.advance(30 * 24 * 60 * 60 * 1000);
    expect(recordings.sweep(0)).toBe(0);
    expect(recordings.sweep(31)).toBe(0);
    expect(recordings.sweep(29)).toBe(1);
    expect(recordings.list(null)).toEqual([]);
    expect(
      statSync(join(dataDir, 'recordings', workspace.id, `${ID}.webm`), { throwIfNoEntry: false }),
    ).toBeUndefined();
  });

  it('counts recordings as their own kind, by workspace', async () => {
    const { open, chunk, recordings, instance, dataDir, workspace } = await setup();
    await open();
    await chunk(0, 'aaaa');
    const report = storageReport(
      instance,
      dataDir,
      undefined,
      () => ({ bsize: 1, blocks: 1, bavail: 1 }),
      recordings.usage(),
    );
    expect(report.totals.recordings).toEqual({ bytes: 4, files: 1 });
    expect(report.workspaces.find((w) => w.id === workspace.id)!.totals.recordings).toEqual({
      bytes: 4,
      files: 1,
    });
  });
});

describe('recordings in the admin app (M2.4)', () => {
  async function signedIn() {
    const context = await setup();
    const admin = context.instance.addAdministrator('ada@example.org', null);
    const { token } = context.instance.signIn(admin.email, 'subject-1', 'Ada')!;
    const cookie = `wq_admin=${encodeURIComponent(token)}`;
    return { ...context, cookie };
  }

  it('refuses the file to someone signed out', async () => {
    const { app, open, chunk } = await signedIn();
    await open();
    await chunk(0, 'aa');
    const answer = await app.inject(`/api/v1/admin/recordings/${ID}/file`);
    expect(answer.statusCode).toBe(401);
  });

  it('serves a range of a file that is still growing', async () => {
    const { app, open, chunk, cookie } = await signedIn();
    await open();
    await chunk(0, 'aabb');
    const part = await app.inject({
      url: `/api/v1/admin/recordings/${ID}/file`,
      headers: { cookie, range: 'bytes=2-' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe('bb');
    expect(part.headers['content-type']).toBe('audio/webm');
    await chunk(1, 'cc');
    const past = await app.inject({
      url: `/api/v1/admin/recordings/${ID}/file`,
      headers: { cookie, range: 'bytes=4-100' },
    });
    expect(past.statusCode).toBe(206);
    expect(past.body).toBe('cc');
  });

  it('lists a day’s recordings, and deletes one with its file', async () => {
    const { app, open, chunk, cookie, workspace, recordings } = await signedIn();
    await open();
    await chunk(0, 'aa');
    const headers = { cookie, 'x-worship-q-admin': '1' };
    const day = await app.inject({
      url: `/api/v1/admin/workspaces/${workspace.id}/records?from=2026-11-15T00:00:00Z&to=2026-11-16T00:00:00Z`,
      headers,
    });
    expect(day.json().recordings.map((r: { id: string }) => r.id)).toEqual([ID]);
    expect(day.json().recordingOn).toBe(true);
    const other = await app.inject({
      url: `/api/v1/admin/workspaces/${workspace.id}/records?from=2026-11-16T00:00:00Z&to=2026-11-17T00:00:00Z`,
      headers,
    });
    expect(other.json().recordings).toEqual([]);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/recordings/${ID}`,
      headers,
    });
    expect(removed.statusCode).toBe(200);
    expect(recordings.get(ID)).toBeNull();
  });
});
