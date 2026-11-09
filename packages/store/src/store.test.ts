import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPieces } from '@worship-q/lyrics';
import { createLiveState } from '@worship-q/live-state';
import {
  BackgroundAssetSchema,
  LIBRARY_TYPES,
  OutputProfileSchema,
  RunSheetItemSchema,
  RunSheetSchema,
  SongRevisionSchema,
  SongSchema,
  WorkspaceSchema,
} from '@worship-q/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  migrate,
  MIGRATIONS,
  NewerDatabaseError,
  SCHEMA_VERSION,
  schemaVersion,
} from './migrations';
import { songBackgroundKey, songPinKey, Store } from './store';
import { SyncStore } from './sync';
import {
  createTestEnv,
  createTestStore,
  openNodeDriver,
  type NodeDriver,
  type TestEnv,
} from './testing';

let driver: NodeDriver;
let env: TestEnv;
let store: Store;
let workspaceId: string;

beforeEach(async () => {
  ({ driver, env, store } = await createTestStore());
  workspaceId = (await store.ensureWorkspace('Europe/London')).id;
});
afterEach(() => driver.close());

describe('migrations', () => {
  it('creates the schema on an empty database', async () => {
    expect(await schemaVersion(driver)).toBe(SCHEMA_VERSION);
    const tables = await driver.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    expect(tables.map((t) => t.name)).toEqual([
      'background_asset',
      'church_setting',
      'church_version',
      'live_state',
      'output_profile',
      'remote_grant',
      'run_sheet',
      'run_sheet_item',
      'setting',
      'song',
      'song_revision',
      'song_search',
      'sync_state',
      'workspace',
    ]);
  });

  it('is safe to run again', async () => {
    await migrate(driver);
    expect(await schemaVersion(driver)).toBe(SCHEMA_VERSION);
  });

  it('upgrades an existing database and keeps its data', async () => {
    const song = await store.createSong(workspaceId, { title: 'Kept', lyrics: 'a\nb' });
    const upgraded = [
      ...MIGRATIONS,
      {
        version: SCHEMA_VERSION + 1,
        statements: [`ALTER TABLE song ADD COLUMN tempo INTEGER NOT NULL DEFAULT 0`],
      },
    ];
    expect(await migrate(driver, upgraded)).toBe(SCHEMA_VERSION + 1);
    expect(await schemaVersion(driver)).toBe(SCHEMA_VERSION + 1);
    const rows = await driver.select<{ title: string; tempo: number }>(
      'SELECT title, tempo FROM song WHERE id = ?',
      [song.id],
    );
    expect(rows).toEqual([{ title: 'Kept', tempo: 0 }]);
  });

  it('applies a migration completely or not at all', async () => {
    const broken = [
      ...MIGRATIONS,
      {
        version: SCHEMA_VERSION + 1,
        statements: [`CREATE TABLE half_done (id TEXT)`, `THIS IS NOT SQL`],
      },
    ];
    await expect(migrate(driver, broken)).rejects.toThrow();
    expect(await schemaVersion(driver)).toBe(SCHEMA_VERSION);
    const tables = await driver.select(`SELECT name FROM sqlite_master WHERE name = 'half_done'`);
    expect(tables).toEqual([]);
  });

  it('refuses a database from a newer version of the app', async () => {
    await driver.batch([{ sql: `PRAGMA user_version = ${SCHEMA_VERSION + 5}` }]);
    await expect(migrate(driver)).rejects.toBeInstanceOf(NewerDatabaseError);
  });
});

describe('workspace', () => {
  it('is created on first run with Sunday and the computer timezone', async () => {
    const workspace = (await store.getWorkspace())!;
    expect(workspace.meetingDays).toEqual([0]);
    expect(workspace.timezone).toBe('Europe/London');
    expect(workspace.revision).toBe(1);
    expect(() => WorkspaceSchema.parse(workspace)).not.toThrow();
  });

  it('is created only once', async () => {
    const again = await store.ensureWorkspace('Asia/Shanghai');
    expect(again.id).toBe(workspaceId);
    expect(again.timezone).toBe('Europe/London');
    expect(await driver.select('SELECT id FROM workspace')).toHaveLength(1);
  });

  it('keeps the actual meeting-day selection, including none and all', async () => {
    expect((await store.setMeetingDays(workspaceId, [])).meetingDays).toEqual([]);
    expect((await store.setMeetingDays(workspaceId, [6, 0, 3, 3])).meetingDays).toEqual([0, 3, 6]);
    const all = await store.setMeetingDays(workspaceId, [0, 1, 2, 3, 4, 5, 6]);
    expect(all.meetingDays).toHaveLength(7);
    expect(all.revision).toBe(4);
  });
});

