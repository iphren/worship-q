/**
 * How much space the instance uses, by kind of file and by workspace (media plan U11). The
 * page is for looking at; nothing here removes anything.
 */
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import {
  VIDEO_FILE,
  type AdminStorage,
  type StorageTotal,
  type StorageType,
} from '@worship-q/protocol';
import { churchFilesDir } from './files';
import type { Instance } from './instance';

const TYPES: StorageType[] = [
  'deckImages',
  'deckOriginals',
  'images',
  'videos',
  'backgroundImages',
  'backgroundVideos',
  'backups',
  'database',
  'other',
];

/** Deck originals of songs not presented in this long are counted as prunable (U5). */
export const PRUNABLE_AFTER_DAYS = 180;

const DECK_ORIGINAL = /^deck-([0-9a-f-]{36})-original\./;
const DECK_IMAGE = /^deck-[0-9a-f-]{36}-\d{3,}(-t)?\.jpg$/;
const DECK_ID = /^deck-([0-9a-f-]{36})-/;

export function emptyTotals(): Record<StorageType, StorageTotal> {
  return Object.fromEntries(TYPES.map((type) => [type, { bytes: 0, files: 0 }])) as Record<
    StorageType,
    StorageTotal
  >;
}

/**
 * What kind of file a name in a files folder is. The images and originals of decks made from
 * an image, named in `imageDecks`, are counted as images.
 */
export function classifyFile(
  name: string,
  imageDecks: ReadonlySet<string> = new Set(),
): StorageType {
  if (VIDEO_FILE.test(name)) return 'videos';
  const deckId = DECK_ID.exec(name)?.[1];
  if (deckId && imageDecks.has(deckId) && (DECK_ORIGINAL.test(name) || DECK_IMAGE.test(name))) {
    return 'images';
  }
  if (DECK_ORIGINAL.test(name)) return 'deckOriginals';
  if (DECK_IMAGE.test(name)) return 'deckImages';
  if (/\.mp4$/i.test(name)) return 'backgroundVideos';
  if (/\.(jpe?g|png)$/i.test(name)) return 'backgroundImages';
  return 'other';
}

function add(totals: Record<StorageType, StorageTotal>, type: StorageType, bytes: number): void {
  totals[type].bytes += bytes;
  totals[type].files += 1;
}

function files(dir: string): { name: string; bytes: number }[] {
  if (!existsSync(dir)) return [];
  const result: { name: string; bytes: number }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat?.isFile()) result.push({ name, bytes: stat.size });
  }
  return result;
}

export function storageReport(
  instance: Instance,
  dataDir: string,
  now: string = instance.now(),
  statfs: (path: string) => {
    bsize: number | bigint;
    blocks: number | bigint;
    bavail: number | bigint;
  } = (path) => statfsSync(path),
): AdminStorage {
  const totals = emptyTotals();
  const workspaces: AdminStorage['workspaces'] = [];
  const prunable = prunableDeckIds(instance, now);
  const imageDecks = imageDeckIds(instance);
  const prunableDeckOriginals: StorageTotal = { bytes: 0, files: 0 };

  const folder = (id: string, name: string, filesDir: string, backupsDir: string | null) => {
    const own = emptyTotals();
    for (const file of files(filesDir)) {
      const type = classifyFile(file.name, imageDecks);
      add(own, type, file.bytes);
      add(totals, type, file.bytes);
      const deckId = DECK_ORIGINAL.exec(file.name)?.[1];
      if (deckId && prunable.has(deckId)) {
        prunableDeckOriginals.bytes += file.bytes;
        prunableDeckOriginals.files += 1;
      }
    }
    if (backupsDir) {
      for (const file of files(backupsDir)) {
        add(own, 'backups', file.bytes);
        add(totals, 'backups', file.bytes);
      }
    }
    workspaces.push({ id, name, totals: own });
  };

  for (const workspace of instance.listWorkspaces()) {
    folder(
      workspace.id,
      workspace.name,
      join(dataDir, 'files', workspace.id),
      join(dataDir, 'backups', workspace.id),
    );
  }
  folder('church', 'Church Library', churchFilesDir(dataDir), null);

  for (const file of files(dataDir)) {
    if (file.name.startsWith('instance.db')) add(totals, 'database', file.bytes);
  }
  // Working folders of conversions, and LibreOffice's settings.
  for (const sub of ['work', 'libreoffice']) {
    for (const file of walk(join(dataDir, sub))) add(totals, 'other', file);
  }

  const volume = statfs(dataDir);
  const bsize = Number(volume.bsize);
  return {
    volume: {
      freeBytes: Number(volume.bavail) * bsize,
      totalBytes: Number(volume.blocks) * bsize,
    },
    totals,
    workspaces,
    prunableDeckOriginals,
  };
}

function walk(dir: string): number[] {
  if (!existsSync(dir)) return [];
  const sizes: number[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) sizes.push(...walk(path));
    else if (stat.isFile()) sizes.push(stat.size);
  }
  return sizes;
}

/** Decks made from an uploaded image (U13), whose files count as images. */
export function imageDeckIds(instance: Instance): Set<string> {
  const ids = new Set<string>();
  for (const { record } of instance.allRecords('song')) {
    const deck = record.data.deck as
      { kind?: unknown; pages?: { image?: unknown }[] } | null | undefined;
    const first = deck?.kind === 'image' ? deck.pages?.[0]?.image : null;
    const id = typeof first === 'string' ? DECK_ID.exec(first)?.[1] : null;
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Decks whose original could go (U5): their song is removed, or is in no run sheet dated
 * within the last `PRUNABLE_AFTER_DAYS` or later.
 */
export function prunableDeckIds(instance: Instance, now: string): Set<string> {
  const since = new Date(Date.parse(now) - PRUNABLE_AFTER_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const latestUse = new Map<string, string>();
  for (const { record } of instance.allRecords('runSheet')) {
    const date = typeof record.data.date === 'string' ? record.data.date : '';
    const items = Array.isArray(record.data.items)
      ? (record.data.items as { songId?: unknown }[])
      : [];
    for (const item of items) {
      if (typeof item.songId !== 'string') continue;
      const known = latestUse.get(item.songId);
      if (!known || date > known) latestUse.set(item.songId, date);
    }
  }
  const prunable = new Set<string>();
  const keep = new Set<string>();
  for (const { record } of instance.allRecords('song')) {
    const deck = record.data.deck as { pages?: { image?: unknown }[] } | null | undefined;
    const first = deck?.pages?.[0]?.image;
    const deckId = typeof first === 'string' ? /^deck-([0-9a-f-]{36})-/.exec(first)?.[1] : null;
    if (!deckId) continue;
    const used = latestUse.get(record.id);
    if (!record.data.removedAt && used && used >= since) keep.add(deckId);
    else prunable.add(deckId);
  }
  for (const id of keep) prunable.delete(id);
  return prunable;
}
