/** Uploads stored once (media uploads plan, U28). */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { PROTOCOL_HEADER, PROTOCOL_VERSION, type Deck, type SyncRecord } from '@worship-q/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { openDatabase } from './db';
import type { ConvertedDeck } from './decks/convert';
import { moveFilesToChurch } from './files';
import { Instance } from './instance';
import { sweepDeletedFiles } from './retention';
import { backfillStoredUploads, hashFile } from './storedUploads';

const DAY = 24 * 60 * 60 * 1000;

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

/** Two pages, so a deck's files are more than one image. */
const fakeConvert = async (_source: string, outDir: string): Promise<ConvertedDeck> => {
  mkdirSync(outDir, { recursive: true });
  const pages = ['001', '002'].map((page, index) => {
    writeFileSync(join(outDir, `${page}.jpg`), `page ${page}`);
    writeFileSync(join(outDir, `t-${page}.jpg`), `small ${page}`);
    return {
      image: `${page}.jpg`,
      thumbnail: `t-${page}.jpg`,
      slide: index + 1,
      step: 0,
      text: [`Page ${page}`],
    };
  });
  return { width: 1440, height: 1080, pages };
};

async function setup() {
  let now = Date.parse('2026-11-02T09:00:00.000Z');
  const time = { now: () => new Date(now).toISOString(), advance: (ms: number) => (now += ms) };
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-stored-'));
  const instance = new Instance(openDatabase(':memory:'), time.now);
  let conversions = 0;
  const { app } = await buildServer({
    instance,
    dataDir,
    name: 'Test',
    sweep: false,
    convertDeck: (source, outDir) => {
      conversions++;
      return fakeConvert(source, outDir);
    },
  });
  closers.push(() => app.close());

  const join_ = (name: string) => {
    const { workspace, code } = instance.createWorkspace(name);
    const { token } = instance.enroll(code, 'Desktop')!;
    const headers = {
      authorization: `Bearer ${token}`,
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
      'content-type': 'application/octet-stream',
    };
    const dir = join(dataDir, 'files', workspace.id);
    const post = (url: string, payload?: Buffer) =>
      app.inject({ method: 'POST', url, headers, payload });
    let revision = 0;
    return {
      id: workspace.id,
      dir,
      /** The files kept in the workspace's folder. */
      files: () => (existsSync(dir) ? readdirSync(dir).sort() : []),
      video: async (name: string, content: string) => {
        const response = await post(`/api/v1/videos?name=${name}`, Buffer.from(content));
        expect(response.statusCode).toBe(200);
        return response.json<{ file: string; source: string; bytes: number }>();
      },
      deck: async (name: string, content: string | Buffer) => {
        const response = await post(`/api/v1/decks?name=${name}`, Buffer.from(content));
        expect(response.statusCode).toBe(200);
        return response.json<Deck>();
      },
      image: async (name: string, content: Buffer) => {
        const response = await post(`/api/v1/images?name=${name}`, content);
        expect(response.statusCode).toBe(200);
        return response.json<Deck>();
      },
      reconvert: async (deck: Deck) => {
        const response = await post(`/api/v1/decks/${deckId(deck)}/reconvert?name=${deck.source}`);
        expect(response.statusCode).toBe(200);
        return response.json<Deck>();
      },
      /** Saves a song as the device does after an upload; `removed` deletes it. */
      save: (id: string, media: { deck?: Deck; video?: string }, removed = false) => {
        const record: SyncRecord = {
          kind: 'song',
          id,
          key: id,
          revision: ++revision,
          updatedAt: time.now(),
          data: {
            title: id,
            lyrics: '',
            removedAt: removed ? time.now() : null,
            deck: media.deck ?? null,
            video: media.video
              ? {
                  file: media.video,
                  source: 'clip.mp4',
                  width: 0,
                  height: 0,
                  durationSeconds: 0,
                  bytes: 0,
                  autoplay: false,
                }
              : null,
          },
        };
        instance.push(workspace.id, 'device', [record]);
      },
    };
  };

  const remembered = () =>
    instance.db
      .prepare('SELECT ref FROM stored_upload ORDER BY rowid')
      .all()
      .map((row) => String(row.ref));
  return {
    time,
    dataDir,
    instance,
    church: join(dataDir, 'files', 'church'),
    north: join_('North'),
    join: join_,
    conversions: () => conversions,
    remembered,
  };
}

