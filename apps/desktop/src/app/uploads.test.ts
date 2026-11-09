import type { Deck, Song, SongFields } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import type { MediaOffer } from './media';
import { MediaUploads, uploadMessage, type UploadDeps, type Upload } from './uploads';

const MB = 1024 * 1024;

interface Sending {
  id: string;
  route: string;
  source: string;
  name: string;
  progress: (sent: number, total: number) => void;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
}

const deckAnswer = (source: string, kind?: 'image'): string =>
  JSON.stringify({
    source,
    ...(kind ? { kind } : {}),
    width: 1440,
    height: 1080,
    pages: [{ image: `deck-${source}-001.jpg`, slide: 1, step: 0, text: ['Hello'] }],
  } satisfies Deck);

const flush = () => new Promise((done) => setTimeout(done, 0));

function harness(
  options: { platform?: string; offer?: MediaOffer | null; sizes?: Record<string, number> } = {},
) {
  let n = 0;
  const sending: Sending[] = [];
  const songs = new Map<string, Song>();
  const runSheets = new Map<string, { id: string; songId: string }[]>();
  const editable = new Set(['2026-11-08']);
  const removedTemps: string[] = [];
  const stored: string[] = [];
  const fetched: string[] = [];
  const cancelledIds: string[] = [];
  const probes: Record<string, { durationSeconds: number; width: number; height: number } | Error> =
    {};
  const sizes: Record<string, number> = { ...options.sizes };
  const offer: MediaOffer | null =
    options.offer === undefined
      ? {
          decks: true,
          images: true,
          videos: true,
          current: true,
          limits: { image: 25 * MB, deck: 200 * MB, video: 200 * MB },
        }
      : options.offer;
  let credentials: { server: string; token: string } | null = { server: 'https://s', token: 't' };
  const song = (fields: Partial<SongFields>, id = `song-${++n}`): Song => ({
    id,
    workspaceId: 'w',
    title: '',
    lyrics: '',
    author: '',
    copyright: '',
    ccli: null,
    year: null,
    background: null,
    deck: null,
    website: null,
    video: null,
    passage: null,
    lineIds: [],
    revision: 1,
    createdAt: '',
    updatedAt: '',
    removedAt: null,
    origin: null,
    useChurchVersion: false,
    versions: null,
    ...fields,
  });
  const deps: UploadDeps = {
    newId: () => `u${++n}`,
    platform: options.platform ?? 'macos',
    offer: () => offer,
    credentials: () => credentials,
    fileSize: async (path) => {
      if (path.includes('missing')) throw new Error('file: not found');
      return sizes[path] ?? 1000;
    },
    convertHeic: async (path) => {
      if (path.includes('damaged')) throw new Error('unreadable');
      return `/tmp/converted/${path
        .split('/')
        .pop()!
        .replace(/\.heic$/i, '.jpg')}`;
    },
    removeConverted: async (path) => {
      removedTemps.push(path);
    },
    probeVideo: async (path) => {
      const probe = probes[path] ?? { durationSeconds: 30, width: 1920, height: 1080 };
      if (probe instanceof Error) throw probe;
      return probe;
    },
    upload: (_credentials, id, route, source, name, progress) =>
      new Promise((resolve, reject) => {
        sending.push({ id, route, source, name, progress, resolve, reject });
      }),
    cancel: async (id) => {
      cancelledIds.push(id);
      sending.find((s) => s.id === id)?.reject(new Error('cancelled'));
    },
    fetchDeckImages: async (_credentials, deck) => {
      if (deck.source.includes('fetch-fails')) throw new Error('server answered 500');
      fetched.push(...deck.pages.map((p) => p.image));
    },
    storeVideo: async (source) => {
      if (source.includes('nocopy')) throw new Error('disk full');
      stored.push(source);
    },
    createSong: async (fields) => {
      const made = song(fields);
      songs.set(made.id, made);
      return made;
    },
    saveSong: async (id, fields) => {
      const saved = { ...songs.get(id)!, ...fields, revision: songs.get(id)!.revision + 1 };
      songs.set(id, saved);
      return saved;
    },
    getSong: async (id) => songs.get(id) ?? null,
    canEdit: (date) => editable.has(date),
    addSong: async (date, songId, afterItemId) => {
      const items = runSheets.get(date) ?? [];
      const item = { id: `item-${++n}`, songId };
      const index =
        afterItemId === null
          ? 0
          : afterItemId === undefined
            ? items.length
            : items.findIndex((i) => i.id === afterItemId) + 1 || items.length;
      items.splice(index, 0, item);
      runSheets.set(date, items);
      return item;
    },
  };
  const uploads = new MediaUploads(deps);
  const stages: string[][] = [];
  uploads.subscribe(() => stages.push(uploads.list.map((u) => u.stage.kind)));
  /** Sends everything of the current upload and answers. */
  const complete = async (answer: string, total = 1000) => {
    await flush();
    const current = sending.at(-1)!;
    current.progress(total, total);
    current.resolve(answer);
    await flush();
    await flush();
  };
  return {
    uploads,
    deps,
    sending,
    songs,
    runSheets,
    editable,
    removedTemps,
    stored,
    fetched,
    cancelledIds,
    probes,
    sizes,
    stages,
    song,
    complete,
    setCredentials: (value: typeof credentials) => (credentials = value),
  };
}

