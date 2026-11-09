/** The Bible's routes for devices (P2.6), the server's info, and keys staying on the server. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_HEADER, PROTOCOL_VERSION, type CatalogueVersion } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { Bible } from './bible';
import { openDatabase } from './db';
import { Instance } from './instance';

const KEY = 'SECRET-YOUVERSION-KEY';
const fixture = (path: string) =>
  readFileSync(new URL(`./bible/fixtures/${path}`, import.meta.url), 'utf8');

const CATALOGUE: CatalogueVersion[] = [
  {
    id: 'NIVUK',
    name: 'NIV (Anglicised)',
    credit: 'NIVUK',
    language: 'en',
    providers: [{ provider: 'youversion', id: '113' }],
  },
  {
    id: 'CCB',
    name: '当代译本',
    credit: '当代译本',
    language: 'zh-Hans',
    providers: [{ provider: 'youversion', id: '36' }],
  },
  {
    id: 'ESV',
    name: 'ESV',
    credit: 'ESV',
    language: 'en',
    providers: [{ provider: 'esv', id: 'ESV' }],
  },
];

const index = {
  books: [
    {
      id: 'JHN',
      title: 'John',
      abbreviation: 'Jn',
      chapters: [1, 2, 3].map((c) => ({
        id: `JHN.${c}`,
        title: String(c),
        verses: Array.from({ length: 36 }, (_, i) => ({
          id: `JHN.${c}.${i + 1}`,
          title: String(i + 1),
        })),
      })),
    },
  ],
};

async function setup(offered: string[] = ['NIVUK']) {
  const instance = new Instance(openDatabase(':memory:'));
  const { workspace, code } = instance.createWorkspace('North');
  const device = instance.enroll(code, 'Desk')!;
  if (offered.length) instance.setChurchSetting('bibleVersions', offered);
  const calls: string[] = [];
  const fums: string[] = [];
  const bible = new Bible({
    dataDir: mkdtempSync(join(tmpdir(), 'wq-bible-routes-')),
    keys: { youversion: KEY },
    catalogue: CATALOGUE,
    fetch: async (url, init) => {
      calls.push(url);
      expect(url).not.toContain(KEY);
      expect((init?.headers as Record<string, string> | undefined)?.['X-YVP-App-Key'] ?? KEY).toBe(
        KEY,
      );
      if (url.startsWith('https://fums.api.bible')) {
        fums.push(url);
        return new Response('');
      }
      if (url.includes('/bibles/36/')) return new Response('{}', { status: 403 });
      if (url.includes('/passages/JHN.11.35')) return new Response('{}');
      if (url.endsWith('/bibles/113/index')) return new Response(JSON.stringify(index));
      if (url.includes('/bibles/113/passages/JHN.3.16-18?')) {
        return new Response(fixture('youversion/113-JHN.3.16-18.json'));
      }
      if (url.endsWith('/bibles/113'))
        return new Response(JSON.stringify({ copyright: '© Biblica' }));
      return new Response(`{"echo":"${url}"}`, { status: 500 });
    },
  });
  await bible.availability.refresh();
  const { app } = await buildServer({
    instance,
    dataDir: '/nonexistent',
    name: 'Test',
    sweep: false,
    bible,
  });
  const headers = {
    authorization: `Bearer ${device.token}`,
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
  };
  const get = (url: string, auth = true) =>
    app.inject({ method: 'GET', url, headers: auth ? headers : {} });
  return { app, instance, bible, get, headers, workspace, calls, fums };
}

describe('the Bible’s routes (P2.6)', () => {
  it('refuses a device that is not signed in', async () => {
    const { get } = await setup();
    expect((await get('/api/v1/bible/versions', false)).statusCode).toBe(426);
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bible/NIVUK/toc',
      headers: { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lists the versions the church offers that a provider serves', async () => {
    const { get, instance } = await setup(['NIVUK', 'CCB', 'ESV']);
    // CCB's licence is not accepted (403) and there is no ESV key.
    expect((await get('/api/v1/bible/versions')).json()).toEqual({
      versions: [{ id: 'NIVUK', name: 'NIV (Anglicised)', credit: 'NIVUK', language: 'en' }],
    });
    instance.unsetChurchSetting('bibleVersions');
    expect((await get('/api/v1/bible/versions')).json()).toEqual({ versions: [] });
  });

  it('names the hash of the contents once they are built, so desktops refresh only on a change', async () => {
    const { get } = await setup();
    const toc = (await get('/api/v1/bible/NIVUK/toc')).json();
    expect((await get('/api/v1/bible/versions')).json().versions[0].tocHash).toBe(toc.hash);
  });

  it('says in the info whether the church offers a Bible', async () => {
    const { get, instance } = await setup();
    expect((await get('/api/v1/info', false)).json().bible).toBe(true);
    instance.setChurchSetting('bibleVersions', ['CCB']);
    expect((await get('/api/v1/info', false)).json().bible).toBe(false);
  });

  it('refuses a version the church does not offer', async () => {
    const { get } = await setup(['NIVUK']);
    for (const url of [
      '/api/v1/bible/CCB/toc',
      '/api/v1/bible/CCB/passage?ref=JHN.3.16',
      '/api/v1/bible/XYZ/search?q=love',
    ]) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(403);
      expect(response.json()).toEqual({ error: 'not-offered' });
    }
  });

  it('gives the contents with their hash', async () => {
    const { get } = await setup();
    const answer = (await get('/api/v1/bible/NIVUK/toc')).json();
    expect(answer.toc).toEqual({
      version: 'NIVUK',
      books: [{ book: 'JHN', name: 'John', abbreviation: 'Jn', chapters: [36, 36, 36] }],
    });
    expect(answer.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives a passage, normalised, with the version’s credit', async () => {
    const { get } = await setup();
    const response = await get('/api/v1/bible/NIVUK/passage?ref=JHN.3.16-JHN.3.18');
    expect(response.statusCode).toBe(200);
    const { reference, text } = response.json();
    expect(reference).toBe('JHN.3.16-JHN.3.18');
    expect(text).toMatchObject({
      version: 'NIVUK',
      credit: 'NIVUK',
      provider: 'youversion',
      copyright: '© Biblica',
    });
    expect(text.units.map((u: { label: string }) => u.label)).toEqual(['16', '17', '18']);
  });

  it('answers an unknown reference with 404 and its reason', async () => {
    const { get } = await setup();
    const past = await get('/api/v1/bible/NIVUK/passage?ref=JHN.4.1');
    expect(past.statusCode).toBe(404);
    expect(past.json()).toMatchObject({
      error: 'not-found',
      reason: expect.stringContaining('JHN'),
    });
    const nonsense = await get('/api/v1/bible/NIVUK/passage?ref=Mark%2015');
    expect(nonsense.statusCode).toBe(404);
  });

  it('answers unavailable, without the provider’s answer, when the provider fails', async () => {
    const { get } = await setup();
    const response = await get('/api/v1/bible/NIVUK/passage?ref=JHN.3.1');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('youversion.com');
  });

  it('never sends a key to a device, in any answer or error', async () => {
    const { get } = await setup(['NIVUK', 'CCB']);
    for (const url of [
      '/api/v1/info',
      '/api/v1/bible/versions',
      '/api/v1/bible/NIVUK/toc',
      '/api/v1/bible/NIVUK/passage?ref=JHN.3.16-JHN.3.18',
      '/api/v1/bible/NIVUK/passage?ref=JHN.3.1',
      '/api/v1/bible/NIVUK/search?q=love',
      '/api/v1/bible/CCB/toc',
    ]) {
      expect((await get(url)).body, url).not.toContain(KEY);
    }
  });

  it('tells the admin app which keys are set, never the keys', async () => {
    const { bible, instance } = await setup(['NIVUK']);
    const admin = bible.admin(instance.churchSettings());
    expect(JSON.stringify(admin)).not.toContain(KEY);
    expect(admin.keys).toEqual({ youversion: true, apibible: false, esv: false });
    expect(admin.versions.find((v) => v.id === 'NIVUK')).toMatchObject({
      available: true,
      offered: true,
      providers: ['youversion'],
    });
    expect(admin.versions.find((v) => v.id === 'CCB')).toMatchObject({
      available: false,
      offered: false,
    });
  });

  it('takes a coordinator’s stored tokens for reporting', async () => {
    const { app, headers, bible } = await setup();
    const sent = await app.inject({
      method: 'POST',
      url: '/api/v1/bible/fums',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { tokens: ['T1', 'T2'], device: 'abc', session: 'live-1' },
    });
    expect(sent.statusCode).toBe(204);
    expect(bible.fums.pending).toBe(2);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/bible/fums',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { tokens: [] },
    });
    expect(bad.statusCode).toBe(400);
  });
});