const deckId = (deck: Deck) => deck.pages[0]!.image.slice(5, 41);
const deckFiles = (deck: Deck, extension = '.pptx') => [
  ...deck.pages.flatMap((page) => [page.image, page.thumbnail]),
  `deck-${deckId(deck)}-original${extension}`,
];
const videos = (names: string[]) => names.filter((name) => name.startsWith('video-'));

describe('the same video uploaded again', () => {
  it('is kept once when a song uses the first, under the name it was uploaded with', async () => {
    const { north } = await setup();
    const first = await north.video('welcome.mp4', 'video bytes');
    north.save('welcome', { video: first.file });

    const second = await north.video('welcome-copy.mp4', 'video bytes');
    expect(second).toEqual({ file: first.file, source: 'welcome-copy.mp4', bytes: 11 });
    // Nothing of the second upload is left, not even a half-arrived file.
    expect(north.files()).toEqual([first.file]);
  });

  it('is stored again while no song uses the first', async () => {
    const { north } = await setup();
    const first = await north.video('a.mp4', 'video bytes');
    const second = await north.video('a.mp4', 'video bytes');
    expect(second.file).not.toBe(first.file);
    expect(north.files()).toHaveLength(2);
  });

  it('keeps a video with other content, or another extension, apart', async () => {
    const { north } = await setup();
    const first = await north.video('a.mp4', 'video bytes');
    north.save('a', { video: first.file });
    const other = await north.video('a.mp4', 'other bytes');
    const renamed = await north.video('a.mov', 'video bytes');
    expect(other.file).not.toBe(first.file);
    expect(renamed.file).toMatch(/\.mov$/);
    expect(north.files()).toHaveLength(3);
  });

  it('is stored again when the only song using the first is deleted, and survives the sweep', async () => {
    const { north, time, instance, dataDir, remembered } = await setup();
    const first = await north.video('a.mp4', 'video bytes');
    north.save('old', { video: first.file });
    north.save('old', { video: first.file }, true);

    // The first is waiting for the retention sweep, so it is not handed out again.
    time.advance(DAY);
    const second = await north.video('a.mp4', 'video bytes');
    expect(second.file).not.toBe(first.file);
    north.save('new', { video: second.file });

    time.advance(100 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90).files).toBe(1);
    expect(north.files()).toEqual([second.file]);
    // The swept file is forgotten; the one kept is found from now on.
    expect(remembered()).toEqual([second.file]);
    expect((await north.video('a.mp4', 'video bytes')).file).toBe(second.file);
    expect(north.files()).toEqual([second.file]);
  });

  it('is kept once again after the deleted song is restored', async () => {
    const { north } = await setup();
    const first = await north.video('a.mp4', 'video bytes');
    north.save('song', { video: first.file });
    north.save('song', { video: first.file }, true);
    north.save('song', { video: first.file });
    expect((await north.video('a.mp4', 'video bytes')).file).toBe(first.file);
  });

  it('is kept once when one of two songs using it is deleted', async () => {
    const { north } = await setup();
    const first = await north.video('a.mp4', 'video bytes');
    north.save('one', { video: first.file });
    north.save('two', { video: first.file });
    north.save('one', { video: first.file }, true);
    expect((await north.video('a.mp4', 'video bytes')).file).toBe(first.file);
  });

  it('is stored again when the first file is gone, and the newer one is found afterwards', async () => {
    const { north } = await setup();
    const first = await north.video('a.mp4', 'video bytes');
    north.save('one', { video: first.file });
    rmSync(join(north.dir, first.file));

    const second = await north.video('a.mp4', 'video bytes');
    expect(second.file).not.toBe(first.file);
    north.save('two', { video: second.file });
    expect((await north.video('a.mp4', 'video bytes')).file).toBe(second.file);
    expect(north.files()).toEqual([second.file]);
  });

  it('never uses another workspace’s own video', async () => {
    const context = await setup();
    const south = context.join('South');
    const first = await context.north.video('a.mp4', 'video bytes');
    context.north.save('a', { video: first.file });

    const second = await south.video('a.mp4', 'video bytes');
    expect(second.file).not.toBe(first.file);
    expect(south.files()).toEqual([second.file]);
    // Each workspace then finds its own.
    south.save('a', { video: second.file });
    expect((await south.video('a.mp4', 'video bytes')).file).toBe(second.file);
    expect((await context.north.video('a.mp4', 'video bytes')).file).toBe(first.file);
  });

  it('uses the Church Library’s video from any workspace', async () => {
    const context = await setup();
    const { north, instance, church } = context;
    instance.setLibraryTypes(north.id, ['slides']);
    const first = await north.video('a.mp4', 'video bytes');
    expect(existsSync(join(church, first.file))).toBe(true);
    north.save('a', { video: first.file });

    const south = context.join('South');
    expect((await south.video('a.mp4', 'video bytes')).file).toBe(first.file);
    expect(south.files()).toEqual([]);
    expect(videos(readdirSync(church))).toEqual([first.file]);
  });

  it('follows a video moved into the Church Library', async () => {
    const context = await setup();
    const { north, instance, dataDir, church } = context;
    const first = await north.video('a.mp4', 'video bytes');
    north.save('a', { video: first.file });
    moveFilesToChurch(dataDir, north.id, instance.setLibraryTypes(north.id, ['slides']));
    expect(existsSync(join(church, first.file))).toBe(true);

    expect((await north.video('a.mp4', 'video bytes')).file).toBe(first.file);
    expect((await context.join('South').video('a.mp4', 'video bytes')).file).toBe(first.file);
    expect(videos(readdirSync(church))).toEqual([first.file]);
  });

  it('is stored for the church when the first is still in the managing workspace’s folder', async () => {
    const { north, instance, church } = await setup();
    const first = await north.video('a.mp4', 'video bytes');
    north.save('a', { video: first.file });
    // The song is now the church's, but its file was not moved: other workspaces cannot
    // fetch it, so a church song must not be given its name.
    instance.setLibraryTypes(north.id, ['slides']);

    const second = await north.video('a.mp4', 'video bytes');
    expect(second.file).not.toBe(first.file);
    expect(existsSync(join(church, second.file))).toBe(true);
  });
});