const stageOf = (upload: Upload | undefined) => upload?.stage.kind;

describe('the upload queue (U15, U16)', () => {
  it('takes an image through waiting, uploading and processing to a song', async () => {
    const h = harness();
    const [upload] = h.uploads.add(['/p/Photo.jpg'], { kind: 'library' }).added;
    expect(stageOf(upload)).toBe('waiting');
    await flush();
    const current = h.sending[0]!;
    expect([current.route, current.name]).toEqual(['images', 'Photo.jpg']);
    current.progress(400, 1000);
    expect(h.uploads.list[0]!.stage).toEqual({ kind: 'uploading', sent: 400, total: 1000 });
    current.progress(1000, 1000);
    expect(stageOf(h.uploads.list[0])).toBe('processing');
    current.resolve(deckAnswer('Photo.jpg', 'image'));
    await flush();
    await flush();
    const done = h.uploads.list[0]!.stage;
    expect(done.kind).toBe('done');
    const made = h.songs.get((done as { songId: string }).songId)!;
    expect(made.title).toBe('Photo');
    expect(made.deck?.kind).toBe('image');
    expect(h.fetched).toEqual(['deck-Photo.jpg-001.jpg']);
  });

  it('never shows a video as processing, and keeps a copy here with its size and duration', async () => {
    const h = harness();
    h.probes['/p/Welcome.mp4'] = { durationSeconds: 42.5, width: 1280, height: 720 };
    h.uploads.add(['/p/Welcome.mp4'], { kind: 'library' });
    await h.complete(JSON.stringify({ file: 'video-1.mp4', source: 'Welcome.mp4', bytes: 1000 }));
    expect(h.stages.flat()).not.toContain('processing');
    const done = h.uploads.list[0]!.stage as { kind: 'done'; songId: string };
    expect(h.songs.get(done.songId)!.video).toEqual({
      file: 'video-1.mp4',
      source: 'Welcome.mp4',
      width: 1280,
      height: 720,
      durationSeconds: 42.5,
      bytes: 1000,
      autoplay: false,
    });
    expect(h.stored).toEqual(['/p/Welcome.mp4']);
  });

  it('never moves progress backwards or past the end', async () => {
    const h = harness();
    h.uploads.add(['/p/a.mp4'], { kind: 'library' });
    await flush();
    const current = h.sending[0]!;
    current.progress(600, 1000);
    current.progress(500, 1000);
    expect(h.uploads.list[0]!.stage).toEqual({ kind: 'uploading', sent: 600, total: 1000 });
    current.progress(1200, 1000);
    expect(h.uploads.list[0]!.stage).toEqual({ kind: 'uploading', sent: 1000, total: 1000 });
  });

  it('sends one file at a time, the next once the last byte of the first is sent', async () => {
    const h = harness();
    h.uploads.add(['/p/a.pdf', '/p/b.jpg', '/p/c.mp4'], { kind: 'library' });
    await flush();
    expect(h.sending.map((s) => s.name)).toEqual(['a.pdf']);
    expect(h.uploads.list.map(stageOf)).toEqual(['uploading', 'waiting', 'waiting']);
    h.sending[0]!.progress(1000, 1000);
    await flush();
    // The first is processing on the server while the second is sent.
    expect(h.sending.map((s) => s.name)).toEqual(['a.pdf', 'b.jpg']);
    expect(h.uploads.list.map(stageOf)).toEqual(['processing', 'uploading', 'waiting']);
  });

  it('cancels a waiting upload by removing it, and a sending one by stopping it', async () => {
    const h = harness();
    const { added } = h.uploads.add(['/p/a.mp4', '/p/b.mp4'], { kind: 'library' });
    await flush();
    await h.uploads.cancel(added[1]!.id);
    expect(h.uploads.list.map((u) => u.name)).toEqual(['a.mp4']);
    await h.uploads.cancel(added[0]!.id);
    await flush();
    expect(h.cancelledIds).toEqual([added[0]!.id]);
    expect(h.uploads.list).toEqual([]);
    expect(h.songs.size).toBe(0);
  });

  it('offers no cancel while processing', async () => {
    const h = harness();
    const { added } = h.uploads.add(['/p/a.pdf'], { kind: 'library' });
    await flush();
    h.sending[0]!.progress(1000, 1000);
    expect(MediaUploads.cancellable(h.uploads.list[0]!)).toBe(false);
    await h.uploads.cancel(added[0]!.id);
    expect(h.cancelledIds).toEqual([]);
    expect(stageOf(h.uploads.list[0])).toBe('processing');
  });

  it('fails with a readable reason, creating nothing, while sending, processing or fetching', async () => {
    const h = harness();
    h.uploads.add(['/p/a.pdf', '/p/fetch-fails.pdf', '/p/c.mp4'], { kind: 'library' });
    await flush();
    h.sending[0]!.reject(new Error('refused:This deck could not be converted.'));
    await flush();
    await h.complete(deckAnswer('fetch-fails.pdf'));
    await flush();
    h.sending[2]!.reject(new Error('connection-closed'));
    await flush();
    expect(h.uploads.list.map((u) => (u.stage as { message?: string }).message)).toEqual([
      'This deck could not be converted.',
      'Could not add the file: server answered 500',
      expect.stringContaining('The connection closed while sending.'),
    ]);
    expect(h.songs.size).toBe(0);
  });

  it('sends a failed upload again from the start, to the same target, with Try again', async () => {
    const h = harness();
    const target = { kind: 'runSheet' as const, date: '2026-11-08' };
    const { added } = h.uploads.add(['/p/a.jpg'], target);
    await flush();
    h.sending[0]!.reject(new Error('connection-closed'));
    await flush();
    h.uploads.retry(added[0]!.id);
    await h.complete(deckAnswer('a.jpg', 'image'));
    expect(h.sending).toHaveLength(2);
    expect(stageOf(h.uploads.list[0])).toBe('done');
    expect(h.runSheets.get('2026-11-08')).toHaveLength(1);
  });

  it('says so when the file was moved before Try again', async () => {
    const h = harness();
    h.uploads.add(['/p/missing.jpg'], { kind: 'library' });
    await flush();
    await flush();
    expect(h.uploads.list[0]!.stage).toEqual({
      kind: 'failed',
      message: 'The file is no longer at /p/missing.jpg.',
    });
  });

  it('dismisses a failed entry and nothing else', async () => {
    const h = harness();
    const { added } = h.uploads.add(['/p/missing.jpg', '/p/b.mp4'], { kind: 'library' });
    await flush();
    await flush();
    h.uploads.dismiss(added[1]!.id);
    expect(h.uploads.list).toHaveLength(2);
    h.uploads.dismiss(added[0]!.id);
    expect(h.uploads.list.map((u) => u.name)).toEqual(['b.mp4']);
  });

  it('fails every waiting upload with the sign-in message when the device was revoked', async () => {
    const h = harness();
    h.uploads.add(['/p/a.jpg', '/p/b.jpg', '/p/c.jpg'], { kind: 'library' });
    await flush();
    h.sending[0]!.reject(new Error('unauthorized'));
    await flush();
    expect(h.sending).toHaveLength(1);
    expect(h.uploads.list.map(stageOf)).toEqual(['failed', 'failed', 'failed']);
    expect((h.uploads.list[2]!.stage as { message: string }).message).toContain(
      'no longer connected',
    );
  });

  it('refuses a file over its limit, or empty, before anything is sent', async () => {
    const h = harness({ sizes: { '/p/big.mp4': 201 * MB, '/p/empty.jpg': 0 } });
    h.uploads.add(['/p/big.mp4', '/p/empty.jpg'], { kind: 'library' });
    await flush();
    await flush();
    expect(h.sending).toEqual([]);
    expect(h.uploads.list.map((u) => (u.stage as { message: string }).message)).toEqual([
      'This video is 201 MB; this server accepts up to 200 MB. Export a smaller version and try again.',
      'This file is empty.',
    ]);
  });

  it('refuses images and videos on a server from before them', async () => {
    const h = harness({
      offer: {
        decks: true,
        images: false,
        videos: false,
        current: false,
        limits: { image: 0, deck: 2048 * MB, video: 0 },
      },
    });
    h.uploads.add(['/p/a.jpg', '/p/b.pptx'], { kind: 'library' });
    await flush();
    await flush();
    expect((h.uploads.list[0]!.stage as { message: string }).message).toBe(
      'Images and videos need an update of your church’s server.',
    );
    expect(h.sending.map((s) => s.name)).toEqual(['b.pptx']);
  });

  it('uses the server’s limit when it refuses a file as too large', () => {
    expect(uploadMessage(new Error('too-large:52428800'), 'video', '/p/a.mp4', 60 * MB)).toBe(
      'This video is 60 MB; this server accepts up to 50 MB. Export a smaller version and try again.',
    );
    expect(uploadMessage(new Error('proxy-too-large'), 'video', '/p/a.mp4')).toContain('proxy');
  });

  it('refuses a video this computer cannot play, sending nothing', async () => {
    const h = harness();
    h.probes['/p/av1.webm'] = new Error('timed out');
    h.probes['/p/prores.mov'] = { durationSeconds: 10, width: 0, height: 0 };
    h.uploads.add(['/p/av1.webm', '/p/prores.mov'], { kind: 'library' });
    await flush();
    await flush();
    expect(h.sending).toEqual([]);
    for (const upload of h.uploads.list) {
      expect((upload.stage as { message: string }).message).toBe(
        'This computer cannot play this video. Export it as MP4 (H.264) and try again.',
      );
    }
  });

  it('fails a video whose copy could not be kept, creating no song', async () => {
    const h = harness();
    h.uploads.add(['/p/nocopy.mp4'], { kind: 'library' });
    await h.complete(JSON.stringify({ file: 'video-1.mp4', source: 'nocopy.mp4', bytes: 1 }));
    expect(stageOf(h.uploads.list[0])).toBe('failed');
    expect(h.songs.size).toBe(0);
  });

  it('titles items after their files; two files of the same name make two items', async () => {
    const h = harness();
    h.uploads.add(['/a/Notice.jpg', '/b/Notice.jpg'], { kind: 'library' });
    await h.complete(deckAnswer('Notice.jpg', 'image'));
    await h.complete(deckAnswer('Notice.jpg', 'image'));
    expect([...h.songs.values()].map((s) => s.title)).toEqual(['Notice', 'Notice']);
  });

  it('leaves out files Worship Q cannot show, and names them', () => {
    const h = harness();
    const { added, refused } = h.uploads.add(['/p/a.jpg', '/p/notes.txt', '/p/folder'], {
      kind: 'library',
    });
    expect(added.map((u) => u.name)).toEqual(['a.jpg']);
    expect(refused).toEqual(['notes.txt', 'folder']);
  });
});

