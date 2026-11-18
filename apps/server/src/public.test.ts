import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INSTALL_HEADER,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type Deck,
  type PublicJoinResponse,
  type ServerInfo,
} from '@worship-q/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { openDatabase } from './db';
import type { ConvertedDeck } from './decks/convert';
import { Instance } from './instance';
import { RateLimiter, takeAll } from './limits';
import {
  checkDataKind,
  DEFAULT_PUBLIC,
  KEEP_FILES_MS,
  publicConfigFromEnv,
  publicRoute,
  sweepPublic,
  type PublicConfig,
} from './public';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

const fakeConvert = async (_source: string, outDir: string): Promise<ConvertedDeck> => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, '001.jpg'), 'one');
  writeFileSync(join(outDir, 't-001.jpg'), 'small one');
  writeFileSync(join(outDir, '002.jpg'), 'two');
  writeFileSync(join(outDir, 't-002.jpg'), 'small two');
  return {
    width: 1440,
    height: 1080,
    pages: [
      { image: '001.jpg', thumbnail: 't-001.jpg', slide: 1, step: 0, text: ['Hi'] },
      { image: '002.jpg', thumbnail: 't-002.jpg', slide: 2, step: 0, text: [] },
    ],
  };
};

async function setup(
  options: { public?: Partial<PublicConfig> | false; convert?: typeof fakeConvert } = {},
) {
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-public-'));
  const instance = new Instance(openDatabase(':memory:'));
  const publicConfig =
    options.public === false ? null : { ...DEFAULT_PUBLIC, ...(options.public ?? {}) };
  const { app } = await buildServer({
    instance,
    dataDir,
    name: 'Worship Q public',
    public: publicConfig,
    sweep: false,
    convertDeck: (source, outDir) => (options.convert ?? fakeConvert)(source, outDir),
  });
  closers.push(() => app.close());
  const join_ = async (ip = '203.0.113.1') =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/public/join',
        payload: { protocolVersion: PROTOCOL_VERSION },
        remoteAddress: ip,
      })
    ).json() as PublicJoinResponse;
  const headers = (token: string, install = 'install-0001') => ({
    authorization: `Bearer ${token}`,
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    [INSTALL_HEADER]: install,
  });
  return { app, dataDir, instance, join: join_, headers };
}

describe('public mode’s settings', () => {
  it('is off unless WORSHIP_Q_PUBLIC says so', () => {
    expect(publicConfigFromEnv({})).toBeNull();
    expect(publicConfigFromEnv({ WORSHIP_Q_PUBLIC: '0' })).toBeNull();
    expect(publicConfigFromEnv({ WORSHIP_Q_PUBLIC: '1' })).toEqual(DEFAULT_PUBLIC);
  });

  it('has the decided limits: two phones, two listeners, 100 decks and images a day', () => {
    expect(DEFAULT_PUBLIC.limits).toEqual({ phones: 2, listeners: 2, mediaPerDay: 100 });
    expect(DEFAULT_PUBLIC.idleDays).toBe(90);
  });

  it('reads each limit, and stops on a bad one, naming it', () => {
    const config = publicConfigFromEnv({ WORSHIP_Q_PUBLIC: 'yes', WORSHIP_Q_PUBLIC_PHONES: '3' });
    expect(config?.limits.phones).toBe(3);
    expect(() =>
      publicConfigFromEnv({ WORSHIP_Q_PUBLIC: '1', WORSHIP_Q_PUBLIC_LISTENERS: '0' }),
    ).toThrow(/WORSHIP_Q_PUBLIC_LISTENERS/);
    expect(() =>
      publicConfigFromEnv({ WORSHIP_Q_PUBLIC: '1', WORSHIP_Q_PUBLIC_MEDIA_PER_DAY: 'lots' }),
    ).toThrow(/WORSHIP_Q_PUBLIC_MEDIA_PER_DAY/);
  });
});

