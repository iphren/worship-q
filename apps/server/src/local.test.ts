/** The local API (service records M6; rules §5.5). */
import { describe, expect, it } from 'vitest';
import { buildLocalServer, localPortFromEnv } from './local';
import { DECK_GONE, DECK_IMAGE, setupRecords } from './serviceRecords.testing';

async function setup() {
  const context = await setupRecords();
  const local = await buildLocalServer({
    instance: context.instance,
    dataDir: context.dataDir,
    recordings: context.recordings,
    presentationLog: context.presentationLog,
    name: 'Test',
  });
  const get = (url: string, headers: Record<string, string> = {}) => local.inject({ url, headers });
  return { ...context, local, get };
}

describe('the local listener (M6.1)', () => {
  it('reads its port from the environment; empty turns it off', () => {
    expect(localPortFromEnv({})).toBe(8081);
    expect(localPortFromEnv({ WORSHIP_Q_LOCAL_PORT: '9000' })).toBe(9000);
    expect(localPortFromEnv({ WORSHIP_Q_LOCAL_PORT: '' })).toBeNull();
    expect(() => localPortFromEnv({ WORSHIP_Q_LOCAL_PORT: 'many' })).toThrow();
  });

  it('is not served by the public listener, and serves nothing public itself', async () => {
    const { app, get } = await setup();
    for (const url of ['/local/v1', '/local/v1/workspaces']) {
      expect((await app.inject(url)).statusCode).toBe(404);
    }
    for (const url of ['/api/v1/info', '/admin/', '/api/v1/admin/me']) {
      expect((await get(url)).statusCode).toBe(404);
    }
    expect((await get('/local/v1')).json()).toMatchObject({ version: 1, recordingOn: true });
  });

  it('refuses every method but GET and HEAD', async () => {
    const { local, workspace } = await setup();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
      const answer = await local.inject({ method, url: `/local/v1/workspaces/${workspace.id}` });
      expect(answer.statusCode).toBe(405);
    }
    const head = await local.inject({ method: 'HEAD', url: '/local/v1/workspaces' });
    expect(head.statusCode).toBe(200);
  });
});

describe('workspaces and run sheets (M6.2)', () => {
  it('lists the workspaces and gives a date’s run sheet with its content in one request', async () => {
    const { get, workspace } = await setup();
    const list = (await get('/local/v1/workspaces')).json();
    expect(list.workspaces.map((w: { name: string }) => w.name).sort()).toEqual(['North', 'South']);
    const days = (await get(`/local/v1/workspaces/${workspace.id}/run-sheets`)).json();
    expect(days.dates).toEqual([{ date: '2026-11-15', items: 2 }]);
    const sheet = (await get(`/local/v1/workspaces/${workspace.id}/run-sheets/2026-11-15`)).json();
    expect(sheet.items[0]).toMatchObject({
      id: 'i1',
      position: 0,
      song: { id: 's1', revision: 2, removed: false },
      content: {
        kind: 'lyrics',
        title: 'Amazing Grace',
        blocks: [
          ['Amazing grace', 'How sweet the sound'],
          ['That saved a wretch', 'Like me'],
        ],
      },
    });
    expect(sheet.items[1].content).toMatchObject({
      kind: 'deck',
      pages: [
        {
          page: 0,
          slide: 1,
          lines: ['Welcome'],
          image: {
            url: `/local/v1/workspaces/${workspace.id}/media/${DECK_IMAGE}`,
            gone: false,
          },
        },
        { page: 1, slide: 2, lines: [], image: { gone: true } },
      ],
    });
  });

  it('answers 404 for an unknown workspace or date, never an empty success', async () => {
    const { get, workspace } = await setup();
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await get(`/local/v1/workspaces/${unknown}`)).statusCode).toBe(404);
    expect((await get(`/local/v1/workspaces/${unknown}/run-sheets`)).statusCode).toBe(404);
    expect(
      (await get(`/local/v1/workspaces/${workspace.id}/run-sheets/2026-01-01`)).statusCode,
    ).toBe(404);
    expect((await get(`/local/v1/workspaces/${workspace.id}/live`)).json()).toEqual({
      live: false,
    });
  });
});

