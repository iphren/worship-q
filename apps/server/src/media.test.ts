import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { PROTOCOL_HEADER, PROTOCOL_VERSION, type Deck, type ServerInfo } from '@worship-q/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { openDatabase } from './db';
import type { ConvertedDeck } from './decks/convert';
import { Instance } from './instance';
import { attachment, DEFAULT_MEDIA_LIMITS, limiter, mediaLimitsFromEnv } from './media';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function setup(
  options: {
    limits?: { image?: number; deck?: number; video?: number };
    convert?: (source: string, outDir: string) => Promise<ConvertedDeck>;
  } = {},
) {
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-media-'));
  const instance = new Instance(openDatabase(':memory:'));
  const { workspace, code } = instance.createWorkspace('North Branch');
  const { token } = instance.enroll(code, 'Desktop')!;
  const { app } = await buildServer({
    instance,
    dataDir,
    name: 'Test',
    mediaLimits: options.limits,
    convertDeck: options.convert && ((source, outDir) => options.convert!(source, outDir)),
  });
  closers.push(() => app.close());
  const headers = {
    authorization: `Bearer ${token}`,
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    'content-type': 'application/octet-stream',
  };
  const files = () => join(dataDir, 'files', workspace.id);
  return { app, dataDir, instance, workspace, headers, files };
}

const solid = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' | 'gif' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .toFormat(format)
    .toBuffer();

/** A PNG signature and header for an image of the given size, with one empty data chunk. */
function pngHeader(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const fakeConvert = async (_source: string, outDir: string): Promise<ConvertedDeck> => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, '001.jpg'), 'one');
  writeFileSync(join(outDir, 't-001.jpg'), 'small one');
  return {
    width: 1440,
    height: 1080,
    pages: [{ image: '001.jpg', thumbnail: 't-001.jpg', slide: 1, step: 0, text: ['Hi'] }],
  };
};

describe('limits (U1, U2, U19)', () => {
  it('reads the limits from the environment, keeping the defaults otherwise', () => {
    expect(mediaLimitsFromEnv({})).toEqual(DEFAULT_MEDIA_LIMITS);
    expect(
      mediaLimitsFromEnv({ WORSHIP_Q_MAX_VIDEO_MB: '500', WORSHIP_Q_MAX_IMAGE_MB: 'lots' }),
    ).toEqual({ ...DEFAULT_MEDIA_LIMITS, video: 500 * 1024 * 1024 });
  });

  it('reports what it takes and its limits', async () => {
    const { app } = await setup({ limits: { video: 1000 } });
    const info = (await app.inject({ method: 'GET', url: '/api/v1/info' })).json<ServerInfo>();
    expect(info.media).toEqual({
      images: true,
      videos: true,
      limits: { ...DEFAULT_MEDIA_LIMITS, video: 1000 },
    });
  });

  it('takes a file exactly at the limit and refuses one byte more, leaving nothing behind', async () => {
    const { app, headers, files } = await setup({ limits: { video: 10 } });
    const at = await app.inject({
      method: 'POST',
      url: '/api/v1/videos?name=a.mp4',
      headers,
      payload: Buffer.alloc(10, 1),
    });
    expect(at.statusCode).toBe(200);
    const over = await app.inject({
      method: 'POST',
      url: '/api/v1/videos?name=b.mp4',
      headers,
      payload: Buffer.alloc(11, 1),
    });
    expect(over.statusCode).toBe(413);
    expect(over.json()).toEqual({ error: 'too-large', limitBytes: 10 });
    expect(readdirSync(files())).toEqual([at.json().file]);
  });

  it('refuses a body over the limit without a declared length while it arrives', async () => {
    const { app, headers, files } = await setup({ limits: { video: 10 } });
    // Over a real connection: the request is cut off once the limit is passed.
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const { request } = await import('node:http');
    const over = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const sending = request(
        `${address}/api/v1/videos?name=b.mp4`,
        { method: 'POST', headers: { ...headers, 'transfer-encoding': 'chunked' } },
        (response) => {
          response.resume();
          resolve({ statusCode: response.statusCode ?? 0 });
        },
      );
      sending.on('error', reject);
      sending.write(Buffer.alloc(6));
      setTimeout(() => sending.end(Buffer.alloc(6)), 20);
    });
    expect(over.statusCode).toBe(413);
    expect(existsSync(files()) ? readdirSync(files()) : []).toEqual([]);
  });

  it('refuses an empty file', async () => {
    const { app, headers } = await setup();
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/videos?name=a.mp4',
      headers,
      payload: Buffer.alloc(0),
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe('empty');
  });

  it('holds slide decks to the deck limit', async () => {
    const { app, headers, dataDir } = await setup({ limits: { deck: 5 }, convert: fakeConvert });
    const over = await app.inject({
      method: 'POST',
      url: '/api/v1/decks?name=talk.pptx',
      headers,
      payload: Buffer.alloc(6),
    });
    expect(over.statusCode).toBe(413);
    expect(over.json().limitBytes).toBe(5);
    expect(readdirSync(join(dataDir, 'work'))).toEqual([]);
  });
});