describe('what a public server serves (M2.3)', () => {
  /** Every church route a public server must not serve, with a body where one is needed. */
  const churchOnly: [string, string][] = [
    ['POST', '/api/v1/sync/push'],
    ['GET', '/api/v1/sync/pull'],
    ['POST', '/api/v1/sync/restore'],
    ['PUT', '/api/v1/files/bg-1.jpg'],
    ['PUT', '/api/v1/backups'],
    ['GET', '/api/v1/backups'],
    ['GET', '/api/v1/backups/x'],
    ['POST', '/api/v1/claim'],
    ['PUT', '/api/v1/live'],
    ['GET', '/api/v1/live'],
    ['PUT', '/api/v1/obs'],
    ['PUT', '/api/v1/audio'],
    ['POST', '/api/v1/audio/recordings'],
    ['POST', '/api/v1/presentation-log'],
    ['GET', '/api/v1/outputs'],
    ['POST', '/api/v1/outputs'],
    ['DELETE', '/api/v1/outputs/x'],
    ['GET', '/api/v1/output/look'],
    ['POST', '/api/v1/videos'],
    ['GET', '/api/v1/decks/00000000-0000-4000-8000-000000000000/original'],
    ['POST', '/api/v1/decks/00000000-0000-4000-8000-000000000000/reconvert'],
    ['GET', '/api/v1/remote/files/00000000-0000-4000-8000-000000000000/x.jpg'],
    ['POST', '/api/v1/bible/fums'],
    ['GET', '/api/v1/workspace/lan-credentials'],
    ['GET', '/api/v1/admin/session'],
    ['GET', '/auth/login'],
  ];

  it.each(churchOnly)('%s %s answers 404', async (method, url) => {
    const { app, join, headers } = await setup();
    const { deviceToken } = await join();
    const answer = await app.inject({
      method: method as 'GET',
      url,
      headers: headers(deviceToken),
    });
    expect(answer.statusCode).toBe(404);
  });

  it('serves the same routes as before on a church server', async () => {
    const { app } = await setup({ public: false });
    // Without a token: a church server's device routes answer 401, not 404.
    for (const [method, url] of churchOnly.filter(([, url]) => url.startsWith('/api/v1/sync'))) {
      const answer = await app.inject({ method: method as 'GET', url });
      expect(answer.statusCode).not.toBe(404);
    }
    expect((await app.inject({ method: 'POST', url: '/api/v1/public/join' })).statusCode).toBe(404);
  });

  it('serves the routes a public workspace needs, HEAD and preflights included', () => {
    expect(publicRoute('GET', '/api/v1/info')).toBe(true);
    expect(publicRoute('HEAD', '/api/v1/files/:name')).toBe(true);
    expect(publicRoute('GET', '/remote/*')).toBe(true);
    expect(publicRoute('OPTIONS', '/api/v1/decks')).toBe(true);
    expect(publicRoute('DELETE', '/api/v1/decks/:id')).toBe(true);
    expect(publicRoute('PUT', '/api/v1/files/:name')).toBe(false);
    expect(publicRoute('GET', undefined)).toBe(true);
  });

  it('says what it is in its info', async () => {
    const { app } = await setup();
    const info = (await app.inject({ method: 'GET', url: '/api/v1/info' })).json() as ServerInfo;
    expect(info).toMatchObject({
      public: true,
      pairing: false,
      admin: false,
      codes: false,
      outputs: false,
      records: { audio: false, log: false },
      limits: { phones: 2, listeners: 2, mediaPerDay: 100 },
    });
    expect(info.media?.videos).toBe(false);
    const church = await setup({ public: false });
    const churchInfo = (
      await church.app.inject({ method: 'GET', url: '/api/v1/info' })
    ).json() as ServerInfo;
    expect(churchInfo.public).toBeUndefined();
    expect(churchInfo.limits).toBeUndefined();
  });

  it('explains itself to a browser at /', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/' })).json()).toMatchObject({
      public: true,
    });
  });
});