describe('songs', () => {
  it('creates a song with identifiers, a revision and one line id per source line', async () => {
    const song = await store.createSong(workspaceId, {
      title: 'Amazing Grace',
      lyrics: 'Amazing grace\n奇异恩典\n\nHow sweet the sound',
      author: 'John Newton',
      copyright: 'Public domain',
    });
    expect(() => SongSchema.parse(song)).not.toThrow();
    expect(song.revision).toBe(1);
    expect(song.lineIds).toHaveLength(3);
    expect(await store.getSong(song.id)).toEqual(song);

    const revisions = await store.listSongRevisions(song.id);
    expect(revisions).toHaveLength(1);
    expect(() => SongRevisionSchema.parse(revisions[0])).not.toThrow();
    expect(revisions[0]).toMatchObject({
      revision: 1,
      lyrics: song.lyrics,
      title: 'Amazing Grace',
    });
  });

  it('stores lyrics exactly as entered', async () => {
    const lyrics = '  spaced  \r\n\r\n\r\nline two\t\n';
    const song = await store.createSong(workspaceId, { title: 'Raw', lyrics });
    expect((await store.getSong(song.id))!.lyrics).toBe(lyrics);
  });

  it('saves each edit as a new revision', async () => {
    const song = await store.createSong(workspaceId, { title: 'Song', lyrics: 'a\nb' });
    env.advance(1000);
    const edited = await store.updateSong(song.id, { lyrics: 'a\nb\nc' });
    const retitled = await store.updateSong(song.id, { title: 'Renamed' });

    expect(edited.revision).toBe(2);
    expect(retitled).toMatchObject({ revision: 3, title: 'Renamed', lyrics: 'a\nb\nc' });
    expect(edited.updatedAt).not.toBe(song.updatedAt);
    expect(
      (await store.listSongRevisions(song.id)).map((r) => [r.revision, r.title, r.lyrics]),
    ).toEqual([
      [1, 'Song', 'a\nb'],
      [2, 'Song', 'a\nb\nc'],
      [3, 'Renamed', 'a\nb\nc'],
    ]);
  });

  it('numbers an edit after every revision kept, when the song is behind them', async () => {
    // As after a sync: a copy from another device, edited later but fewer times, wins and
    // lowers the song's revision; the revisions numbered above it are kept.
    const song = await store.createSong(workspaceId, { title: 'Song', lyrics: 'a' });
    await store.updateSong(song.id, { lyrics: 'b' });
    await store.updateSong(song.id, { lyrics: 'c' });
    await driver.batch([{ sql: 'UPDATE song SET revision = 1 WHERE id = ?', params: [song.id] }]);

    const edited = await store.updateSong(song.id, { lyrics: 'd' });

    expect(edited.revision).toBe(4);
    expect((await store.listSongRevisions(song.id)).map((r) => r.revision)).toEqual([1, 2, 3, 4]);
  });

  it('creates no revision when nothing changed', async () => {
    const song = await store.createSong(workspaceId, { title: 'Song', lyrics: 'a' });
    const same = await store.updateSong(song.id, { title: 'Song', lyrics: 'a' });
    expect(same.revision).toBe(1);
    expect(await store.listSongRevisions(song.id)).toHaveLength(1);
  });

  it('keeps piece identities of earlier lines when a later line is edited', async () => {
    const song = await store.createSong(workspaceId, { title: 'S', lyrics: 'a\nb\n\nc\nd' });
    const edited = await store.updateSong(song.id, { lyrics: 'a\nb\n\nc\nd changed\ne' });
    const before = buildPieces(song.lyrics, song.lineIds, 2);
    const after = buildPieces(edited.lyrics, edited.lineIds, 2);
    expect(after.slice(0, 2).map((p) => p.id)).toEqual(before.map((p) => p.id));
    expect(new Set(edited.lineIds).size).toBe(edited.lineIds.length);
  });

  it('rejects an edit to a song that does not exist', async () => {
    await expect(store.updateSong('missing', { title: 'x' })).rejects.toThrow();
  });

  it('lists songs by title, ignoring case', async () => {
    for (const title of ['banana', 'Apple', 'cherry'])
      await store.createSong(workspaceId, { title });
    expect((await store.listSongs(workspaceId)).map((s) => s.title)).toEqual([
      'Apple',
      'banana',
      'cherry',
    ]);
  });

  describe('search', () => {
    beforeEach(async () => {
      await store.createSong(workspaceId, {
        title: 'Amazing Grace',
        lyrics: 'Amazing grace, how sweet the sound\n奇异恩典，何等甘甜',
      });
      await store.createSong(workspaceId, {
        title: '你真伟大',
        lyrics: 'How great Thou art\n我灵歌唱，赞美救主我神',
      });
      await store.createSong(workspaceId, { title: '100% Faithful', lyrics: 'snake_case line' });
    });

    const search = async (term: string) =>
      (await store.listSongs(workspaceId, term)).map((s) => s.title);

    it('finds by a word in the title', async () => {
      expect(await search('grace')).toEqual(['Amazing Grace']);
    });

    it('finds by a word in the lyrics', async () => {
      expect(await search('sweet')).toEqual(['Amazing Grace']);
      expect(await search('great')).toEqual(['你真伟大']);
    });

    it('finds Chinese text in the title and in the lyrics', async () => {
      expect(await search('伟大')).toEqual(['你真伟大']);
      expect(await search('恩典')).toEqual(['Amazing Grace']);
      expect(await search('赞美救主')).toEqual(['你真伟大']);
    });

    it('requires every word to match', async () => {
      expect(await search('amazing 甘甜')).toEqual(['Amazing Grace']);
      expect(await search('amazing 伟大')).toEqual([]);
    });

    it('ignores letter case and surrounding spaces', async () => {
      expect(await search('  AMAZING  ')).toEqual(['Amazing Grace']);
    });

    it('treats punctuation in the search as a space', async () => {
      expect(await search('100%')).toEqual(['100% Faithful']);
      expect(await search('snake_case')).toEqual(['100% Faithful']);
      expect(await search('grace,sweet')).toEqual(['Amazing Grace']);
    });

    it('ignores spaces and punctuation in the song', async () => {
      expect(await search('奇异恩典何等甘甜')).toEqual(['Amazing Grace']);
      expect(await search('gracehow')).toEqual(['Amazing Grace']);
    });

    it('returns everything for an empty search', async () => {
      expect(await search('   ')).toHaveLength(3);
      expect(await search(' %, ')).toHaveLength(3);
    });

    it('finds Simplified text from Traditional and the other way round', async () => {
      expect(await search('偉大')).toEqual(['你真伟大']);
      expect(await search('讚美救主')).toEqual(['你真伟大']);
    });

    it('finds by pinyin and by pinyin initials', async () => {
      expect(await search('weida')).toEqual(['你真伟大']);
      expect(await search('nzwd')).toEqual(['你真伟大']);
      expect(await search('zmjz')).toEqual(['你真伟大']);
      expect(await search('qyed')).toEqual(['Amazing Grace']);
      expect(await search('hsts')).toEqual(['Amazing Grace']);
    });

    it('finds a word typed with the wrong character of the same sound', async () => {
      expect(await search('恩点')).toEqual(['Amazing Grace']);
    });

    it('ranks the title above the lyrics and the same characters above the same sound', async () => {
      await store.createSong(workspaceId, { title: '恩典之路', lyrics: '' });
      await store.createSong(workspaceId, { title: '恩点', lyrics: '' });
      await store.createSong(workspaceId, { title: '感谢', lyrics: '是你的恩典' });
      expect(await search('恩典')).toEqual(['恩典之路', '恩点', 'Amazing Grace', '感谢']);
    });

    it('reads 祢 and 祂 as 你 and 他', async () => {
      await store.createSong(workspaceId, { title: '祢是我的神', lyrics: '在祂怀中' });
      expect(await search('你是我的神')).toEqual(['祢是我的神']);
      expect(await search('在他怀中')).toEqual(['祢是我的神']);
      expect(await search('nishiwo')).toEqual(['祢是我的神']);
    });

    it('keeps search keys up to date when a song is edited', async () => {
      const song = await store.createSong(workspaceId, { title: '旧名', lyrics: '' });
      await store.updateSong(song.id, { title: '新名' });
      expect(await search('旧名')).toEqual([]);
      expect(await search('xinming')).toEqual(['新名']);
    });

    it('rebuilds missing and outdated search keys', async () => {
      await driver.batch([{ sql: 'DELETE FROM song_search' }]);
      expect(await search('weida')).toEqual([]);
      expect(await store.refreshSearchIndex()).toBe(3);
      expect(await search('weida')).toEqual(['你真伟大']);
      await driver.batch([{ sql: 'UPDATE song_search SET version = 0' }]);
      expect(await store.refreshSearchIndex()).toBe(3);
      expect(await store.refreshSearchIndex()).toBe(0);
      expect(await search('3')).toHaveLength(0);
    });
  });

  it('keeps the CCLI number and year with each revision', async () => {
    const song = await store.createSong(workspaceId, {
      title: 'Thy Word',
      ccli: '14301',
      year: 1984,
    });
    expect(song).toMatchObject({ ccli: '14301', year: 1984 });
    const updated = await store.updateSong(song.id, { year: 1983 });
    expect(updated.revision).toBe(2);
    expect(await store.getSong(song.id)).toMatchObject({ ccli: '14301', year: 1983 });
    expect((await store.listSongRevisions(song.id)).map((r) => [r.ccli, r.year])).toEqual([
      ['14301', 1984],
      ['14301', 1983],
    ]);
  });

  it("keeps a song's own background with each revision", async () => {
    const song = await store.createSong(workspaceId, { title: 'Song' });
    expect(song.background).toBeNull();
    const background = { color: '#336699', assetId: 'bg' };
    const updated = await store.updateSong(song.id, { background });
    expect(updated.revision).toBe(2);
    expect((await store.getSong(song.id))!.background).toEqual(background);
    expect(await store.updateSong(song.id, { background: { ...background } })).toMatchObject({
      revision: 2,
    });
    await store.updateSong(song.id, { background: null });
    expect((await store.listSongRevisions(song.id)).map((r) => r.background)).toEqual([
      null,
      background,
      null,
    ]);
  });

  it('records a song without CCLI number or year as having none', async () => {
    const song = await store.createSong(workspaceId, { title: 'Plain' });
    expect(await store.getSong(song.id)).toMatchObject({ ccli: null, year: null });
  });

  it('rejects an invalid CCLI number or year', async () => {
    await expect(store.createSong(workspaceId, { title: 'Bad', ccli: 'abc' })).rejects.toThrow(
      /ccli/,
    );
    await expect(store.createSong(workspaceId, { title: 'Bad', year: 20155 })).rejects.toThrow(
      /year/,
    );
    const song = await store.createSong(workspaceId, { title: 'Old', year: 2027 });
    await expect(store.updateSong(song.id, { year: 2028 })).rejects.toThrow(/year/);
    expect(await store.listSongs(workspaceId)).toHaveLength(1);
  });

  it('removes a song from the library but keeps it resolvable', async () => {
    const song = await store.createSong(workspaceId, { title: 'Gone', lyrics: 'still here' });
    await store.removeSong(song.id);

    expect(await store.listSongs(workspaceId)).toEqual([]);
    expect(await store.listSongs(workspaceId, 'gone')).toEqual([]);
    const removed = (await store.getSong(song.id))!;
    expect(removed.removedAt).not.toBeNull();
    expect(removed.lyrics).toBe('still here');
    expect(removed.revision).toBe(2);
  });

  it('reports which dates use a song', async () => {
    const song = await store.createSong(workspaceId, { title: 'Used' });
    const first = await store.ensureRunSheet(workspaceId, '2026-10-18');
    const second = await store.ensureRunSheet(workspaceId, '2026-10-11');
    await store.addItem(first.id, song.id);
    await store.addItem(second.id, song.id);
    await store.addItem(second.id, song.id);
    expect(await store.songUsage(song.id)).toEqual(['2026-10-11', '2026-10-18']);
    expect(await store.songUsage('unused')).toEqual([]);
  });
});