describe('images (U13)', () => {
  const upload = async (
    context: Awaited<ReturnType<typeof setup>>,
    name: string,
    payload: Buffer,
  ) =>
    context.app.inject({
      method: 'POST',
      url: `/api/v1/images?name=${encodeURIComponent(name)}`,
      headers: context.headers,
      payload,
    });

  const sizeOf = async (context: Awaited<ReturnType<typeof setup>>, deck: Deck) => {
    const meta = await sharp(join(context.files(), deck.pages[0]!.image)).metadata();
    return [meta.width, meta.height];
  };

  it.each([
    [4000, 3000, 1440, 1080],
    [3840, 1080, 1920, 540],
    [1080, 1920, 608, 1080],
    [1920, 1080, 1920, 1080],
    [1921, 1081, 1919, 1080],
    [800, 600, 800, 600],
    [1, 1, 1, 1],
    [1, 5000, 1, 1080],
    [5000, 1, 1920, 1],
  ])('fits %i × %i within 1920 × 1080 as %i × %i', async (w, h, outW, outH) => {
    const context = await setup();
    const response = await upload(context, 'photo.jpg', await solid(w, h));
    expect(response.statusCode).toBe(200);
    const deck = response.json<Deck>();
    expect([deck.width, deck.height]).toEqual([outW, outH]);
    expect(await sizeOf(context, deck)).toEqual([outW, outH]);
  });

  it('answers a one-page image deck, keeps the original, and a small copy for phones', async () => {
    const context = await setup();
    const bytes = await solid(4000, 3000, 'png');
    const deck = (await upload(context, '主日 Photo.PNG', bytes)).json<Deck>();
    expect(deck).toMatchObject({ source: '主日 Photo.PNG', kind: 'image', width: 1440 });
    expect(deck.pages).toHaveLength(1);
    expect(deck.pages[0]).toMatchObject({ slide: 1, step: 0, text: [] });
    expect(deck.pages[0]!.image).toMatch(/^deck-[0-9a-f-]{36}-001\.jpg$/);
    const small = await sharp(join(context.files(), deck.pages[0]!.thumbnail!)).metadata();
    expect([small.width, small.height]).toEqual([320, 240]);
    const id = deck.pages[0]!.image.slice(5, 41);
    expect(readFileSync(join(context.files(), `deck-${id}-original.png`))).toEqual(bytes);
    expect(readdirSync(join(context.dataDir, 'work'))).toEqual([]);
  });

  it('turns a rotated phone photo upright', async () => {
    const context = await setup();
    const photo = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const deck = (await upload(context, 'phone.jpg', photo)).json<Deck>();
    expect([deck.width, deck.height]).toEqual([810, 1080]);
  });

  it('puts transparency on black', async () => {
    const context = await setup();
    const clear = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const deck = (await upload(context, 'clear.png', clear)).json<Deck>();
    const { data } = await sharp(join(context.files(), deck.pages[0]!.image))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Math.max(data[0]!, data[1]!, data[2]!)).toBeLessThan(5);
  });

  it('takes the first frame of a GIF and reads WebP', async () => {
    const context = await setup();
    expect((await upload(context, 'a.gif', await solid(640, 480, 'gif'))).statusCode).toBe(200);
    const webp = (await upload(context, 'b.webp', await solid(2000, 1500, 'webp'))).json<Deck>();
    expect([webp.width, webp.height]).toEqual([1440, 1080]);
  });

  it('refuses HEIC, unknown formats, and files that are not images, leaving nothing', async () => {
    const context = await setup();
    const heic = await upload(context, 'IMG_0001.HEIC', Buffer.from('heic'));
    expect(heic.statusCode).toBe(400);
    expect(heic.json()).toMatchObject({ error: 'heic-unsupported' });
    expect(heic.json().message).toContain('Export the photo as JPEG');
    expect((await upload(context, 'notes.txt', Buffer.from('x'))).statusCode).toBe(400);
    const fake = await upload(context, 'fake.jpg', Buffer.from('not an image at all'));
    expect(fake.statusCode).toBe(422);
    expect(fake.json().message).toContain('not an image');
    expect(existsSync(context.files()) ? readdirSync(context.files()) : []).toEqual([]);
    expect(readdirSync(join(context.dataDir, 'work'))).toEqual([]);
  });

  it('refuses an image over 100 megapixels', async () => {
    const context = await setup();
    // A small PNG whose header declares 10001 × 10001 pixels; it is refused before decoding.
    const huge = pngHeader(10_001, 10_001);
    const response = await upload(context, 'huge.png', huge);
    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('100 megapixels');
  });

  it('goes to the Church Library when the workspace manages media', async () => {
    const context = await setup();
    context.instance.setLibraryTypes(context.workspace.id, ['slides']);
    const deck = (await upload(context, 'a.jpg', await solid(10, 10))).json<Deck>();
    expect(existsSync(join(context.dataDir, 'files', 'church', deck.pages[0]!.image))).toBe(true);
  });

  it('runs at most two at once', async () => {
    const run = limiter(2);
    let running = 0;
    let most = 0;
    const task = () =>
      run(async () => {
        most = Math.max(most, ++running);
        await new Promise((done) => setTimeout(done, 5));
        running--;
      });
    await Promise.all([task(), task(), task(), task()]);
    expect(most).toBe(2);
  });
});