describe('joining (M2.4, M2.5)', () => {
  it('makes a workspace and a device whose token works', async () => {
    const { app, join, headers, instance } = await setup();
    const joined = await join();
    expect(joined.deviceToken).toBeTruthy();
    expect(instance.getWorkspace(joined.workspace.id)).not.toBeNull();
    const ice = await app.inject({
      method: 'GET',
      url: '/api/v1/ice',
      headers: headers(joined.deviceToken),
    });
    expect(ice.statusCode).toBe(200);
  });

  it('makes a new workspace on each join, one per local workspace', async () => {
    const { join } = await setup();
    const a = await join();
    const b = await join();
    expect(a.workspace.id).not.toBe(b.workspace.id);
  });

  it('asks an old desktop to update', async () => {
    const { app } = await setup();
    const answer = await app.inject({
      method: 'POST',
      url: '/api/v1/public/join',
      payload: { protocolVersion: 1 },
    });
    expect(answer.statusCode).toBe(426);
  });

  it('refuses a sixth join in an hour from one address, and not another address', async () => {
    const { app } = await setup();
    const joinFrom = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/public/join',
        payload: { protocolVersion: PROTOCOL_VERSION },
        remoteAddress: ip,
      });
    for (let i = 0; i < 5; i++) expect((await joinFrom('198.51.100.7')).statusCode).toBe(200);
    const sixth = await joinFrom('198.51.100.7');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().retryAfter).toBeGreaterThan(0);
    expect((await joinFrom('198.51.100.8')).statusCode).toBe(200);
  });

  it('refuses to be joined as a church server (S5)', async () => {
    const { app } = await setup();
    const pair = await app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      payload: { protocolVersion: PROTOCOL_VERSION, deviceName: 'Laptop' },
    });
    expect(pair.statusCode).toBe(403);
    expect(pair.json()).toEqual({ error: 'public-server' });
    const poll = await app.inject({ method: 'POST', url: '/api/v1/pair/poll', payload: {} });
    expect(poll.json()).toEqual({ error: 'public-server' });
    const started = Date.now();
    const enroll = await app.inject({
      method: 'POST',
      url: '/api/v1/enroll',
      payload: { protocolVersion: PROTOCOL_VERSION, code: 'ABCD-EFGH', deviceName: 'Laptop' },
    });
    expect(enroll.statusCode).toBe(403);
    expect(enroll.json()).toEqual({ error: 'invalid-code' });
    // No delay for guessing: there is nothing to guess.
    expect(Date.now() - started).toBeLessThan(900);
  });

  it('never lets a public token pull or push content', async () => {
    const { app, join, headers } = await setup();
    const { deviceToken } = await join();
    const pull = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?since=0',
      headers: headers(deviceToken),
    });
    expect(pull.statusCode).toBe(404);
  });
});