describe('two versions of a song (D31, D32)', () => {
  /** A song as a version 3 instance's pull marks it: the church's. */
  async function churchSong(title = 'Church Song', lyrics = 'church line') {
    const song = await store.createSong(workspaceId, { title, lyrics });
    await driver.batch([
      { sql: `UPDATE song SET origin = 'church' WHERE id = ?`, params: [song.id] },
    ]);
    return (await store.getSong(song.id))!;
  }

  it('starts with no origin on a computer without a church', async () => {
    const song = await store.createSong(workspaceId, { title: 'Mine' });
    expect(song).toMatchObject({ origin: null, useChurchVersion: false, versions: null });
    expect(await store.getSong(song.id)).toMatchObject({ origin: null, versions: null });
  });

  it('makes the workspace’s version on editing a church song, keeping the church’s beside it', async () => {
    const song = await churchSong();
    env.advance(1000);
    const edited = await store.updateSong(song.id, { lyrics: 'our line' });
    expect(edited).toMatchObject({
      origin: 'workspace',
      useChurchVersion: false,
      lyrics: 'our line',
      revision: 2,
    });
    expect(edited.versions).toEqual({
      own: { revision: 2, updatedAt: env.now() },
      church: { revision: 1, updatedAt: song.updatedAt },
    });
    expect(await store.getChurchVersion(song.id)).toMatchObject({
      lyrics: 'church line',
      revision: 1,
      origin: 'church',
    });
    // Saving nothing new makes no version.
    const other = await churchSong('Untouched');
    expect((await store.updateSong(other.id, { title: 'Untouched' })).origin).toBe('church');
  });

  it('clears a workspace’s songs with their church versions, to take the church’s copy', async () => {
    const song = await churchSong();
    env.advance(1000);
    await store.updateSong(song.id, { lyrics: 'our line' });
    expect(await store.getChurchVersion(song.id)).not.toBeNull();
    await new SyncStore(store).clearContent(workspaceId);
    expect(await store.listSongs(workspaceId)).toEqual([]);
    expect(await store.getChurchVersion(song.id)).toBeNull();
  });

  it('makes a version of a church deck when the workspace manages only songs', async () => {
    store.managedLibraryTypes = new Set(['songs']);
    const deck = {
      source: 'a.pptx',
      width: 16,
      height: 9,
      pages: [{ image: 'deck-1-001.jpg', slide: 1, step: 0, text: [] }],
    };
    const slides = await store.createSong(workspaceId, { title: 'Notices', deck });
    expect(slides.origin).toBeNull();
    await driver.batch([
      { sql: `UPDATE song SET origin = 'church' WHERE id = ?`, params: [slides.id] },
    ]);
    env.advance(1000);
    expect((await store.updateSong(slides.id, { title: 'Ours' })).origin).toBe('workspace');
    // A song of lyrics is still edited in place, and a new one is the church's.
    const song = await churchSong();
    expect((await store.updateSong(song.id, { lyrics: 'x' })).origin).toBe('church');
    expect((await store.createSong(workspaceId, { title: 'New' })).origin).toBe('church');
  });

  it('edits a church song in place when the workspace manages the Church Library', async () => {
    store.managedLibraryTypes = new Set(LIBRARY_TYPES);
    const song = await churchSong();
    const edited = await store.updateSong(song.id, { lyrics: 'changed' });
    expect(edited).toMatchObject({ origin: 'church', versions: null, lyrics: 'changed' });
    expect(await store.getChurchVersion(song.id)).toBeNull();
    expect((await store.createSong(workspaceId, { title: 'New' })).origin).toBe('church');
  });

  it('presents and searches the version the workspace chose', async () => {
    const song = await churchSong('Amazing Grace', 'how sweet the sound');
    await store.updateSong(song.id, { title: 'Grace (ours)', lyrics: 'our own words' });
    expect((await store.listSongs(workspaceId, 'sweet')).length).toBe(0);
    expect((await store.listSongs(workspaceId, 'own')).map((s) => s.title)).toEqual([
      'Grace (ours)',
    ]);

    env.advance(1000);
    const chosen = await store.setUseChurchVersion(song.id, true);
    expect(chosen).toMatchObject({
      useChurchVersion: true,
      title: 'Amazing Grace',
      lyrics: 'how sweet the sound',
      origin: 'workspace',
      revision: 3,
    });
    expect((await store.listSongs(workspaceId, 'sweet')).map((s) => s.title)).toEqual([
      'Amazing Grace',
    ]);
    expect(await store.listSongs(workspaceId, 'own')).toEqual([]);
    expect((await store.listSongs(workspaceId)).map((s) => s.title)).toEqual(['Amazing Grace']);
    // Choosing again changes nothing; choosing back works.
    expect((await store.setUseChurchVersion(song.id, true)).revision).toBe(3);
    expect((await store.setUseChurchVersion(song.id, false)).title).toBe('Grace (ours)');
    // The choice is recorded as an edit of the song, so it synchronizes, without a revision.
    expect(await store.listSongRevisions(song.id)).toHaveLength(2);
  });

  it('edits the workspace’s version from the church’s text when that was in use', async () => {
    const song = await churchSong('Church Song', 'church line');
    await store.updateSong(song.id, { lyrics: 'our line' });
    await store.setUseChurchVersion(song.id, true);
    const edited = await store.updateSong(song.id, { lyrics: 'church line\nplus ours' });
    expect(edited).toMatchObject({ useChurchVersion: false, lyrics: 'church line\nplus ours' });
    expect((await store.getChurchVersion(song.id))?.lyrics).toBe('church line');
  });

  it('refuses to choose a version for a song with one', async () => {
    const song = await store.createSong(workspaceId, { title: 'One' });
    await expect(store.setUseChurchVersion(song.id, true)).rejects.toThrow(/one version/);
  });

  it('hides a church song as the workspace’s own record', async () => {
    const song = await churchSong();
    await store.removeSong(song.id);
    expect(await store.getSong(song.id)).toMatchObject({
      origin: 'workspace',
      removedAt: env.now(),
      useChurchVersion: false,
    });
    expect(await store.listSongs(workspaceId)).toEqual([]);
  });

  it('pulls everything again once after the upgrade, so every song learns its origin', async () => {
    // A database from before phase 3, mid-way through synchronizing.
    const earlier = MIGRATIONS.filter((m) => m.version <= 8);
    const old = openNodeDriver();
    await migrate(old, earlier);
    await old.batch([
      { sql: `INSERT INTO sync_state (key, value) VALUES ('cursor', '417')` },
      { sql: `INSERT INTO sync_state (key, value) VALUES ('server', '"https://x"')` },
    ]);
    await migrate(old);
    const rows = await old.select<{ key: string; value: string }>(
      'SELECT key, value FROM sync_state ORDER BY key',
    );
    expect(rows).toEqual([
      { key: 'cursor', value: '0' },
      { key: 'server', value: '"https://x"' },
    ]);
    old.close();
  });

  it('pulls everything again once after the upgrade, so songs get their videos and passages', async () => {
    // A database that synchronized video and passage songs before it knew of them.
    const earlier = MIGRATIONS.filter((m) => m.version <= 11);
    const old = openNodeDriver();
    await migrate(old, earlier);
    await old.batch([{ sql: `INSERT INTO sync_state (key, value) VALUES ('cursor', '3848')` }]);
    await migrate(old);
    expect(
      await old.select<{ value: string }>(`SELECT value FROM sync_state WHERE key = 'cursor'`),
    ).toEqual([{ value: '0' }]);
    old.close();
  });
});