describe('the presentation log (M6.3)', () => {
  it('returns the content of the revision named, not the song’s latest', async () => {
    const { get, send, entry } = await setup();
    await send([
      entry(0, {
        revision: 1,
        revisionId: 'r1',
        part: { kind: 'lyrics', line: 0, count: 2 },
      }),
    ]);
    const { entries } = (await get('/local/v1/presentation-log')).json();
    expect(entries[0].content).toEqual({
      kind: 'lyrics',
      title: 'Amazing Grace',
      author: 'John Newton',
      copyright: 'Public domain',
      ccli: null,
      block: 0,
      lines: ['Amazing grace', 'How sweet that sound'],
      text: 'Amazing grace\nHow sweet that sound',
    });
  });

  it('finds the revision by song and number when the entry names no record', async () => {
    const { get, send, entry } = await setup();
    await send([entry(0, { revisionId: null })]);
    const { entries } = (await get('/local/v1/presentation-log')).json();
    expect(entries[0].content).toMatchObject({
      block: 1,
      lines: ['That saved a wretch', 'Like me'],
    });
  });

  it('still returns it after the song and its run sheet were removed', async () => {
    const { get, send, entry, push, time, workspace } = await setup();
    await send([entry(0)]);
    push([
      {
        kind: 'song',
        id: 's1',
        revision: 3,
        updatedAt: time.at(5),
        data: {
          id: 's1',
          workspaceId: workspace.id,
          title: 'Gone',
          lyrics: 'Other words',
          lineIds: ['x'],
          revision: 3,
          removedAt: time.at(5),
        },
      },
      {
        kind: 'runSheet',
        id: 'rs1',
        revision: 2,
        updatedAt: time.at(5),
        data: { id: 'rs1', workspaceId: workspace.id, date: '2026-11-15', items: [] },
      },
    ]);
    const { entries } = (await get('/local/v1/presentation-log')).json();
    expect(entries[0].content.lines).toEqual(['That saved a wretch', 'Like me']);
  });

  it('returns a slide with its text and links, and marks a removed file as gone', async () => {
    const { get, send, entry, workspace } = await setup();
    await send([
      entry(0, {
        itemId: 'i2',
        songId: 'deck1',
        revision: 1,
        revisionId: null,
        part: { kind: 'deck', page: 0 },
      }),
      entry(10, {
        itemId: 'i2',
        songId: 'deck1',
        revision: 1,
        revisionId: null,
        part: { kind: 'deck', page: 1 },
      }),
    ]);
    const { entries } = (await get('/local/v1/presentation-log')).json();
    expect(entries[0].content).toMatchObject({
      kind: 'deck',
      slide: 1,
      step: 0,
      lines: ['Welcome'],
      image: { url: `/local/v1/workspaces/${workspace.id}/media/${DECK_IMAGE}`, gone: false },
    });
    expect(entries[0].background).toEqual({
      color: '#000000',
      media: {
        url: `/local/v1/workspaces/${workspace.id}/media/hills.jpg`,
        name: 'hills.jpg',
        gone: false,
        kind: 'image',
      },
    });
    expect(entries[1].content.image).toMatchObject({ name: DECK_GONE, gone: true });
    const media = await get(entries[0].content.image.url);
    expect(media.statusCode).toBe(200);
    expect(media.body).toBe(`file ${DECK_IMAGE}`);
    expect((await get(entries[1].content.image.url)).statusCode).toBe(404);
  });

  it('returns an entry without content until its revision reaches the server', async () => {
    const { get, send, entry } = await setup();
    await send([entry(0, { revision: 7, revisionId: 'r7' })]);
    const { entries } = (await get('/local/v1/presentation-log')).json();
    expect(entries[0].content).toBeNull();
  });

  it('follows a cursor: nothing new reads empty, and a close or a late entry comes again', async () => {
    const { get, send, entry, time } = await setup();
    const first = entry(0);
    await send([first]);
    const read = (await get('/local/v1/presentation-log?after=0')).json();
    expect(read.entries).toHaveLength(1);
    const empty = (await get(`/local/v1/presentation-log?after=${read.cursor}`)).json();
    expect(empty.entries).toEqual([]);
    expect(empty.cursor).toBe(read.cursor);
    await send([{ ...first, endedAt: time.at(30) }]);
    const closed = (await get(`/local/v1/presentation-log?after=${read.cursor}`)).json();
    expect(closed.entries.map((e: { id: string; endedAt: string }) => [e.id, e.endedAt])).toEqual([
      [first.id, time.at(30)],
    ]);
    const late = entry(-3600, { endedAt: time.at(-3500) });
    await send([late]);
    const after = (await get(`/local/v1/presentation-log?after=${closed.cursor}`)).json();
    expect(after.entries.map((e: { id: string }) => e.id)).toEqual([late.id]);
  });

  it('reads by time range, and refuses a bad one', async () => {
    const { get, send, entry, workspace } = await setup();
    await send([entry(0), entry(3600)]);
    const range = (
      await get(
        `/local/v1/presentation-log?workspace=${workspace.id}&from=2026-11-15T10:30:00Z&to=2026-11-15T12:00:00Z`,
      )
    ).json();
    expect(range.entries).toHaveLength(1);
    expect((await get('/local/v1/presentation-log?from=yesterday')).statusCode).toBe(400);
  });
});