describe('slide decks and images, kept until fetched (M2.6, M2.7)', () => {
  const upload = (
    app: Awaited<ReturnType<typeof setup>>['app'],
    token: string,
    install = 'install-0001',
    name = 'Talk.pptx',
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/decks?name=${name}`,
      headers: {
        authorization: `Bearer ${token}`,
        [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
        [INSTALL_HEADER]: install,
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('a deck'),
    });

  it('converts a deck and keeps no original', async () => {
    const { app, dataDir, join } = await setup();
    const { deviceToken, workspace } = await join();
    const answer = await upload(app, deviceToken);
    expect(answer.statusCode).toBe(200);
    const deck = answer.json() as Deck;
    expect(deck.pages).toHaveLength(2);
    const files = readdirSync(join_(dataDir, workspace.id));
    expect(files.some((name) => name.includes('-original.'))).toBe(false);
    expect(files).toHaveLength(4);
  });

  it('converts the same file twice, under two identifiers', async () => {
    const { app, join, instance } = await setup();
    const { deviceToken } = await join();
    const first = (await upload(app, deviceToken)).json() as Deck;
    const second = (await upload(app, deviceToken)).json() as Deck;
    expect(first.pages[0]!.image).not.toBe(second.pages[0]!.image);
    expect(instance.db.prepare('SELECT COUNT(*) AS n FROM stored_upload').get()).toEqual({ n: 0 });
  });

  it('deletes a deck’s images and small copies once fetched, and nothing else', async () => {
    const { app, dataDir, join, headers } = await setup();
    const { deviceToken, workspace } = await join();
    const first = (await upload(app, deviceToken)).json() as Deck;
    const second = (await upload(app, deviceToken)).json() as Deck;
    const id = /^deck-([0-9a-f-]{36})-/.exec(first.pages[0]!.image)![1]!;
    const answer = await app.inject({
      method: 'DELETE',
      url: `/api/v1/decks/${id}`,
      headers: headers(deviceToken),
    });
    expect(answer.statusCode).toBe(204);
    const left = readdirSync(join_(dataDir, workspace.id));
    expect(left.sort()).toEqual(second.pages.flatMap((p) => [p.image, p.thumbnail!]).sort());
    // Twice is harmless.
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/decks/${id}`,
      headers: headers(deviceToken),
    });
    expect(again.statusCode).toBe(204);
  });

  it('never deletes another workspace’s deck', async () => {
    const { app, dataDir, join, headers } = await setup();
    const owner = await join('203.0.113.1');
    const other = await join('203.0.113.2');
    const deck = (await upload(app, owner.deviceToken)).json() as Deck;
    const id = /^deck-([0-9a-f-]{36})-/.exec(deck.pages[0]!.image)![1]!;
    const answer = await app.inject({
      method: 'DELETE',
      url: `/api/v1/decks/${id}`,
      headers: headers(other.deviceToken),
    });
    expect(answer.statusCode).toBe(204);
    expect(readdirSync(join_(dataDir, owner.workspace.id))).toHaveLength(4);
  });

  it('refuses a malformed deck identifier', async () => {
    const { app, join, headers } = await setup();
    const { deviceToken } = await join();
    const answer = await app.inject({
      method: 'DELETE',
      url: `/api/v1/decks/..%2F..%2Finstance.db`,
      headers: headers(deviceToken),
    });
    expect(answer.statusCode).toBe(400);
  });

  it('takes 100 decks and images a day from one copy of the app, sharing one count', async () => {
    const { app, join } = await setup({
      public: { limits: { ...DEFAULT_PUBLIC.limits, mediaPerDay: 2 } },
    });
    const { deviceToken } = await join();
    expect((await upload(app, deviceToken)).statusCode).toBe(200);
    expect((await upload(app, deviceToken)).statusCode).toBe(200);
    const third = await upload(app, deviceToken);
    expect(third.statusCode).toBe(429);
    expect(third.json().retryAfter).toBeGreaterThan(0);
    // Another copy of the app has its own count.
    expect((await upload(app, deviceToken, 'install-0002')).statusCode).toBe(200);
  });

  it('answers busy when five conversions are already waiting (S9)', async () => {
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    const { app, join } = await setup({
      convert: async (source, outDir) => {
        await held;
        return fakeConvert(source, outDir);
      },
    });
    const { deviceToken } = await join();
    const running = Array.from({ length: 6 }, (_, i) =>
      upload(app, deviceToken, `install-000${i}`),
    );
    await new Promise((done) => setTimeout(done, 200));
    const busy = await upload(app, deviceToken, 'install-0099');
    expect(busy.statusCode).toBe(503);
    expect(busy.json()).toMatchObject({ error: 'busy' });
    release();
    expect((await Promise.all(running)).every((r) => r.statusCode === 200)).toBe(true);
  });

  it('takes no videos', async () => {
    const { app, join, headers } = await setup();
    const { deviceToken } = await join();
    const answer = await app.inject({
      method: 'POST',
      url: '/api/v1/videos?name=a.mp4',
      headers: { ...headers(deviceToken), 'content-type': 'application/octet-stream' },
      payload: Buffer.from('x'),
    });
    expect(answer.statusCode).toBe(404);
  });
});