describe('song backgrounds, the workspace’s choice', () => {
  const sky = { color: '#336699', assetId: null };
  const sea = { color: '#003355', assetId: 'bg-sea' };

  async function churchSong(background: typeof sky | null = null) {
    const song = await store.createSong(workspaceId, { title: 'Church', lyrics: 'c', background });
    await driver.batch([
      { sql: `UPDATE song SET origin = 'church' WHERE id = ?`, params: [song.id] },
    ]);
    return (await store.getSong(song.id))!;
  }

  it('keeps the background a song already carries until the workspace chooses one', async () => {
    const song = await store.createSong(workspaceId, { title: 'Old', background: sky });
    expect(await store.getSongBackgroundSetting(workspaceId, song.id)).toBeUndefined();
    expect(await store.getSongBackground(song)).toEqual(sky);

    await store.setSongBackground(workspaceId, song.id, sea);
    expect(await store.getSongBackground(song)).toEqual(sea);
    // Null is a choice too: the slideshow background.
    await store.setSongBackground(workspaceId, song.id, null);
    expect(await store.getSongBackgroundSetting(workspaceId, song.id)).toBeNull();
    expect(await store.getSongBackground(song)).toBeNull();
  });

  it('chooses a church song’s background without making a version of it', async () => {
    const song = await churchSong();
    await store.setSongBackground(workspaceId, song.id, sky);
    expect(await store.getSong(song.id)).toMatchObject({
      origin: 'church',
      versions: null,
      revision: song.revision,
    });
    expect(await store.getChurchVersion(song.id)).toBeNull();
    // Not a presentation setting.
    expect(await store.getWorkspaceSettings(workspaceId)).toEqual({});
  });

  it('keeps the background shown when switching versions', async () => {
    const song = await churchSong(sky);
    await store.updateSong(song.id, { lyrics: 'ours', background: sea });
    expect(await store.getSongBackground((await store.getSong(song.id))!)).toEqual(sea);

    // With nothing chosen, the background of the version in use stays.
    env.advance(1000);
    const church = await store.setUseChurchVersion(song.id, true);
    expect(church.background).toEqual(sky);
    expect(await store.getSongBackground(church)).toEqual(sea);

    // Once chosen, switching leaves the choice alone.
    await store.setSongBackground(workspaceId, song.id, null);
    env.advance(1000);
    const own = await store.setUseChurchVersion(song.id, false);
    expect(await store.getSongBackground(own)).toBeNull();
  });

  it('keeps the background shown when an edit moves to the workspace’s version', async () => {
    const song = await churchSong(sky);
    await store.updateSong(song.id, { lyrics: 'ours', background: sea });
    await store.setUseChurchVersion(song.id, true);
    await driver.batch([{ sql: `DELETE FROM setting` }]);
    env.advance(1000);
    const edited = await store.updateSong(song.id, { lyrics: 'ours again' });
    expect(edited.useChurchVersion).toBe(false);
    expect(await store.getSongBackground(edited)).toEqual(sky);
  });

  it('synchronizes the choice as a setting', async () => {
    const song = await store.createSong(workspaceId, { title: 'Song' });
    await store.setSongBackground(workspaceId, song.id, sea);
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    const record = records.find((r) => r.key === songBackgroundKey(song.id))!;
    expect(record).toMatchObject({
      kind: 'setting',
      data: { value: { backgroundColor: '#003355', backgroundAssetId: 'bg-sea' } },
    });

    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    await new SyncStore(other.store).applyRemote(otherWorkspace, [record]);
    expect(await other.store.getSongBackgroundSetting(otherWorkspace, song.id)).toEqual(sea);
    other.driver.close();
  });
});

