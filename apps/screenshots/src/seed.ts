// Fills a fresh database, the one the app reads during the screenshots, with the content in
// content.ts: the hymns in the library, last Sunday's and this Sunday's run sheets.

import {
  catalogueVersion,
  formatReference,
  fromUsfm,
  passagePlainText,
  type Passage,
} from '@worship-q/bible';
import { migrate, Store } from '@worship-q/store';
import { openNodeDriver, type NodeDriver } from '@worship-q/store/testing';
import { HYMNS, RUN_SHEET } from './content';

/** The fields of the song holding a passage, as the session makes them when one is added. */
function passageSong(passage: Passage) {
  const reference = fromUsfm(passage.reference);
  const language = catalogueVersion(passage.texts[0]?.version ?? '')?.language ?? 'en';
  return {
    title: reference ? formatReference(reference, language) : passage.reference,
    lyrics: passagePlainText(passage),
    passage,
  };
}

let ids = 0;

/** A database seeded for `date` (an ISO day, a Sunday), as of the instant `now`. */
export async function seed(date: string, now: string, timezone: string): Promise<NodeDriver> {
  const driver = openNodeDriver();
  await migrate(driver);
  const store = new Store(driver, {
    now: () => now,
    // Stable ids, so the same content gives the same pictures.
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
  const workspace = await store.ensureWorkspace(timezone);
  await store.setWorkspaceName(workspace.id, 'Sunday Service');

  const songs = new Map<string, string>();
  for (const hymn of HYMNS) {
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
  for (const entry of RUN_SHEET) {
    const songId =
      typeof entry === 'string'
        ? songs.get(entry)
        : (await store.createSong(workspace.id, passageSong(entry))).id;
    if (!songId) throw new Error(`No hymn called ${String(entry)} in content.ts`);
    await store.addItem(sheet.id, songId);
  }

  // Last Sunday too, so the calendar shows weeks of planning.
  const lastWeek = new Date(`${date}T12:00:00Z`);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const earlier = await store.ensureRunSheet(workspace.id, lastWeek.toISOString().slice(0, 10));
  for (const title of ['All Creatures of Our God and King', 'Be Thou My Vision', 'Amazing Grace']) {
    await store.addItem(earlier.id, songs.get(title)!);
  }
  return driver;
}