const join_ = (dataDir: string, workspaceId: string) => join(dataDir, 'files', workspaceId);

describe('the sweep (M2.8)', () => {
  const age = (path: string, ms: number) => {
    const when = new Date(Date.now() - ms);
    utimesSync(path, when, when);
  };

  it('deletes files over a day old and keeps younger ones', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-sweep-'));
    const instance = new Instance(openDatabase(':memory:'));
    const { workspace } = instance.joinPublic();
    const dir = join_(dataDir, workspace.id);
    mkdirSync(dir, { recursive: true });
    for (const name of ['old.jpg', 'young.jpg', 'young.jpg.partial']) {
      writeFileSync(join(dir, name), 'x');
    }
    age(join(dir, 'old.jpg'), KEEP_FILES_MS + 60 * 60 * 1000);
    age(join(dir, 'young.jpg'), KEEP_FILES_MS - 60 * 60 * 1000);
    const work = join(dataDir, 'work', 'crashed');
    mkdirSync(work, { recursive: true });
    age(work, KEEP_FILES_MS + 1000);
    mkdirSync(join(dataDir, 'bible'), { recursive: true });
    writeFileSync(join(dataDir, 'bible', 'KJV.json'), '{}');
    age(join(dataDir, 'bible', 'KJV.json'), 10 * KEEP_FILES_MS);

    const swept = sweepPublic(instance, dataDir, 90);
    expect(swept.files).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['young.jpg', 'young.jpg.partial']);
    expect(existsSync(work)).toBe(false);
    expect(existsSync(join(dataDir, 'bible', 'KJV.json'))).toBe(true);
  });

  it('forgets workspaces unseen for 90 days, with their folders, and keeps the rest', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-sweep-'));
    let now = '2026-01-01T00:00:00.000Z';
    const instance = new Instance(openDatabase(':memory:'), () => now);
    const old = instance.joinPublic();
    now = '2026-01-03T00:00:00.000Z';
    const recent = instance.joinPublic();
    mkdirSync(join_(dataDir, old.workspace.id), { recursive: true });
    now = '2026-04-02T12:00:00.000Z'; // 91.5 days after the first, 89.5 after the second
    const swept = sweepPublic(instance, dataDir, 90, Date.parse(now));
    expect(swept.workspaces).toBe(1);
    expect(instance.getWorkspace(old.workspace.id)).toBeNull();
    expect(instance.authenticate(old.token)).toBeNull();
    expect(instance.getWorkspace(recent.workspace.id)).not.toBeNull();
    expect(existsSync(join_(dataDir, old.workspace.id))).toBe(false);
  });

  it('counts a device seen through the relay as seen', () => {
    let now = '2026-01-01T00:00:00.000Z';
    const instance = new Instance(openDatabase(':memory:'), () => now);
    const joined = instance.joinPublic();
    now = '2026-03-25T00:00:00.000Z';
    // The relay authenticates the hello with the token, which records the device as seen.
    instance.authenticate(joined.token);
    now = '2026-05-01T00:00:00.000Z';
    expect(instance.forgetIdleWorkspaces('2026-02-01T00:00:00.000Z')).toEqual([]);
  });
});

describe('one kind of server per data folder (S11)', () => {
  it('marks an empty folder public, and refuses a church server on it afterwards', () => {
    const instance = new Instance(openDatabase(':memory:'));
    checkDataKind(instance, true);
    checkDataKind(instance, true);
    expect(() => checkDataKind(instance, false)).toThrow(/public server/);
  });

  it('refuses public mode on a church’s folder', () => {
    const instance = new Instance(openDatabase(':memory:'));
    instance.addAdministrator('pat@example.org', null);
    expect(() => checkDataKind(instance, true)).toThrow(/WORSHIP_Q_PUBLIC/);
  });

  it('lets a church server start on its own folder', () => {
    const instance = new Instance(openDatabase(':memory:'));
    instance.addAdministrator('pat@example.org', null);
    expect(() => checkDataKind(instance, false)).not.toThrow();
  });
});