describe('media items (media uploads plan)', () => {
  const video = {
    file: 'video-0f8fad5b-d9cb-469f-a165-70867728950e.mp4',
    source: 'Welcome.mp4',
    width: 1920,
    height: 1080,
    durationSeconds: 42.5,
    bytes: 12_345_678,
    autoplay: false,
  };

  it('keeps a video with the song and each revision', async () => {
    const song = await store.createSong(workspaceId, { title: 'Welcome', video });
    expect((await store.getSong(song.id))!.video).toEqual(video);
    env.advance(1000);
    const edited = await store.updateSong(song.id, { video: { ...video, autoplay: true } });
    expect(edited.revision).toBe(2);
    expect((await store.getSong(song.id))!.video).toEqual({ ...video, autoplay: true });
    const revisions = await store.listSongRevisions(song.id);
    expect(revisions.map((r) => r.video?.autoplay)).toEqual([false, true]);
  });

  it('reads a song from before videos as having none', async () => {
    const song = await store.createSong(workspaceId, { title: 'Grace' });
    expect((await store.getSong(song.id))!.video).toBeNull();
  });

  it('applies a remote video song without asking for its file', async () => {
    const song = await store.createSong(workspaceId, { title: 'Welcome', video });
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    const record = records.find((r) => r.kind === 'song' && r.id === song.id)!;
    expect(record.data.video).toEqual(video);

    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    const { autoplay, ...older } = video;
    void autoplay;
    const applied = await new SyncStore(other.store).applyRemote(otherWorkspace, [
      { ...record, data: { ...record.data, video: older } },
    ]);
    expect(applied.backgroundFiles).toEqual([]);
    // Saved before Autoplay existed: off.
    expect((await other.store.getSong(song.id))!.video).toEqual({ ...video, autoplay: false });
    other.driver.close();
  });

  it('takes the fields an older build dropped when the same versions are pulled to refresh', async () => {
    const song = await store.createSong(workspaceId, { title: 'Welcome', video });
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    const record = records.find((r) => r.kind === 'song' && r.id === song.id)!;
    const revision = records.find((r) => r.kind === 'songRevision' && r.data.songId === song.id)!;
    // Pulled by a build that knew nothing of videos.
    const dropped = (r: typeof record) => ({ ...r, data: { ...r.data, video: null } });

    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    const sync = new SyncStore(other.store);
    await sync.applyRemote(otherWorkspace, [dropped(record), dropped(revision)]);
    expect((await other.store.getSong(song.id))!.video).toBeNull();

    // An ordinary pull keeps the version it has.
    await sync.applyRemote(otherWorkspace, [record, revision]);
    expect((await other.store.getSong(song.id))!.video).toBeNull();

    // A refreshing pull, after the upgrade, takes the same version again.
    const applied = await sync.applyRemote(otherWorkspace, [record, revision], { refresh: true });
    expect(applied.songs.has(song.id)).toBe(true);
    expect((await other.store.getSong(song.id))!.video).toEqual(video);
    expect((await other.store.listSongRevisions(song.id)).map((r) => r.video)).toEqual([video]);

    // A song changed here since, and not yet pushed, is newer and stays as it is.
    env.advance(1000);
    await other.store.updateSong(song.id, { video: null });
    await sync.applyRemote(otherWorkspace, [record], { refresh: true });
    expect((await other.store.getSong(song.id))!.video).toBeNull();
    other.driver.close();
  });

  it('lists the videos of run sheets from a date, each at its earliest date', async () => {
    const song = await store.createSong(workspaceId, { title: 'Welcome', video });
    const other = await store.createSong(workspaceId, {
      title: 'Outro',
      video: { ...video, file: 'video-1f8fad5b-d9cb-469f-a165-70867728950e.mp4' },
    });
    const hymn = await store.createSong(workspaceId, { title: 'Hymn' });
    for (const [date, ids] of [
      ['2026-11-01', [song.id]],
      ['2026-11-15', [other.id, song.id, hymn.id]],
      ['2026-11-08', [song.id]],
    ] as const) {
      const sheet = await store.ensureRunSheet(workspaceId, date);
      for (const id of ids) await store.addItem(sheet.id, id);
    }
    await store.removeSong(other.id);
    expect(await store.videosFrom(workspaceId, '2026-11-08')).toEqual([
      { file: video.file, date: '2026-11-08' },
      { file: 'video-1f8fad5b-d9cb-469f-a165-70867728950e.mp4', date: '2026-11-15' },
    ]);
  });

  it('applies a remote image deck and asks for its image', async () => {
    const deck = {
      source: 'Photo.jpg',
      kind: 'image' as const,
      width: 1440,
      height: 1080,
      pages: [{ image: 'deck-1-001.jpg', slide: 1, step: 0, text: [] }],
    };
    const song = await store.createSong(workspaceId, { title: 'Photo', deck });
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    const record = records.find((r) => r.kind === 'song' && r.id === song.id)!;
    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    const applied = await new SyncStore(other.store).applyRemote(otherWorkspace, [record]);
    expect(applied.backgroundFiles).toEqual(['deck-1-001.jpg']);
    expect((await other.store.getSong(song.id))!.deck?.kind).toBe('image');
    other.driver.close();
  });
});

describe('passage songs (Bible passages P3)', () => {
  const passage = {
    reference: 'MRK.15.5-MRK.15.6',
    texts: [
      {
        version: 'NIVUK',
        credit: 'NIVUK',
        provider: 'apibible' as const,
        copyright: '©',
        units: [
          { chapter: 15, verses: [5], label: '5', lines: [{ text: 'But Jesus', indent: 0 }] },
          { chapter: 15, verses: [6], label: '6', lines: [{ text: 'Now it was', indent: 0 }] },
        ],
        fumsToken: 'token',
      },
    ],
  };

  it('keeps a passage with the song and each revision', async () => {
    const song = await store.createSong(workspaceId, { title: 'Mark 15:5–6', passage });
    expect((await store.getSong(song.id))!.passage).toEqual(passage);
    env.advance(1000);
    const moved = { ...passage, reference: 'MRK.15.5' };
    await store.updateSong(song.id, { passage: moved });
    expect((await store.getSong(song.id))!.passage).toEqual(moved);
    const revisions = await store.listSongRevisions(song.id);
    expect(revisions.map((r) => r.passage?.reference)).toEqual(['MRK.15.5-MRK.15.6', 'MRK.15.5']);
  });

  it('reads a song from before passages as having none', async () => {
    const song = await store.createSong(workspaceId, { title: 'Grace' });
    expect((await store.getSong(song.id))!.passage).toBeNull();
  });

  it('never lists a passage song in the library or its search', async () => {
    await store.createSong(workspaceId, { title: 'Mark 15:5–6', lyrics: '5 But Jesus', passage });
    await store.createSong(workspaceId, { title: 'Mark 15', lyrics: 'A song titled like one' });
    expect((await store.listSongs(workspaceId)).map((s) => s.title)).toEqual(['Mark 15']);
    expect((await store.listSongs(workspaceId, 'Jesus')).map((s) => s.title)).toEqual([]);
    expect((await store.listSongs(workspaceId, 'Mark')).map((s) => s.title)).toEqual(['Mark 15']);
  });

  it('synchronizes a passage item between two stores', async () => {
    const song = await store.createSong(workspaceId, { title: 'Mark 15:5–6', passage });
    const sheet = await store.ensureRunSheet(workspaceId, '2026-11-15');
    await store.addItem(sheet.id, song.id);
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    expect(records.find((r) => r.kind === 'song')!.data.passage).toEqual(passage);
    expect(records.find((r) => r.kind === 'songRevision')!.data.passage).toEqual(passage);

    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    await new SyncStore(other.store).applyRemote(otherWorkspace, records);
    expect((await other.store.getSong(song.id))!.passage).toEqual(passage);
    const otherSheet = await other.store.getRunSheetByDate(otherWorkspace, '2026-11-15');
    expect((await other.store.listItems(otherSheet!.id)).map((i) => i.songId)).toEqual([song.id]);
    expect(await other.store.listSongs(otherWorkspace)).toEqual([]);
    other.driver.close();
  });

  it('drops an unreadable passage received from another device', async () => {
    const song = await store.createSong(workspaceId, { title: 'Mark', passage });
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    const record = records.find((r) => r.kind === 'song')!;
    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    await new SyncStore(other.store).applyRemote(otherWorkspace, [
      { ...record, data: { ...record.data, passage: { reference: 'nonsense', texts: [] } } },
    ]);
    expect((await other.store.getSong(song.id))!.passage).toBeNull();
    other.driver.close();
  });
});