describe('the same slide deck uploaded again', () => {
  it('is not converted or kept again, and takes the name it was uploaded with', async () => {
    const { north, conversions, dataDir } = await setup();
    const first = await north.deck('talk.pptx', 'pptx bytes');
    north.save('talk', { deck: first });

    const second = await north.deck('talk-final.pptx', 'pptx bytes');
    expect(second).toEqual({ ...first, source: 'talk-final.pptx' });
    expect(conversions()).toBe(1);
    expect(north.files()).toEqual(deckFiles(first).sort());
    expect(readdirSync(join(dataDir, 'work'))).toEqual([]);
  });

  it('is converted again while no song uses the first, or when its content differs', async () => {
    const { north, conversions } = await setup();
    const first = await north.deck('talk.pptx', 'pptx bytes');
    const second = await north.deck('talk.pptx', 'pptx bytes');
    expect(deckId(second)).not.toBe(deckId(first));
    north.save('talk', { deck: second });
    const other = await north.deck('talk.pptx', 'other bytes');
    expect(deckId(other)).not.toBe(deckId(second));
    expect(conversions()).toBe(3);
  });

  it('is converted again when the song using the first is deleted, and survives the sweep', async () => {
    const { north, time, instance, dataDir, remembered } = await setup();
    const first = await north.deck('talk.pptx', 'pptx bytes');
    north.save('old', { deck: first });
    north.save('old', { deck: first }, true);

    const second = await north.deck('talk.pptx', 'pptx bytes');
    expect(deckId(second)).not.toBe(deckId(first));
    north.save('new', { deck: second });

    time.advance(100 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90).files).toBe(5);
    expect(north.files()).toEqual(deckFiles(second).sort());
    expect(remembered()).toEqual([`deck-${deckId(second)}`]);
    expect(await north.deck('talk.pptx', 'pptx bytes')).toEqual(second);
  });

  it('is converted again when the song no longer uses every page', async () => {
    const { north, conversions } = await setup();
    const first = await north.deck('talk.pptx', 'pptx bytes');
    north.save('talk', { deck: { ...first, pages: first.pages.slice(0, 1) } });
    expect(deckId(await north.deck('talk.pptx', 'pptx bytes'))).not.toBe(deckId(first));
    expect(conversions()).toBe(2);
  });

  it('is converted again when the first deck’s original or an image is gone', async () => {
    const { north, conversions } = await setup();
    const first = await north.deck('talk.pptx', 'pptx bytes');
    north.save('one', { deck: first });
    rmSync(join(north.dir, `deck-${deckId(first)}-original.pptx`));
    const second = await north.deck('talk.pptx', 'pptx bytes');
    expect(deckId(second)).not.toBe(deckId(first));

    north.save('two', { deck: second });
    rmSync(join(north.dir, second.pages[1]!.thumbnail!));
    const third = await north.deck('talk.pptx', 'pptx bytes');
    expect(deckId(third)).not.toBe(deckId(second));
    expect(conversions()).toBe(3);
  });

  it('is told apart by extension, since the original is downloaded under it', async () => {
    const { north } = await setup();
    const first = await north.deck('talk.pptx', 'bytes');
    north.save('talk', { deck: first });
    const pdf = await north.deck('talk.pdf', 'bytes');
    expect(deckId(pdf)).not.toBe(deckId(first));
    expect(north.files()).toContain(`deck-${deckId(pdf)}-original.pdf`);
  });

  it('answers the newest conversion a song uses after Reconvert', async () => {
    const { north, conversions } = await setup();
    const first = await north.deck('talk.pptx', 'pptx bytes');
    north.save('talk', { deck: first });
    const again = await north.reconvert(first);
    expect(deckId(again)).not.toBe(deckId(first));

    // Until the device saves the new conversion, the song still uses the first.
    expect(await north.deck('talk.pptx', 'pptx bytes')).toEqual(first);
    north.save('talk', { deck: again });
    expect(await north.deck('talk.pptx', 'pptx bytes')).toEqual(again);
    // With a second song on the first conversion, the newest is still the answer.
    north.save('older', { deck: first });
    expect(await north.deck('talk.pptx', 'pptx bytes')).toEqual(again);
    expect(conversions()).toBe(2);
  });

  it('uses the Church Library’s deck from another workspace, but never a workspace’s own', async () => {
    const context = await setup();
    const { north, instance, church, conversions } = context;
    const south = context.join('South');
    const own = await north.deck('own.pptx', 'north only');
    north.save('own', { deck: own });
    expect(deckId(await south.deck('own.pptx', 'north only'))).not.toBe(deckId(own));

    instance.setLibraryTypes(north.id, ['slides']);
    const shared = await north.deck('shared.pptx', 'for everyone');
    north.save('shared', { deck: shared });
    expect(await south.deck('shared.pptx', 'for everyone')).toEqual(shared);
    expect(conversions()).toBe(3);
    expect(readdirSync(church).sort()).toEqual(deckFiles(shared).sort());
  });
});

