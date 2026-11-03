/** Recoverable deletion and the retention sweep (D34), and the storage report (U11). */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SyncRecord } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db';
import { churchFilesDir, workspaceFilesDir } from './files';
import { Instance } from './instance';
import { retentionDaysFromEnv, sweepDeletedFiles } from './retention';
import { classifyFile, prunableDeckIds, storageReport } from './storage';

const DAY = 24 * 60 * 60 * 1000;

function clock(start = '2026-11-02T09:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now).toISOString(), advance: (ms: number) => (now += ms) };
}

const DECK = '11111111-2222-3333-4444-555555555555';

function setup() {
  const time = clock();
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-retention-'));
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const { workspace: managing } = instance.createWorkspace('Managing');
  const { workspace: north } = instance.createWorkspace('North');
  instance.setManageLibrary(managing.id, true);
  const church = churchFilesDir(dataDir);
  const own = workspaceFilesDir(dataDir, north.id);
  mkdirSync(church, { recursive: true });
  mkdirSync(own, { recursive: true });
  const write = (dir: string, name: string, content = 'x') =>
    writeFileSync(join(dir, name), content);
  const stamp = time.now();
  const background = (
    id: string,
    fileName: string,
    removedAt: string | null = null,
  ): SyncRecord => ({
    kind: 'background',
    id,
    key: id,
    revision: removedAt ? 2 : 1,
    updatedAt: stamp,
    data: { kind: 'image', fileName, originalName: fileName, removedAt },
  });
  const deckSong = (id: string, deckId: string): SyncRecord => ({
    kind: 'song',
    id,
    key: id,
    revision: 1,
    updatedAt: stamp,
    data: {
      title: 'Slides',
      lyrics: '',
      removedAt: null,
      deck: {
        source: 'talk.pptx',
        width: 1920,
        height: 1080,
        pages: [
          {
            image: `deck-${deckId}-001.jpg`,
            thumbnail: `deck-${deckId}-001-t.jpg`,
            slide: 1,
            step: 0,
            text: [],
          },
        ],
      },
    },
  });
  return { time, dataDir, instance, managing, north, church, own, write, background, deckSong };
}

describe('the retention sweep (D34)', () => {
  it('removes the files of a church background 90 days after its deletion, and not before', () => {
    const { time, dataDir, instance, managing, church, write, background } = setup();
    instance.push(managing.id, 'd', [background('bg1', 'bg1.jpg')]);
    write(church, 'bg1.jpg');
    expect(instance.deleteChurch('background', 'bg1')).toBe(true);

    time.advance(89 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90)).toEqual({ items: [], files: 0 });
    expect(existsSync(join(church, 'bg1.jpg'))).toBe(true);
    expect(instance.restoreChurch('background', 'bg1')).toBe('restored');
    expect(instance.deleteChurch('background', 'bg1')).toBe(true);

    time.advance(91 * DAY);
    const swept = sweepDeletedFiles(instance, dataDir, 90);
    expect(swept.files).toBe(1);
    expect(swept.items[0]).toMatchObject({ workspaceId: null, kind: 'background', key: 'bg1' });
    expect(existsSync(join(church, 'bg1.jpg'))).toBe(false);
    expect(instance.listChurch('background')[0]!.filesRemovedAt).toBe(time.now());
    expect(instance.restoreChurch('background', 'bg1')).toBe('files-removed');
    // Swept once.
    expect(sweepDeletedFiles(instance, dataDir, 90).items).toEqual([]);
  });

  it('removes a deck’s images, thumbnails and original together', () => {
    const { time, dataDir, instance, managing, church, write, deckSong } = setup();
    instance.push(managing.id, 'd', [deckSong('deck1', DECK)]);
    for (const name of [
      `deck-${DECK}-001.jpg`,
      `deck-${DECK}-001-t.jpg`,
      `deck-${DECK}-original.pptx`,
    ]) {
      write(church, name);
    }
    // Another deck's files are not touched.
    write(church, 'deck-99999999-2222-3333-4444-555555555555-001.jpg');
    instance.deleteChurch('song', 'deck1');
    time.advance(100 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90).files).toBe(3);
    expect(existsSync(join(church, `deck-${DECK}-original.pptx`))).toBe(false);
    expect(existsSync(join(church, 'deck-99999999-2222-3333-4444-555555555555-001.jpg'))).toBe(
      true,
    );
  });

  it('sweeps a workspace’s own deletion from its folder, but never a hidden church item', () => {
    const { time, dataDir, instance, managing, north, church, own, write, background } = setup();
    instance.push(managing.id, 'd', [background('shared', 'shared.jpg')]);
    write(church, 'shared.jpg');
    // North hides the church's background, and removes a background of its own.
    instance.push(north.id, 'n', [
      background('shared', 'shared.jpg', time.now()),
      background('mine', 'mine.jpg', time.now()),
    ]);
    write(own, 'mine.jpg');
    time.advance(100 * DAY);
    const swept = sweepDeletedFiles(instance, dataDir, 90);
    expect(swept.items.map((i) => i.key)).toEqual(['mine']);
    expect(existsSync(join(own, 'mine.jpg'))).toBe(false);
    expect(existsSync(join(church, 'shared.jpg'))).toBe(true);
  });

  it('keeps a deleted church deck’s files while a workspace’s version uses them', () => {
    const { time, dataDir, instance, managing, north, church, write, deckSong } = setup();
    instance.push(managing.id, 'd', [deckSong('deck1', DECK)]);
    for (const name of [
      `deck-${DECK}-001.jpg`,
      `deck-${DECK}-001-t.jpg`,
      `deck-${DECK}-original.pptx`,
    ]) {
      write(church, name);
    }
    // North's own version of the church's deck shares its images.
    const own = deckSong('deck1', DECK);
    instance.push(north.id, 'n', [
      { ...own, revision: 2, data: { ...own.data, title: 'Slides (North)' } },
    ]);
    instance.deleteChurch('song', 'deck1');
    time.advance(100 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90)).toEqual({ items: [], files: 0 });
    expect(existsSync(join(church, `deck-${DECK}-001.jpg`))).toBe(true);
    expect(existsSync(join(church, `deck-${DECK}-original.pptx`))).toBe(true);
    // Still restorable meanwhile.
    expect(instance.listChurch('song')[0]!.filesRemovedAt).toBeNull();

    // North deletes its version too; its files go once that deletion is old enough.
    instance.push(north.id, 'n', [
      {
        ...own,
        revision: 3,
        updatedAt: time.now(),
        data: { ...own.data, title: 'Slides (North)', removedAt: time.now() },
      },
    ]);
    time.advance(10 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90).files).toBe(0);
    time.advance(81 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90).files).toBe(3);
    expect(existsSync(join(church, `deck-${DECK}-001.jpg`))).toBe(false);
    expect(instance.listChurch('song')[0]!.filesRemovedAt).not.toBeNull();
  });

  it('keeps a file another live item names, whatever deleted one also named it', () => {
    const { time, dataDir, instance, managing, church, write, background } = setup();
    instance.push(managing.id, 'd', [background('old', 'same.jpg'), background('new', 'same.jpg')]);
    write(church, 'same.jpg');
    instance.deleteChurch('background', 'old');
    time.advance(100 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90).files).toBe(0);
    expect(existsSync(join(church, 'same.jpg'))).toBe(true);
  });

  it('leaves a lyrics song alone: it has no files', () => {
    const { time, dataDir, instance, managing } = setup();
    instance.push(managing.id, 'd', [
      {
        kind: 'song',
        id: 's',
        key: 's',
        revision: 1,
        updatedAt: time.now(),
        data: { title: 'T', lyrics: 'l', removedAt: null },
      },
    ]);
    instance.deleteChurch('song', 's');
    time.advance(100 * DAY);
    expect(sweepDeletedFiles(instance, dataDir, 90).items).toEqual([]);
    expect(instance.restoreChurch('song', 's')).toBe('restored');
  });

  it('reads the retention period from the environment, never under a day', () => {
    expect(retentionDaysFromEnv({})).toBe(90);
    expect(retentionDaysFromEnv({ WORSHIP_Q_RETENTION_DAYS: '30' })).toBe(30);
    expect(retentionDaysFromEnv({ WORSHIP_Q_RETENTION_DAYS: '0' })).toBe(90);
    expect(retentionDaysFromEnv({ WORSHIP_Q_RETENTION_DAYS: 'soon' })).toBe(90);
  });
});