describe('the Bible background', () => {
  const passage = {
    reference: 'JHN.3.16',
    texts: [
      {
        version: 'NIVUK',
        credit: 'NIV (UK)',
        provider: 'youversion' as const,
        copyright: '',
        units: [{ chapter: 3, verses: [16], label: '16', lines: [{ text: 'For God', indent: 0 }] }],
        fumsToken: null,
      },
    ],
  };
  const blue = { color: '#102040', assetId: null };

  it('shows every passage on it, and never a song', async () => {
    const reading = await store.createSong(workspaceId, { title: 'John 3:16', passage });
    const song = await store.createSong(workspaceId, { title: 'Grace' });
    // Black until the workspace chooses another.
    expect(await store.getSongBackground(reading)).toEqual({ color: '#000000', assetId: null });
    await store.setBibleBackground(workspaceId, blue);
    expect(await store.getBibleBackground(workspaceId)).toEqual(blue);
    expect(await store.getSongBackground(reading)).toEqual(blue);
    expect(await store.getSongBackground(song)).toBeNull();
    // A song's own background never reaches passages, nor the other way.
    await store.setSongBackground(workspaceId, song.id, { color: '#ff0000', assetId: null });
    expect(await store.getSongBackground(reading)).toEqual(blue);
    // Chosen to follow the slideshow background.
    await store.setBibleBackground(workspaceId, null);
    expect(await store.getSongBackground(reading)).toBeNull();
  });

  it('reaches the workspace’s other computers', async () => {
    await store.setBibleBackground(workspaceId, blue);
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    await new SyncStore(other.store).applyRemote(otherWorkspace, records);
    expect(await other.store.getBibleBackground(otherWorkspace)).toEqual(blue);
    other.driver.close();
  });
});

describe('the workspace’s Bible versions (P3.4)', () => {
  it('keeps up to two versions in order, and refuses more', async () => {
    expect(await store.getBibleVersions(workspaceId)).toEqual([]);
    await store.setBibleVersions(workspaceId, ['CCB', 'NIVUK']);
    expect(await store.getBibleVersions(workspaceId)).toEqual(['CCB', 'NIVUK']);
    await expect(store.setBibleVersions(workspaceId, ['CCB', 'NIVUK', 'ESV'])).rejects.toThrow();
    await expect(store.setBibleVersions(workspaceId, ['CCB', 'CCB'])).rejects.toThrow();
    expect(await store.getBibleVersions(workspaceId)).toEqual(['CCB', 'NIVUK']);
  });

  it('reaches the workspace’s other computers', async () => {
    await store.setBibleVersions(workspaceId, ['NIVUK']);
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    await new SyncStore(other.store).applyRemote(otherWorkspace, records);
    expect(await other.store.getBibleVersions(otherWorkspace)).toEqual(['NIVUK']);
    other.driver.close();
  });
});

describe('pinned songs', () => {
  const titles = async (search = '') =>
    (await store.listSongs(workspaceId, search)).map((song) => song.title);

  it('lists pinned songs first, each group by title, when nothing is searched', async () => {
    const ids: Record<string, string> = {};
    for (const title of ['Alpha', 'Bravo', 'Charlie', 'Delta'])
      ids[title] = (await store.createSong(workspaceId, { title })).id;
    await store.setSongPinned(workspaceId, ids.Delta!, true);
    await store.setSongPinned(workspaceId, ids.Bravo!, true);
    expect(await titles()).toEqual(['Bravo', 'Delta', 'Alpha', 'Charlie']);
    expect(await store.pinnedSongIds(workspaceId)).toEqual(new Set([ids.Bravo, ids.Delta]));

    env.advance(1000);
    await store.setSongPinned(workspaceId, ids.Delta!, false);
    expect(await titles()).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
    expect(await store.pinnedSongIds(workspaceId)).toEqual(new Set([ids.Bravo]));
  });

  it('orders a search by how well songs match, not by pins', async () => {
    await store.createSong(workspaceId, { title: 'Grace' });
    const other = await store.createSong(workspaceId, { title: 'Amazing grace' });
    await store.setSongPinned(workspaceId, other.id, true);
    expect(await titles('grace')).toEqual(['Grace', 'Amazing grace']);
  });

  it('synchronizes a pin as a setting', async () => {
    const song = await store.createSong(workspaceId, { title: 'Notices' });
    await store.setSongPinned(workspaceId, song.id, true);
    const records = await new SyncStore(store).localChanges(workspaceId, null);
    const record = records.find((r) => r.key === songPinKey(song.id))!;
    expect(record).toMatchObject({ kind: 'setting', data: { value: true } });

    const other = await createTestStore();
    const otherWorkspace = (await other.store.ensureWorkspace('Europe/London')).id;
    await new SyncStore(other.store).applyRemote(otherWorkspace, [record]);
    expect(await other.store.pinnedSongIds(otherWorkspace)).toEqual(new Set([song.id]));
    other.driver.close();
  });
});