describe('recordings and media (M6.4, M6.5)', () => {
  it('lists recordings and serves a growing file with ranges', async () => {
    const { app, get, headers, time } = await setup();
    const id = '11111111-2222-4333-8444-555555555555';
    await app.inject({
      method: 'POST',
      url: '/api/v1/audio/recordings',
      headers: headers(),
      payload: {
        id,
        startedAt: time.now(),
        container: 'mp4',
        mimeType: 'audio/mp4',
        inputName: 'Mixer',
        sentAt: time.now(),
      },
    });
    const chunk = (seq: number, body: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/audio/recordings/${id}/chunks/${seq}`,
        headers: { ...headers(), 'content-type': 'application/octet-stream' },
        payload: Buffer.from(body),
      });
    await chunk(0, 'abcd');
    const list = (await get('/local/v1/recordings')).json();
    expect(list.recordings).toHaveLength(1);
    expect(list.recordings[0]).toMatchObject({ id, container: 'mp4', status: 'receiving' });
    const file = await get(list.recordings[0].url, { range: 'bytes=2-' });
    expect(file.statusCode).toBe(206);
    expect(file.body).toBe('cd');
    expect(file.headers['content-type']).toBe('audio/mp4');
    await chunk(1, 'ef');
    const past = await get(list.recordings[0].url, { range: 'bytes=4-999' });
    expect(past.body).toBe('ef');
    const unknown = '22222222-2222-4333-8444-555555555555';
    expect((await get(`/local/v1/recordings/${unknown}`)).statusCode).toBe(404);
    expect((await get(`/local/v1/recordings/${unknown}/file`)).statusCode).toBe(404);
  });

  it('refuses a name with a path in it, and another workspace’s files', async () => {
    const { get, workspace, instance } = await setup();
    const base = `/local/v1/workspaces/${workspace.id}/media`;
    expect((await get(`${base}/..%2F..%2Finstance.db`)).statusCode).toBe(404);
    expect((await get(`${base}/%2E%2E%2Fhills.jpg`)).statusCode).toBe(404);
    const south = instance.listWorkspaces().find((w) => w.name === 'South')!;
    expect((await get(`/local/v1/workspaces/${south.id}/media/hills.jpg`)).statusCode).toBe(404);
    expect((await get(`${base}/hills.jpg`, { range: 'bytes=0-3' })).body).toBe('file');
  });
});