describe('placing uploads in a run sheet (U16, U17)', () => {
  const date = '2026-11-08';

  it('lands after the item it was dropped below', async () => {
    const h = harness();
    h.runSheets.set(date, [
      { id: 'one', songId: 's1' },
      { id: 'two', songId: 's2' },
    ]);
    h.uploads.add(['/p/a.jpg'], { kind: 'runSheet', date, afterItemId: 'one' });
    await h.complete(deckAnswer('a.jpg', 'image'));
    expect(h.runSheets.get(date)!.map((i) => i.id)[1]).toMatch(/^item-/);
  });

  it('lands uploads aimed at one place in the order added, whichever finishes first', async () => {
    const h = harness();
    h.runSheets.set(date, [
      { id: 'one', songId: 's1' },
      { id: 'two', songId: 's2' },
    ]);
    h.uploads.add(['/p/first.pdf', '/p/second.pdf'], {
      kind: 'runSheet',
      date,
      afterItemId: 'one',
    });
    await flush();
    const first = h.sending[0]!;
    first.progress(1000, 1000);
    await flush();
    // The second finishes first.
    const second = h.sending[1]!;
    second.progress(1000, 1000);
    second.resolve(deckAnswer('second.pdf'));
    await flush();
    await flush();
    first.resolve(deckAnswer('first.pdf'));
    await flush();
    await flush();
    const titles = h.runSheets
      .get(date)!
      .map((i) => (i.id.startsWith('item-') ? h.songs.get(i.songId)!.title : i.id));
    expect(titles).toEqual(['one', 'first', 'second', 'two']);
  });

  it('lands uploads in the order added when the first finishes first too', async () => {
    const h = harness();
    h.runSheets.set(date, [{ id: 'one', songId: 's1' }]);
    h.uploads.add(['/p/first.jpg', '/p/second.jpg'], { kind: 'runSheet', date, afterItemId: null });
    await h.complete(deckAnswer('first.jpg', 'image'));
    await h.complete(deckAnswer('second.jpg', 'image'));
    const titles = h.runSheets
      .get(date)!
      .map((i) => (i.id.startsWith('item-') ? h.songs.get(i.songId)!.title : i.id));
    expect(titles).toEqual(['first', 'second', 'one']);
  });

  it('keeps the media in the library when the run sheet can no longer be edited', async () => {
    const h = harness();
    h.editable.clear();
    h.uploads.add(['/p/a.jpg'], { kind: 'runSheet', date });
    await h.complete(deckAnswer('a.jpg', 'image'));
    const stage = h.uploads.list[0]!.stage as { kind: 'done'; songId: string; note: string };
    expect(h.songs.has(stage.songId)).toBe(true);
    expect(stage.note).toContain('not to the run sheet');
    expect(h.runSheets.get(date)).toBeUndefined();
  });
});