describe('run sheets', () => {
  let songs: string[];
  beforeEach(async () => {
    songs = [];
    for (const title of ['A', 'B', 'C'])
      songs.push((await store.createSong(workspaceId, { title })).id);
  });

  const order = async (runSheetId: string) =>
    (await store.listItems(runSheetId)).map((i) => i.songId);

  it('has one run sheet per date', async () => {
    const sheet = await store.ensureRunSheet(workspaceId, '2026-10-11');
    expect(() => RunSheetSchema.parse(sheet)).not.toThrow();
    expect((await store.ensureRunSheet(workspaceId, '2026-10-11')).id).toBe(sheet.id);
    expect((await store.getRunSheetByDate(workspaceId, '2026-10-11'))!.id).toBe(sheet.id);
    expect(await store.getRunSheetByDate(workspaceId, '2026-10-12')).toBeNull();
    expect((await store.getRunSheet(sheet.id))!.date).toBe('2026-10-11');
  });

  it('adds items in order, each with its own identity, and lets a song repeat', async () => {
    const sheet = await store.ensureRunSheet(workspaceId, '2026-10-11');
    await store.addItem(sheet.id, songs[0]!);
    await store.addItem(sheet.id, songs[1]!);
    await store.addItem(sheet.id, songs[0]!);

    const items = await store.listItems(sheet.id);
    items.forEach((item) => expect(() => RunSheetItemSchema.parse(item)).not.toThrow());
    expect(items.map((i) => i.songId)).toEqual([songs[0], songs[1], songs[0]]);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
    expect((await store.getRunSheet(sheet.id))!.revision).toBe(4);
  });

  it('reorders items', async () => {
    const sheet = await store.ensureRunSheet(workspaceId, '2026-10-11');
    for (const song of songs) await store.addItem(sheet.id, song);
    const [a, , c] = await store.listItems(sheet.id);

    await store.moveItem(c!.id, 0);
    expect(await order(sheet.id)).toEqual([songs[2], songs[0], songs[1]]);
    await store.moveItem(a!.id, 99);
    expect(await order(sheet.id)).toEqual([songs[2], songs[1], songs[0]]);
    await store.moveItem(a!.id, -5);
    expect(await order(sheet.id)).toEqual([songs[0], songs[2], songs[1]]);
    expect((await store.listItems(sheet.id)).map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it('removes an item and closes the gap', async () => {
    const sheet = await store.ensureRunSheet(workspaceId, '2026-10-11');
    for (const song of songs) await store.addItem(sheet.id, song);
    const items = await store.listItems(sheet.id);
    await store.removeItem(items[1]!.id);
    expect(await order(sheet.id)).toEqual([songs[0], songs[2]]);
    expect((await store.listItems(sheet.id)).map((i) => i.position)).toEqual([0, 1]);
    await store.removeItem('missing');
  });

  it('treats an empty run sheet as nothing planned', async () => {
    const sheet = await store.ensureRunSheet(workspaceId, '2026-10-11');
    expect(await store.getPlannedRunSheet(workspaceId, '2026-10-11')).toBeNull();
    const item = await store.addItem(sheet.id, songs[0]!);
    expect((await store.getPlannedRunSheet(workspaceId, '2026-10-11'))!.id).toBe(sheet.id);
    await store.removeItem(item.id);
    expect(await store.getPlannedRunSheet(workspaceId, '2026-10-11')).toBeNull();
  });

  it('lists the dates that have something planned', async () => {
    for (const date of ['2026-10-04', '2026-10-11', '2026-11-01']) {
      const sheet = await store.ensureRunSheet(workspaceId, date);
      await store.addItem(sheet.id, songs[0]!);
    }
    await store.ensureRunSheet(workspaceId, '2026-10-18');
    expect(await store.datesWithItems(workspaceId, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-04',
      '2026-10-11',
    ]);
  });

  describe('copying', () => {
    let source: string;
    let target: string;
    beforeEach(async () => {
      source = (await store.ensureRunSheet(workspaceId, '2026-10-04')).id;
      target = (await store.ensureRunSheet(workspaceId, '2026-10-11')).id;
      await store.addItem(source, songs[0]!);
      await store.addItem(source, songs[1]!);
    });

    it('copies into an empty run sheet', async () => {
      await store.copyItems(source, target, 'append');
      expect(await order(target)).toEqual([songs[0], songs[1]]);
    });

    it('appends after existing items', async () => {
      await store.addItem(target, songs[2]!);
      await store.copyItems(source, target, 'append');
      expect(await order(target)).toEqual([songs[2], songs[0], songs[1]]);
      expect((await store.listItems(target)).map((i) => i.position)).toEqual([0, 1, 2]);
    });

    it('replaces existing items', async () => {
      await store.addItem(target, songs[2]!);
      await store.copyItems(source, target, 'replace');
      expect(await order(target)).toEqual([songs[0], songs[1]]);
      expect((await store.listItems(target)).map((i) => i.position)).toEqual([0, 1]);
    });

    it('makes new items pointing at the same songs', async () => {
      const copies = await store.copyItems(source, target, 'append');
      const sourceItems = await store.listItems(source);
      expect(copies.map((c) => c.songId)).toEqual(sourceItems.map((i) => i.songId));
      for (const copy of copies) expect(sourceItems.map((i) => i.id)).not.toContain(copy.id);
      expect(await store.listSongs(workspaceId)).toHaveLength(3);
    });

    it('never changes the source date', async () => {
      const before = {
        sheet: await store.getRunSheet(source),
        items: await store.listItems(source),
      };
      await store.copyItems(source, target, 'replace');
      const copied = await store.listItems(target);
      await store.removeItem(copied[0]!.id);
      await store.moveItem(copied[1]!.id, 0);
      expect({
        sheet: await store.getRunSheet(source),
        items: await store.listItems(source),
      }).toEqual(before);
    });

    it('does nothing when copying a run sheet onto itself', async () => {
      expect(await store.copyItems(source, source, 'replace')).toEqual([]);
      expect(await order(source)).toEqual([songs[0], songs[1]]);
    });
  });
});

describe('presentation settings', () => {
  it('default to two lines per piece with wrapping on', async () => {
    expect(await store.getPresentationSettings(workspaceId)).toEqual({
      linesPerPiece: 2,
      wrapLongLines: true,
    });
  });

  it('are saved one at a time', async () => {
    await store.updatePresentationSettings(workspaceId, { linesPerPiece: 4 });
    const settings = await store.updatePresentationSettings(workspaceId, { wrapLongLines: false });
    expect(settings).toEqual({ linesPerPiece: 4, wrapLongLines: false });
    await store.updatePresentationSettings(workspaceId, { linesPerPiece: 3 });
    const rows = await driver.select<{ revision: number }>(
      `SELECT revision FROM setting WHERE key = 'linesPerPiece'`,
    );
    expect(rows[0]!.revision).toBe(2);
  });

  it('reject values out of range', async () => {
    await expect(
      store.updatePresentationSettings(workspaceId, { linesPerPiece: 0 }),
    ).rejects.toThrow();
    await expect(
      store.updatePresentationSettings(workspaceId, { linesPerPiece: 2.5 }),
    ).rejects.toThrow();
  });

  it('fall back to the default for a corrupt stored value', async () => {
    await driver.batch([
      {
        sql: `INSERT INTO setting (workspace_id, key, value, revision, updated_at) VALUES (?, 'linesPerPiece', '"lots"', 1, '')`,
        params: [workspaceId],
      },
    ]);
    expect((await store.getPresentationSettings(workspaceId)).linesPerPiece).toBe(2);
  });

  it('keep what the church gave, as the workspace’s own, when leaving the church', async () => {
    await store.setChurchSettings({
      linesPerPiece: 3,
      wrapLongLines: false,
      slideshowFontFamily: 'Church Sans',
      subtitleFontFamily: 'Church Serif',
    });
    await store.updatePresentationSettings(workspaceId, { wrapLongLines: true });
    await store.updateOutputProfile(workspaceId, { fontFamily: 'Own Font' });
    await store.dropChurchSettings();
    expect(await store.getChurchSettings()).toEqual({});
    expect(await store.getWorkspaceSettings(workspaceId)).toEqual({
      linesPerPiece: 3,
      wrapLongLines: true,
    });
    expect((await store.getOutputProfile(workspaceId)).fontFamily).toBe('Own Font');
    expect((await store.getOutputProfile(workspaceId, 'subtitle')).fontFamily).toBe('Church Serif');
  });
});

describe('backgrounds and output profile', () => {
  it('creates a default slideshow profile once', async () => {
    const profile = await store.getOutputProfile(workspaceId);
    expect(() => OutputProfileSchema.parse(profile)).not.toThrow();
    expect(profile).toMatchObject({
      fontFamily: null,
      scale: 1,
      backgroundColor: '#000000',
      backgroundAssetId: null,
      hideCursor: false,
      target: null,
    });
    expect((await store.getOutputProfile(workspaceId)).id).toBe(profile.id);
  });

  it('saves font, scale, color and the output monitor', async () => {
    const target = {
      monitor: { name: 'Projector', x: 1920, y: 0, width: 1920, height: 1080 },
      enabled: true,
      allowOperatorScreen: false,
    };
    await store.updateOutputProfile(workspaceId, { fontFamily: 'Noto Sans SC', scale: 1.2 });
    await store.updateOutputProfile(workspaceId, { backgroundColor: '#102030', target });
    expect(await store.getOutputProfile(workspaceId)).toMatchObject({
      fontFamily: 'Noto Sans SC',
      scale: 1.2,
      backgroundColor: '#102030',
      target,
      revision: 3,
    });
  });

  it('saves whether the cursor is hidden on the slideshow', async () => {
    await store.updateOutputProfile(workspaceId, { hideCursor: true });
    expect((await store.getOutputProfile(workspaceId)).hideCursor).toBe(true);
    await store.updateOutputProfile(workspaceId, { hideCursor: false });
    expect((await store.getOutputProfile(workspaceId)).hideCursor).toBe(false);
  });

  it('rejects an out-of-range scale or a malformed color', async () => {
    await expect(store.updateOutputProfile(workspaceId, { scale: 3 })).rejects.toThrow();
    await expect(
      store.updateOutputProfile(workspaceId, { backgroundColor: 'red' }),
    ).rejects.toThrow();
  });

  it('adds, lists and removes backgrounds', async () => {
    const image = await store.addBackground(workspaceId, {
      id: 'bg1',
      kind: 'image',
      fileName: 'bg1.jpg',
      originalName: 'Sunrise.jpg',
    });
    await store.addBackground(workspaceId, {
      id: 'bg2',
      kind: 'video',
      fileName: 'bg2.mp4',
      originalName: 'Loop.mp4',
    });
    expect(() => BackgroundAssetSchema.parse(image)).not.toThrow();
    expect((await store.listBackgrounds(workspaceId)).map((b) => [b.id, b.kind])).toEqual([
      ['bg1', 'image'],
      ['bg2', 'video'],
    ]);
    await store.removeBackground('bg1');
    expect((await store.listBackgrounds(workspaceId)).map((b) => b.id)).toEqual(['bg2']);
  });

  it('falls back to the solid color when the selected background is removed', async () => {
    await store.addBackground(workspaceId, {
      id: 'bg1',
      kind: 'image',
      fileName: 'bg1.jpg',
      originalName: 'a.jpg',
    });
    await store.updateOutputProfile(workspaceId, {
      backgroundAssetId: 'bg1',
      backgroundColor: '#112233',
    });
    await store.removeBackground('bg1');
    expect(await store.getOutputProfile(workspaceId)).toMatchObject({
      backgroundAssetId: null,
      backgroundColor: '#112233',
    });
  });
});

describe('live state', () => {
  it('is absent until saved', async () => {
    expect(await store.loadLiveState(workspaceId)).toBeNull();
  });

  it('round-trips and is overwritten by the next save', async () => {
    const state = createLiveState('rs1', env.now());
    await store.saveLiveState(workspaceId, state);
    expect(await store.loadLiveState(workspaceId)).toEqual(state);

    const blanked = { ...state, blank: true, revision: 1 };
    await store.saveLiveState(workspaceId, blanked);
    expect(await store.loadLiveState(workspaceId)).toEqual(blanked);
    expect(await driver.select('SELECT workspace_id FROM live_state')).toHaveLength(1);
  });

  it('can be cleared', async () => {
    await store.saveLiveState(workspaceId, createLiveState('rs1', env.now()));
    await store.clearLiveState(workspaceId);
    expect(await store.loadLiveState(workspaceId)).toBeNull();
  });

  it('ignores a stored state it cannot read', async () => {
    await driver.batch([
      {
        sql: `INSERT INTO live_state (workspace_id, state, updated_at) VALUES (?, '{"status":"weird"}', '')`,
        params: [workspaceId],
      },
    ]);
    expect(await store.loadLiveState(workspaceId)).toBeNull();
  });
});

describe('persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'worship-q-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds every record again after a restart', async () => {
    const path = join(dir, 'worship-q.db');
    const first = await createTestStore(path);
    const workspace = await first.store.ensureWorkspace('Asia/Shanghai');
    await first.store.setMeetingDays(workspace.id, [0, 3]);
    const song = await first.store.createSong(workspace.id, {
      title: '歌',
      lyrics: '第一行\n第二行',
    });
    await first.store.updateSong(song.id, { lyrics: '第一行\n第二行\n第三行' });
    const sheet = await first.store.ensureRunSheet(workspace.id, '2026-10-11');
    await first.store.addItem(sheet.id, song.id);
    await first.store.updatePresentationSettings(workspace.id, { linesPerPiece: 4 });
    await first.store.addBackground(workspace.id, {
      id: 'bg',
      kind: 'image',
      fileName: 'bg.png',
      originalName: 'x.png',
    });
    await first.store.updateOutputProfile(workspace.id, { scale: 0.8, backgroundAssetId: 'bg' });
    const live = createLiveState(sheet.id, first.env.now());
    await first.store.saveLiveState(workspace.id, live);
    first.driver.close();

    const reopened = openNodeDriver(path);
    await migrate(reopened);
    const second = new Store(reopened, createTestEnv());
    const again = await second.ensureWorkspace('Europe/London');
    expect(again).toMatchObject({
      id: workspace.id,
      timezone: 'Asia/Shanghai',
      meetingDays: [0, 3],
    });
    expect((await second.getSong(song.id))!.lyrics).toBe('第一行\n第二行\n第三行');
    expect(await second.listSongRevisions(song.id)).toHaveLength(2);
    expect((await second.listItems(sheet.id)).map((i) => i.songId)).toEqual([song.id]);
    expect((await second.getPresentationSettings(workspace.id)).linesPerPiece).toBe(4);
    expect((await second.listBackgrounds(workspace.id)).map((b) => b.id)).toEqual(['bg']);
    expect(await second.getOutputProfile(workspace.id)).toMatchObject({
      scale: 0.8,
      backgroundAssetId: 'bg',
    });
    expect(await second.loadLiveState(workspace.id)).toEqual(live);
    reopened.close();
  });
});