describe('rate limits (M5.1)', () => {
  it('allows the limit in a window, refuses the next with the wait, and forgets after', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    expect(limiter.take('a')).toBeNull();
    expect(limiter.take('a')).toBeNull();
    expect(limiter.take('a')).toBe(60);
    now = 30_000;
    expect(limiter.take('a')).toBe(30);
    expect(limiter.take('b')).toBeNull();
    now = 90_001;
    expect(limiter.size).toBe(0);
    expect(limiter.take('a')).toBeNull();
  });

  it('counts nothing when any of several limits refuses', () => {
    const install = new RateLimiter(5, 60_000, () => 0);
    const ip = new RateLimiter(1, 60_000, () => 0);
    ip.take('1.2.3.4');
    expect(
      takeAll([
        { limiter: install, key: 'i' },
        { limiter: ip, key: '1.2.3.4' },
      ]),
    ).toBe(60);
    expect(install.size).toBe(0);
  });

  it('counts by address alone when a request names no copy of the app', () => {
    const install = new RateLimiter(5, 60_000, () => 0);
    const ip = new RateLimiter(1, 60_000, () => 0);
    expect(
      takeAll([
        { limiter: install, key: null },
        { limiter: ip, key: '1.2.3.4' },
      ]),
    ).toBeNull();
    expect(ip.take('1.2.3.4')).toBe(60);
  });
});

describe('the Bible on a public server (M2.9, M5.2)', () => {
  it('limits Bible requests per copy of the app', async () => {
    const { app, join, headers } = await setup({ public: { biblePerHour: 1 } });
    const { deviceToken } = await join();
    const ask = () =>
      app.inject({
        method: 'GET',
        url: '/api/v1/bible/versions',
        headers: headers(deviceToken),
      });
    expect((await ask()).statusCode).toBe(200);
    const refused = await ask();
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBeTruthy();
  });
});

describe('joining a church with media made on the public server (M8)', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

  async function church(limits?: { image?: number; video?: number }) {
    const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-join-'));
    const instance = new Instance(openDatabase(':memory:'));
    const { workspace, code } = instance.createWorkspace('North Branch');
    const { token } = instance.enroll(code, 'Desktop')!;
    const { app } = await buildServer({
      instance,
      dataDir,
      name: 'Church',
      sweep: false,
      mediaLimits: limits,
    });
    closers.push(() => app.close());
    const put = (name: string, payload: Buffer) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/files/${name}`,
        headers: {
          authorization: `Bearer ${token}`,
          [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
          'content-type': 'application/octet-stream',
        },
        payload,
      });
    return { app, put, dir: join_(dataDir, workspace.id) };
  }

  it('keeps a slide image, and makes its small copy when it came without', async () => {
    const { default: sharp } = await import('sharp');
    const jpeg = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer();
    const { put, dir } = await church();
    expect((await put(`deck-${ID}-001.jpg`, jpeg)).statusCode).toBe(200);
    expect(readdirSync(dir).sort()).toEqual([`deck-${ID}-001-t.jpg`, `deck-${ID}-001.jpg`]);
  });

  it('keeps a video copy of any accepted kind, within the video limit', async () => {
    const { put, dir } = await church({ video: 10 });
    expect((await put(`video-${ID}.mov`, Buffer.from('tiny'))).statusCode).toBe(200);
    expect(readdirSync(dir)).toEqual([`video-${ID}.mov`]);
    expect((await put(`video-${ID}.mp4`, Buffer.alloc(11))).statusCode).toBe(413);
  });

  it('refuses a name that is no file of a workspace', async () => {
    const { put } = await church();
    expect((await put('deck-original.exe', Buffer.from('x'))).statusCode).toBe(400);
  });
});