describe('videos (U14)', () => {
  it('stores a video under a new name and serves it in parts', async () => {
    const context = await setup();
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
    const stored = await context.app.inject({
      method: 'POST',
      url: `/api/v1/videos?name=${encodeURIComponent('../Welcome.MOV')}`,
      headers: context.headers,
      payload: bytes,
    });
    expect(stored.statusCode).toBe(200);
    const { file, source, bytes: size } = stored.json();
    expect(file).toMatch(/^video-[0-9a-f-]{36}\.mov$/);
    expect([source, size]).toEqual(['Welcome.MOV', 1000]);

    const part = await context.app.inject({
      method: 'GET',
      url: `/api/v1/files/${file}`,
      headers: { ...context.headers, range: 'bytes=0-99' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload).toEqual(bytes.subarray(0, 100));
    expect(part.headers['content-type']).toBe('video/quicktime');
    const past = await context.app.inject({
      method: 'GET',
      url: `/api/v1/files/${file}`,
      headers: { ...context.headers, range: 'bytes=5000-' },
    });
    expect(past.statusCode).toBe(416);
  });

  it('refuses unknown extensions and a name that is only an extension', async () => {
    const context = await setup();
    for (const name of ['clip.avi', '.mp4', 'clip']) {
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/v1/videos?name=${name}`,
        headers: context.headers,
        payload: Buffer.from('x'),
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('is stored under the Church Library when the workspace manages media', async () => {
    const context = await setup();
    context.instance.setLibraryTypes(context.workspace.id, ['slides']);
    const { file } = (
      await context.app.inject({
        method: 'POST',
        url: '/api/v1/videos?name=a.mp4',
        headers: context.headers,
        payload: Buffer.from('video'),
      })
    ).json();
    expect(existsSync(join(context.dataDir, 'files', 'church', file))).toBe(true);
  });

  it('is served to browser outputs of its own workspace only', async () => {
    const context = await setup();
    const { file } = (
      await context.app.inject({
        method: 'POST',
        url: '/api/v1/videos?name=a.mp4',
        headers: context.headers,
        payload: Buffer.from('video'),
      })
    ).json();
    const { token } = context.instance.createOutputLink(context.workspace.id, 'slideshow', 'TV');
    const own = await context.app.inject({
      method: 'GET',
      url: `/api/v1/output/files/${file}?t=${token}`,
    });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('video/mp4');
    const other = context.instance.createWorkspace('South');
    const { token: otherToken } = context.instance.createOutputLink(
      other.workspace.id,
      'slideshow',
      'TV',
    );
    const refused = await context.app.inject({
      method: 'GET',
      url: `/api/v1/output/files/${file}?t=${otherToken}`,
    });
    expect(refused.statusCode).toBe(404);
  });
});

describe('originals and reconvert (U4, U18)', () => {
  it('sends a deck’s original with its length and download name', async () => {
    const context = await setup({ convert: fakeConvert });
    const deck = (
      await context.app.inject({
        method: 'POST',
        url: '/api/v1/decks?name=talk.pptx',
        headers: context.headers,
        payload: Buffer.from('pptx bytes'),
      })
    ).json<Deck>();
    const id = deck.pages[0]!.image.slice(5, 41);
    const original = await context.app.inject({
      method: 'GET',
      url: `/api/v1/decks/${id}/original?name=${encodeURIComponent('主日 "Talk".pptx')}`,
      headers: context.headers,
    });
    expect(original.statusCode).toBe(200);
    expect(original.body).toBe('pptx bytes');
    expect(original.headers['content-length']).toBe('10');
    expect(original.headers['content-disposition']).toBe(attachment('主日 "Talk".pptx'));
    expect(attachment('主日 "Talk".pptx')).toBe(
      `attachment; filename="__ _Talk_.pptx"; filename*=UTF-8''${encodeURIComponent('主日 "Talk".pptx')}`,
    );
  });

  it('names a converted HEIC photo’s original after its own extension', async () => {
    const context = await setup();
    const deck = (
      await context.app.inject({
        method: 'POST',
        url: '/api/v1/images?name=IMG_1.jpg',
        headers: context.headers,
        payload: await solid(10, 10),
      })
    ).json<Deck>();
    const id = deck.pages[0]!.image.slice(5, 41);
    const original = await context.app.inject({
      method: 'GET',
      url: `/api/v1/decks/${id}/original?name=IMG_1.heic`,
      headers: context.headers,
    });
    expect(original.headers['content-disposition']).toContain('filename="IMG_1.jpg"');
  });

  it('answers 404, never 500, without an original', async () => {
    const context = await setup({ convert: fakeConvert });
    const other = await setup({ convert: fakeConvert });
    const deck = (
      await other.app.inject({
        method: 'POST',
        url: '/api/v1/decks?name=talk.pptx',
        headers: other.headers,
        payload: Buffer.from('pptx'),
      })
    ).json<Deck>();
    const otherId = deck.pages[0]!.image.slice(5, 41);
    for (const id of ['0f8fad5b-d9cb-469f-a165-70867728950e', 'not-an-id', '..', otherId]) {
      const response = await context.app.inject({
        method: 'GET',
        url: `/api/v1/decks/${id}/original`,
        headers: context.headers,
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('finds a Church Library deck’s original from a workspace using it', async () => {
    const context = await setup({ convert: fakeConvert });
    context.instance.setLibraryTypes(context.workspace.id, ['slides']);
    const deck = (
      await context.app.inject({
        method: 'POST',
        url: '/api/v1/decks?name=talk.pptx',
        headers: context.headers,
        payload: Buffer.from('church pptx'),
      })
    ).json<Deck>();
    const id = deck.pages[0]!.image.slice(5, 41);
    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/decks/${id}/original`,
      headers: context.headers,
    });
    expect(response.body).toBe('church pptx');
  });

  it('never serves an original through the files routes', async () => {
    const context = await setup();
    const deck = (
      await context.app.inject({
        method: 'POST',
        url: '/api/v1/images?name=a.jpg',
        headers: context.headers,
        payload: await solid(10, 10),
      })
    ).json<Deck>();
    const id = deck.pages[0]!.image.slice(5, 41);
    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/files/deck-${id}-original.jpg`,
      headers: context.headers,
    });
    expect(response.statusCode).toBe(400);
  });

  it('converts the original again under a new identifier, keeping the old images', async () => {
    let conversions = 0;
    const context = await setup({
      convert: async (source, outDir) => {
        conversions++;
        expect(readFileSync(source, 'utf8')).toBe('pptx bytes');
        return fakeConvert(source, outDir);
      },
    });
    const first = (
      await context.app.inject({
        method: 'POST',
        url: '/api/v1/decks?name=talk.pptx',
        headers: context.headers,
        payload: Buffer.from('pptx bytes'),
      })
    ).json<Deck>();
    const id = first.pages[0]!.image.slice(5, 41);
    const again = await context.app.inject({
      method: 'POST',
      url: `/api/v1/decks/${id}/reconvert?name=talk.pptx`,
      headers: context.headers,
    });
    expect(again.statusCode).toBe(200);
    const second = again.json<Deck>();
    expect(conversions).toBe(2);
    expect(second.source).toBe('talk.pptx');
    expect(second.pages[0]!.image).not.toBe(first.pages[0]!.image);
    expect(existsSync(join(context.files(), first.pages[0]!.image))).toBe(true);
    // The new deck keeps an original of its own, so it can be reconverted again.
    const newId = second.pages[0]!.image.slice(5, 41);
    expect(existsSync(join(context.files(), `deck-${newId}-original.pptx`))).toBe(true);
    expect(existsSync(join(context.files(), `deck-${id}-original.pptx`))).toBe(true);

    const missing = await context.app.inject({
      method: 'POST',
      url: '/api/v1/decks/0f8fad5b-d9cb-469f-a165-70867728950e/reconvert',
      headers: context.headers,
    });
    expect(missing.statusCode).toBe(404);
  });
});