describe('the storage report (U11)', () => {
  it('classifies files by name', () => {
    expect(classifyFile(`deck-${DECK}-001.jpg`)).toBe('deckImages');
    expect(classifyFile(`deck-${DECK}-001-t.jpg`)).toBe('deckImages');
    expect(classifyFile(`deck-${DECK}-original.key`)).toBe('deckOriginals');
    expect(classifyFile('bg-1.MP4')).toBe('backgroundVideos');
    expect(classifyFile('bg-1.png')).toBe('backgroundImages');
    expect(classifyFile('notes.txt')).toBe('other');
  });

  it('counts deck originals of unused or removed decks as prunable', () => {
    const { time, dataDir, instance, managing, north, church, write, deckSong } = setup();
    const used = '00000000-0000-0000-0000-000000000001';
    const stale = '00000000-0000-0000-0000-000000000002';
    const removed = '00000000-0000-0000-0000-000000000003';
    instance.push(managing.id, 'd', [
      deckSong('used', used),
      deckSong('stale', stale),
      deckSong('gone', removed),
    ]);
    instance.deleteChurch('song', 'gone');
    instance.push(north.id, 'n', [
      {
        kind: 'runSheet',
        id: 'r1',
        key: '2026-10-25',
        revision: 2,
        updatedAt: time.now(),
        data: { date: '2026-10-25', items: [{ id: 'i', songId: 'used' }] },
      },
      {
        kind: 'runSheet',
        id: 'r2',
        key: '2026-01-04',
        revision: 2,
        updatedAt: time.now(),
        data: { date: '2026-01-04', items: [{ id: 'j', songId: 'stale' }] },
      },
    ]);
    expect([...prunableDeckIds(instance, time.now())].sort()).toEqual([stale, removed].sort());
    for (const id of [used, stale, removed]) write(church, `deck-${id}-original.pptx`, 'abcde');
    write(dataDir, 'instance.db', 'dbdbdb');
    const report = storageReport(instance, dataDir, time.now(), () => ({
      bsize: 1024,
      blocks: 100,
      bavail: 40,
    }));
    expect(report.prunableDeckOriginals).toEqual({ bytes: 10, files: 2 });
    expect(report.totals.deckOriginals).toEqual({ bytes: 15, files: 3 });
    expect(report.totals.database).toEqual({ bytes: 6, files: 1 });
    expect(report.volume).toEqual({ freeBytes: 40 * 1024, totalBytes: 100 * 1024 });
    expect(report.workspaces.find((w) => w.id === 'church')?.totals.deckOriginals.files).toBe(3);
  });
});
