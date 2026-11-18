// Fills a fresh database, the one the app reads during the screenshots, with the content in
// content.ts: the hymns in the library, last Sunday's and this Sunday's run sheets, and the
// sermon deck's images and the video's name among this computer's files.

import {
  catalogueVersion,
  formatReference,
  fromUsfm,
  passagePlainText,
  type Passage,
} from '@worship-q/bible';
import { deckLyrics, type Deck, type SongFields } from '@worship-q/protocol';
import { migrate, Store } from '@worship-q/store';
import { openNodeDriver, type NodeDriver } from '@worship-q/store/testing';
import type { Content, Sermon, VideoItem } from './content';
import { SLIDE_HEIGHT, SLIDE_WIDTH, slideImages } from './media';

export interface Seeded {
  driver: NodeDriver;
  /** Stored files by name: the deck's images. */
  files: Map<string, Buffer>;
  /** Videos this computer has a copy of, by file name. */
  videos: Set<string>;
}

/** The fields of the song holding a passage, as the session makes them when one is added. */
function passageSong(passage: Passage): Partial<SongFields> {
  const reference = fromUsfm(passage.reference);
  const language = catalogueVersion(passage.texts[0]?.version ?? '')?.language ?? 'en';
  return {
    title: reference ? formatReference(reference, language) : passage.reference,
    lyrics: passagePlainText(passage),
    passage,
  };
}

/** Stable ids, so the same content gives the same pictures. */
function idMaker() {
  let ids = 0;
  return () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
}

/** A deck's song, as the church server makes it from an upload; its images go in `files`. */
async function sermonSong(
  sermon: Sermon,
  id: string,
  files: Map<string, Buffer>,
): Promise<Partial<SongFields>> {
  const images = await slideImages(sermon.slides);
  const deck: Deck = {
    source: sermon.source,
    kind: 'slides',
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    pages: sermon.slides.map((slide, i) => {
      const image = `deck-${id}-${String(i + 1).padStart(3, '0')}.jpg`;
      files.set(image, images[i]!);
      return { image, slide: i + 1, step: 0, text: [slide.heading, ...slide.lines] };
    }),
  };
  return { title: sermon.title, lyrics: deckLyrics(deck), deck };
}

/** A video's song, as made from an upload, with this computer holding its copy. */
function videoSong(video: VideoItem, id: string, videos: Set<string>): Partial<SongFields> {
  const file = `video-${id}.mp4`;
  videos.add(file);
  return {
    title: video.title,
    lyrics: '',
    video: {
      file,
      source: video.source,
      width: 1920,
      height: 1080,
      durationSeconds: video.durationSeconds,
      bytes: 48_000_000,
      autoplay: false,
    },
  };
}

/** A database seeded with `content` for `date` (an ISO day, a Sunday), as of the instant `now`. */
export async function seed(
  content: Content,
  date: string,
  now: string,
  timezone: string,
): Promise<Seeded> {
  const driver = openNodeDriver();
  await migrate(driver);
  const newId = idMaker();
  const store = new Store(driver, { now: () => now, newId });
  const files = new Map<string, Buffer>();
  const videos = new Set<string>();
  const workspace = await store.ensureWorkspace(timezone);
  await store.setWorkspaceName(workspace.id, content.workspaceName);

  const songs = new Map<string, string>();
  for (const hymn of content.hymns) {
    const song = await store.createSong(workspace.id, {
      title: hymn.title,
      author: hymn.author,
      year: hymn.year,
      lyrics: hymn.lyrics,
      copyright: 'Public domain',
    });
    songs.set(hymn.title, song.id);
  }

  const sheet = await store.ensureRunSheet(workspace.id, date);
  for (const entry of content.runSheet) {
    let songId: string | undefined;
    if (typeof entry === 'string') songId = songs.get(entry);
    else if ('kind' in entry && entry.kind === 'sermon')
      songId = (await store.createSong(workspace.id, await sermonSong(entry, newId(), files))).id;
    else if ('kind' in entry && entry.kind === 'video')
      songId = (await store.createSong(workspace.id, videoSong(entry, newId(), videos))).id;
    else songId = (await store.createSong(workspace.id, passageSong(entry as Passage))).id;
    if (!songId) throw new Error(`No hymn called ${String(entry)} in content.ts`);
    await store.addItem(sheet.id, songId);
  }

  // Last Sunday too, so the calendar shows weeks of planning.
  const lastWeek = new Date(`${date}T12:00:00Z`);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const earlier = await store.ensureRunSheet(workspace.id, lastWeek.toISOString().slice(0, 10));
  for (const title of content.lastWeek) {
    await store.addItem(earlier.id, songs.get(title)!);
  }
  return { driver, files, videos };
}