describe('new versions (U26)', () => {
  it('saves a new deck as a revision of the same song, keeping its title', async () => {
    const h = harness();
    const old = h.song({ title: 'Notices', deck: JSON.parse(deckAnswer('old.pptx')) }, 'notices');
    h.songs.set(old.id, old);
    h.uploads.add(['/p/Notices v2.pdf'], { kind: 'newVersion', songId: 'notices' });
    await h.complete(deckAnswer('Notices v2.pdf'));
    const saved = h.songs.get('notices')!;
    expect(h.songs.size).toBe(1);
    expect(saved.title).toBe('Notices');
    expect(saved.revision).toBe(2);
    expect(saved.deck?.source).toBe('Notices v2.pdf');
  });

  it('keeps a video’s Autoplay, and refuses anything but a video for it', async () => {
    const h = harness();
    const video = {
      file: 'video-old.mp4',
      source: 'old.mp4',
      width: 1,
      height: 1,
      durationSeconds: 1,
      bytes: 1,
      autoplay: true,
    };
    h.songs.set('v', h.song({ title: 'Welcome', video }, 'v'));
    h.uploads.add(['/p/new.jpg'], { kind: 'newVersion', songId: 'v' });
    await flush();
    await flush();
    expect((h.uploads.list[0]!.stage as { message: string }).message).toBe(
      'A video item can only be replaced by another video.',
    );
    h.uploads.add(['/p/new.mp4'], { kind: 'newVersion', songId: 'v' });
    await h.complete(JSON.stringify({ file: 'video-new.mp4', source: 'new.mp4', bytes: 9 }));
    expect(h.songs.get('v')!.video).toMatchObject({ file: 'video-new.mp4', autoplay: true });
    expect(h.songs.get('v')!.title).toBe('Welcome');
  });

  it('changes nothing when it fails, and recreates nothing when the item was deleted', async () => {
    const h = harness();
    h.songs.set('n', h.song({ title: 'N', deck: JSON.parse(deckAnswer('n.pptx')) }, 'n'));
    h.uploads.add(['/p/a.pdf'], { kind: 'newVersion', songId: 'n' });
    await flush();
    h.sending[0]!.reject(new Error('connection-closed'));
    await flush();
    expect(h.songs.get('n')!.revision).toBe(1);
    h.songs.delete('n');
    h.uploads.add(['/p/b.pdf'], { kind: 'newVersion', songId: 'n' });
    await h.complete(deckAnswer('b.pdf'));
    expect(h.songs.size).toBe(0);
    expect(h.uploads.list[1]!.stage).toEqual({ kind: 'done', songId: null });
  });
});