describe('the same image uploaded again', () => {
  const picture = () =>
    sharp({ create: { width: 40, height: 30, channels: 3, background: '#3366cc' } })
      .jpeg()
      .toBuffer();

  it('is kept once when a song uses the first', async () => {
    const { north } = await setup();
    const bytes = await picture();
    const first = await north.image('photo.jpg', bytes);
    north.save('photo', { deck: first });

    const second = await north.image('photo-copy.jpg', bytes);
    expect(second).toEqual({ ...first, source: 'photo-copy.jpg' });
    expect(second.kind).toBe('image');
    expect(north.files()).toEqual(deckFiles(first, '.jpg').sort());
  });

  it('is made again while no song uses the first', async () => {
    const { north } = await setup();
    const bytes = await picture();
    const first = await north.image('photo.jpg', bytes);
    expect(deckId(await north.image('photo.jpg', bytes))).not.toBe(deckId(first));
  });

  it('is found after its original is converted again', async () => {
    const { north } = await setup();
    const bytes = await picture();
    const first = await north.image('photo.jpg', bytes);
    north.save('photo', { deck: first });
    const again = await north.reconvert(first);
    expect(again.kind).toBe('image');
    north.save('photo', { deck: again });
    expect(await north.image('photo.jpg', bytes)).toEqual(again);
  });
});

