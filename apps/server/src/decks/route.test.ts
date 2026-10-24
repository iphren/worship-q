import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_HEADER, PROTOCOL_VERSION, type Deck } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../app';
import { openDatabase } from '../db';
import { Instance } from '../instance';
import type { ConvertedDeck } from './convert';

async function setup(convert?: (source: string, outDir: string) => Promise<ConvertedDeck>) {
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-decks-'));
  const instance = new Instance(openDatabase(':memory:'));
  const { workspace, code } = instance.createWorkspace('North Branch');
  const { token } = instance.enroll(code, 'Desktop')!;
  const { app } = await buildServer({
    instance,
    dataDir,
    name: 'Test',
    convertDeck: convert && ((source, outDir) => convert(source, outDir)),
  });
  const headers = {
    authorization: `Bearer ${token}`,
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    'content-type': 'application/octet-stream',
  };
  return { app, dataDir, workspace, headers };
}

describe('importing a slide deck', () => {
  it('converts the upload and keeps its images with the workspace’s files', async () => {
    let uploaded = '';
    const { app, dataDir, workspace, headers } = await setup(async (source, outDir) => {
      uploaded = source;
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, '001.jpg'), 'one');
      writeFileSync(join(outDir, '002.jpg'), 'two');
      writeFileSync(join(outDir, 't-001.jpg'), 'small one');
      writeFileSync(join(outDir, 't-002.jpg'), 'small two');
      return {
        width: 1440,
        height: 1080,
        pages: [
          { image: '001.jpg', thumbnail: 't-001.jpg', slide: 1, step: 0, text: ['Title'] },
          { image: '002.jpg', thumbnail: 't-002.jpg', slide: 1, step: 1, text: ['Title', 'More'] },
        ],
      };
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/info' })).json().decks).toBe(true);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/decks?name=${encodeURIComponent('主日 Sermon.pptx')}`,
      headers,
      payload: Buffer.from('pptx bytes'),
    });
    expect(response.statusCode).toBe(200);
    const deck = response.json<Deck>();
    expect(uploaded.endsWith('.pptx')).toBe(true);
    expect(deck.source).toBe('主日 Sermon.pptx');
    expect([deck.width, deck.height]).toEqual([1440, 1080]);
    expect(deck.pages.map((p) => [p.slide, p.step, p.text])).toEqual([
      [1, 0, ['Title']],
      [1, 1, ['Title', 'More']],
    ]);
    expect(deck.pages[0]!.image).toMatch(/^deck-[0-9a-f-]{36}-001\.jpg$/);

    const image = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${deck.pages[1]!.image}`,
      headers,
    });
    expect(image.body).toBe('two');

    // Phones fetch the small copies without a device token, and nothing else.
    expect(deck.pages[1]!.thumbnail).toBe(deck.pages[1]!.image.replace('.jpg', '-t.jpg'));
    const thumbnail = await app.inject({
      method: 'GET',
      url: `/api/v1/remote/files/${workspace.id}/${deck.pages[1]!.thumbnail}`,
    });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.body).toBe('small two');
    expect(thumbnail.headers['content-type']).toBe('image/jpeg');
    writeFileSync(join(dataDir, 'files', workspace.id, 'background.jpg'), 'private');
    for (const name of ['background.jpg', '..%2Finstance.db', 'deck-x-001.jpg']) {
      const refused = await app.inject({
        method: 'GET',
        url: `/api/v1/remote/files/${workspace.id}/${name}`,
      });
      expect(refused.statusCode).toBe(404);
    }
    // Nothing of the upload is left behind.
    expect(existsSync(join(dataDir, 'work'))).toBe(true);
    expect(readdirSync(join(dataDir, 'work'))).toEqual([]);
    expect(readdirSync(join(dataDir, 'files', workspace.id))).toHaveLength(5);
    await app.close();
  });

  it('refuses unknown formats, and says so when it cannot convert at all', async () => {
    const failing = await setup(async () => {
      throw new Error('LibreOffice could not convert upload.pptx.');
    });
    const wrongType = await failing.app.inject({
      method: 'POST',
      url: '/api/v1/decks?name=notes.docx',
      headers: failing.headers,
      payload: Buffer.from('x'),
    });
    expect(wrongType.statusCode).toBe(400);
    const failed = await failing.app.inject({
      method: 'POST',
      url: '/api/v1/decks?name=talk.pptx',
      headers: failing.headers,
      payload: Buffer.from('x'),
    });
    expect(failed.statusCode).toBe(422);
    expect(failed.json().message).toContain('could not convert');
    await failing.app.close();

    const without = await setup();
    expect((await without.app.inject({ method: 'GET', url: '/api/v1/info' })).json().decks).toBe(
      false,
    );
    const unavailable = await without.app.inject({
      method: 'POST',
      url: '/api/v1/decks?name=talk.pptx',
      headers: without.headers,
      payload: Buffer.from('x'),
    });
    expect(unavailable.statusCode).toBe(501);
    await without.app.close();
  });
});