describe('HEIC photos (U25)', () => {
  it('converts on a Mac, sends a JPEG named after the photo, and deletes the temporary file', async () => {
    const h = harness();
    h.uploads.add(['/p/IMG_0001.HEIC'], { kind: 'library' });
    await flush();
    await flush();
    expect(h.sending[0]).toMatchObject({
      route: 'images',
      source: '/tmp/converted/IMG_0001.jpg',
      name: 'IMG_0001.jpg',
    });
    await h.complete(deckAnswer('IMG_0001.jpg', 'image'));
    expect(h.removedTemps).toEqual(['/tmp/converted/IMG_0001.jpg']);
    const done = h.uploads.list[0]!.stage as { songId: string };
    expect(h.songs.get(done.songId)!.title).toBe('IMG_0001');
  });

  it('deletes the temporary file after a failure or cancel too', async () => {
    const h = harness();
    const { added } = h.uploads.add(['/p/a.heic', '/p/b.heic'], { kind: 'library' });
    await flush();
    await flush();
    h.sending[0]!.reject(new Error('connection-closed'));
    await flush();
    await flush();
    await h.uploads.cancel(added[1]!.id);
    await flush();
    expect(h.removedTemps).toEqual(['/tmp/converted/a.jpg', '/tmp/converted/b.jpg']);
  });

  it('says when a photo cannot be read, sending nothing', async () => {
    const h = harness();
    h.uploads.add(['/p/damaged.heic'], { kind: 'library' });
    await flush();
    await flush();
    expect(h.sending).toEqual([]);
    expect((h.uploads.list[0]!.stage as { message: string }).message).toBe(
      'This photo could not be read.',
    );
  });

  it('refuses HEIC on Windows before sending', async () => {
    const h = harness({ platform: 'windows' });
    h.uploads.add(['C:\\p\\IMG.heic'], { kind: 'library' });
    await flush();
    await flush();
    expect(h.sending).toEqual([]);
    expect((h.uploads.list[0]!.stage as { message: string }).message).toContain(
      'This computer cannot read HEIC photos.',
    );
  });
});