describe('files kept before uploads were remembered', () => {
  /** Uploads, saves songs, then forgets every hash, as an instance from before this work. */
  const before = async () => {
    const context = await setup();
    const { north, instance } = context;
    const video = await north.video('a.mp4', 'video bytes');
    north.save('video', { video: video.file });
    const deck = await north.deck('talk.pptx', 'pptx bytes');
    north.save('deck', { deck });
    instance.db.exec('DELETE FROM stored_upload');
    return { ...context, video, deck };
  };

  it('hashes a file as an upload is hashed while it arrives', async () => {
    const { north, video } = await before();
    expect(await hashFile(join(north.dir, video.file))).toBe(
      createHash('sha256').update('video bytes').digest('hex'),
    );
  });

  it('are hashed once, and the same files uploaded again are then kept once', async () => {
    const { north, instance, dataDir, video, deck, conversions, remembered } = await before();
    // Not found until the files are hashed.
    const early = await north.video('a.mp4', 'video bytes');
    expect(early.file).not.toBe(video.file);
    rmSync(join(north.dir, early.file));
    instance.db.exec('DELETE FROM stored_upload');

    expect(await backfillStoredUploads(instance, dataDir)).toBe(2);
    expect(remembered().sort()).toEqual([`deck-${deckId(deck)}`, video.file].sort());
    expect((await north.video('a.mp4', 'video bytes')).file).toBe(video.file);
    expect(await north.deck('talk.pptx', 'pptx bytes')).toEqual(deck);
    expect(conversions()).toBe(1);

    // Only once: a later start hashes nothing.
    instance.db.exec('DELETE FROM stored_upload');
    expect(await backfillStoredUploads(instance, dataDir)).toBeNull();
    expect(remembered()).toEqual([]);
  });

  it('covers the Church Library’s files and a deleted song’s, and skips files that are gone', async () => {
    const context = await before();
    const { north, instance, dataDir, church, video, deck, remembered } = context;
    // The deck's song is deleted, and its video's file is gone.
    north.save('deck', { deck }, true);
    rmSync(join(north.dir, video.file));
    // A workspace that manages media keeps a video in the Church Library.
    const managing = context.join('Managing');
    instance.setLibraryTypes(managing.id, ['slides']);
    const shared = await managing.video('b.mp4', 'church bytes');
    managing.save('shared', { video: shared.file });
    instance.db.exec('DELETE FROM stored_upload');

    expect(await backfillStoredUploads(instance, dataDir)).toBe(2);
    expect(remembered().sort()).toEqual([`deck-${deckId(deck)}`, shared.file].sort());
    expect(existsSync(join(church, shared.file))).toBe(true);
    expect((await north.video('b.mp4', 'church bytes')).file).toBe(shared.file);
    // The deleted song's deck is remembered but not handed out until the song is restored.
    expect(deckId(await north.deck('talk.pptx', 'pptx bytes'))).not.toBe(deckId(deck));
  });

  it('leaves an upload that arrived first as it is', async () => {
    const { north, instance, dataDir, deck } = await before();
    const again = await north.reconvert(deck);
    north.save('deck', { deck: again });
    // Both conversions are of the same file; the song uses the newer.
    expect(await backfillStoredUploads(instance, dataDir)).toBe(1);
    expect(await north.deck('talk.pptx', 'pptx bytes')).toEqual(again);
  });
});
