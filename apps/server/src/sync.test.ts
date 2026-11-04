import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIBRARY_TYPES } from '@worship-q/protocol';
import { Session } from '@worship-q/session';
import { migrate, Store, SyncStore, type StoreEnv } from '@worship-q/store';
import { openNodeDriver } from '@worship-q/store/testing';
import { SyncClient, type FileTransfer, type InstanceApi } from '@worship-q/sync';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db';
import {
  churchFilesDir,
  findFile,
  moveFilesToChurch,
  moveFilesToWorkspace,
  workspaceFilesDir,
} from './files';
import { Instance } from './instance';
import { applyLegacyImport, parseLegacyExport, planLegacyImport, type LegacySong } from './legacy';

/** A clock shared by every device in a test, so edits have a clear order. */
function sharedClock(start = '2026-10-21T09:00:00.000Z') {
  let now = Date.parse(start);
  return {
    now: () => new Date(now).toISOString(),
    date: () => new Date(now),
    advance: (ms = 1000) => {
      now += ms;
    },
  };
}

type Clock = ReturnType<typeof sharedClock>;

/** The instance called in-process, speaking `protocol` (version 3 unless a test says 2). */
function directApi(instance: Instance, token: () => string | null, protocol = 3): InstanceApi {
  const device = () => {
    const found = instance.authenticate(token() ?? '');
    if (!found) throw new Error('unauthorized');
    return found;
  };
  return {
    info: async () => ({
      name: 'Test',
      protocolVersion: 3,
      minProtocolVersion: 2,
      decks: false,
      outputs: false,
      pairing: true,
      admin: true,
      codes: !instance.hasAdministrators(),
    }),
    enroll: async (code, name) => {
      const enrolled = instance.enroll(code, name);
      if (!enrolled) throw new Error('invalid-code');
      const workspace = instance.getWorkspace(enrolled.device.workspaceId)!;
      return { deviceId: enrolled.device.id, deviceToken: enrolled.token, workspace };
    },
    startPairing: async (name) => {
      const started = instance.startPairing(name);
      if (!started) throw new Error('too-many-requests');
      return {
        ...started,
        url: `https://example.org/admin/pair?code=${started.code}`,
        intervalMs: 5000,
      };
    },
    pollPairing: async (secret) => instance.pollPairing(secret),
    workspace: async () => {
      const d = device();
      return { ...instance.getWorkspace(d.workspaceId)!, deviceName: d.name };
    },
    claim: async (contentId) => instance.claimContent(device().workspaceId, contentId),
    push: async (records) => {
      const d = device();
      return { remap: instance.push(d.workspaceId, d.id, records).remap };
    },
    pull: async (since) => {
      const d = device();
      return {
        ...instance.pull(d.workspaceId, since, 3, protocol),
        church: instance.churchSettings(),
        ...(protocol >= 3
          ? {
              manageLibrary:
                instance.getWorkspace(d.workspaceId)?.libraryTypes.includes('songs') ?? false,
              manageLibraryTypes: instance.getWorkspace(d.workspaceId)?.libraryTypes ?? [],
            }
          : {}),
      };
    },
    restore: async (kind, key) => {
      const d = device();
      const record = instance.dropOwnVersion(d.workspaceId, kind, key);
      if (!record) throw new Error('no-church-version');
      return { record };
    },
  };
}

const noFiles: FileTransfer = {
  upload: async () => undefined,
  download: async () => undefined,
  missing: async () => [],
};

async function device(name: string, clock: Clock, instance: Instance, protocol = 3) {
  const driver = openNodeDriver();
  await migrate(driver);
  let counter = 0;
  const env: StoreEnv = { now: clock.now, newId: () => `${name}-${++counter}` };
  const store = new Store(driver, env);
  const { session } = await Session.open(store, { now: clock.date }, 'Europe/London');
  const syncStore = new SyncStore(store);
  let token: string | null = null;
  const api = directApi(instance, () => token, protocol);
  const client = new SyncClient(session, syncStore, api, noFiles, clock.now);
  return {
    session,
    store,
    client,
    syncStore,
    /** Enrolls and joins without synchronizing yet. */
    async join(code: string, mode: 'upload' | 'merge' | 'replace') {
      const enrolled = await client.enroll('https://example.org', code, name);
      token = enrolled.deviceToken;
      await client.join(mode);
    },
    async connect(code: string, mode: 'upload' | 'merge' | 'replace') {
      await this.join(code, mode);
      // The app reopens its session after joining; here the same session carries on.
      await client.run();
      expect(client.status.kind).toBe('idle');
    },
  };
}

async function setup() {
  const clock = sharedClock();
  const instance = new Instance(openDatabase(':memory:'), clock.now);
  const { workspace, code } = instance.createWorkspace('North Branch');
  return { clock, instance, workspace, code };
}

describe('synchronization between two devices', () => {
  it('takes one device’s songs and run sheets to another that replaces its own', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    const song = await branch.session.createSong({ title: 'Amazing Grace', lyrics: 'a\nb\n\nc' });
    const date = branch.session.openDate;
    await branch.session.addSong(date, song.id);
    await branch.connect(code, 'upload');

    clock.advance();
    const home = await device('home', clock, instance);
    await home.session.createSong({ title: 'Home test song', lyrics: 'x' });
    await home.connect(code, 'replace');

    expect(home.session.workspace.id).toBe(branch.session.workspace.id);
    expect(home.session.workspace.name).toBe('North Branch');
    const songs = await home.store.listSongs(home.session.workspace.id);
    expect(songs.map((s) => s.title)).toEqual(['Amazing Grace']);
    const view = await home.session.viewDate(date);
    expect(view.entries.map((e) => e.song.title)).toEqual(['Amazing Grace']);
    // Both devices now know the date's run sheet by the same identifier.
    const branchSheet = await branch.store.getRunSheetByDate(branch.session.workspace.id, date);
    expect(view.runSheet?.id).toBe(branchSheet?.id);
  });

  it('merges the songs of a device that keeps its own', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    await branch.session.createSong({ title: 'Branch song', lyrics: 'a' });
    await branch.connect(code, 'upload');
    clock.advance();
    const home = await device('home', clock, instance);
    await home.session.createSong({ title: 'Home song', lyrics: 'b' });
    await home.connect(code, 'merge');
    clock.advance();
    await branch.client.run();

    const titles = async (d: typeof branch) =>
      (await d.store.listSongs(d.session.workspace.id)).map((s) => s.title);
    expect(await titles(branch)).toEqual(['Branch song', 'Home song']);
    expect(await titles(home)).toEqual(['Branch song', 'Home song']);
  });

  it('starts a workspace empty when its first device takes the church’s copy', async () => {
    const { clock, instance, code } = await setup();
    const first = await device('first', clock, instance);
    const song = await first.session.createSong({ title: 'First song', lyrics: 'a' });
    await first.session.addSong(first.session.openDate, song.id);
    await first.connect(code, 'replace');

    const titles = async (d: typeof first) =>
      (await d.store.listSongs(d.session.workspace.id)).map((s) => s.title);
    expect(await titles(first)).toEqual([]);
    expect(first.session.workspace.name).toBe('North Branch');
    // It brought nothing: a device joining later receives no songs either.
    clock.advance();
    const later = await device('later', clock, instance);
    await later.connect(code, 'replace');
    expect(later.session.workspace.id).toBe(first.session.workspace.id);
    expect(await titles(later)).toEqual([]);
    expect(later.session.workspace.name).toBe('North Branch');
  });

  it('takes a website and its history to another device', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    const created = await branch.session.createSong({
      title: 'Live stream',
      website: { url: 'https://example.org/live' },
    });
    await branch.session.saveSong(created.id, { website: { url: 'https://example.org/stream' } });
    await branch.connect(code, 'upload');
    clock.advance();
    const home = await device('home', clock, instance);
    await home.connect(code, 'replace');

    expect((await home.store.getSong(created.id))?.website).toEqual({
      url: 'https://example.org/stream',
    });
    const history = await home.store.listSongRevisions(created.id);
    expect(history.map((r) => r.website?.url)).toEqual([
      'https://example.org/live',
      'https://example.org/stream',
    ]);
  });

  it('brings a lyrics fix made at home to the presented song, keeping the position', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    const song = await branch.session.createSong({
      title: 'Song',
      lyrics: 'one\ntwo\n\nthree\nfour',
    });
    const date = branch.session.openDate;
    const item = await branch.session.addSong(date, song.id);
    await branch.connect(code, 'upload');
    const home = await device('home', clock, instance);
    await home.connect(code, 'replace');

    const second = (await branch.session.viewLive())!.entries[0]!.pieces[1]!;
    await branch.session.play(item.id, second.id);
    clock.advance();
    // A line is added above the presented piece.
    await home.session.saveSong(song.id, { lyrics: 'zero\none\ntwo\n\nthree\nfour' });
    await home.client.run();
    clock.advance();
    await branch.client.run();

    const frame = await branch.session.frame(() => '');
    const shown = frame.song?.pieces.find((p) => p.id === frame.pieceId);
    expect(shown?.lines).toEqual(['three', 'four']);
    expect(frame.song?.pieces[0]?.lines).toEqual(['zero', 'one']);
  });

  it('settles edits to the same run sheet on the later one, on both devices', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    const a = await branch.session.createSong({ title: 'A', lyrics: 'a' });
    const b = await branch.session.createSong({ title: 'B', lyrics: 'b' });
    await branch.connect(code, 'upload');
    const home = await device('home', clock, instance);
    await home.connect(code, 'replace');
    const date = '2026-11-01';
    await branch.session.editRunSheet(date);
    await home.session.editRunSheet(date);

    clock.advance();
    await branch.session.addSong(date, a.id);
    clock.advance();
    await home.session.addSong(date, b.id);
    await branch.client.run();
    await home.client.run();
    await branch.client.run();

    for (const d of [branch, home]) {
      const view = await d.session.viewDate(date);
      expect(view.entries.map((e) => e.song.title)).toEqual(['B']);
    }
    const ids = await Promise.all(
      [branch, home].map(async (d) => (await d.session.viewDate(date)).runSheet?.id),
    );
    expect(ids[0]).toBe(ids[1]);
  });

  it('keeps a planned run sheet when a joining device opens the date before its first pull', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    const song = await branch.session.createSong({ title: 'Amazing Grace', lyrics: 'a' });
    const date = '2026-11-01';
    await branch.session.editRunSheet(date);
    await branch.session.addSong(date, song.id);
    await branch.connect(code, 'upload');

    clock.advance();
    const home = await device('home', clock, instance);
    await home.join(code, 'replace');
    clock.advance();
    // The reopened app opens the next meeting day before anything has been pulled.
    await home.store.ensureRunSheet(home.session.workspace.id, date);
    clock.advance();
    await home.client.run();
    await branch.client.run();

    for (const d of [branch, home]) {
      const view = await d.session.viewDate(date);
      expect(view.entries.map((e) => e.song.title)).toEqual(['Amazing Grace']);
    }
  });

  it('shares each output’s font, size and background, but not its screen', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    await branch.connect(code, 'upload');
    const home = await device('home', clock, instance);
    await home.connect(code, 'replace');
    const homeScreen = {
      monitor: { name: 'Projector', x: 1920, y: 0, width: 1920, height: 1080 },
      enabled: true,
      allowOperatorScreen: false,
    };
    await home.session.updateOutputProfile({ target: homeScreen });

    clock.advance();
    await branch.session.updateOutputProfile({ fontFamily: 'Noto Sans SC', scale: 1.2 });
    await branch.session.updateOutputProfile(
      { backgroundColor: '#102030', target: null },
      'subtitle',
    );
    await branch.client.run();
    await home.client.run();

    const id = home.session.workspace.id;
    expect(await home.store.getOutputProfile(id)).toMatchObject({
      fontFamily: 'Noto Sans SC',
      scale: 1.2,
      target: homeScreen,
    });
    expect((await home.store.getOutputProfile(id, 'subtitle')).backgroundColor).toBe('#102030');

    // A removed background stops being selected on every computer.
    clock.advance();
    const asset = await home.session.addBackground({
      id: 'bg-1',
      kind: 'image',
      fileName: 'bg-1.jpg',
      originalName: 'bg.jpg',
    });
    await home.session.updateOutputProfile({ backgroundAssetId: asset.id });
    await home.client.run();
    await branch.client.run();
    expect((await branch.store.getOutputProfile(id)).backgroundAssetId).toBe('bg-1');
    clock.advance();
    await branch.session.removeBackground('bg-1');
    await branch.client.run();
    await home.client.run();
    expect((await home.store.getOutputProfile(id)).backgroundAssetId).toBeNull();
  });

  it('applies church defaults unless the workspace sets its own', async () => {
    const { clock, instance, code } = await setup();
    instance.setChurchSetting('linesPerPiece', 4);
    instance.setChurchSetting('slideshowFontFamily', 'Noto Sans SC');
    const branch = await device('branch', clock, instance);
    await branch.connect(code, 'upload');
    const id = branch.session.workspace.id;
    expect((await branch.store.getPresentationSettings(id)).linesPerPiece).toBe(4);
    expect(await branch.session.fontFamily('slideshow')).toBe('Noto Sans SC');

    await branch.session.updatePresentationSettings({ linesPerPiece: 2 });
    expect((await branch.store.getPresentationSettings(id)).linesPerPiece).toBe(2);
    await branch.session.updatePresentationSettings({ linesPerPiece: null });
    expect((await branch.store.getPresentationSettings(id)).linesPerPiece).toBe(4);
  });

  it('keeps removals and the meeting days in step', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    const song = await branch.session.createSong({ title: 'Old', lyrics: 'a' });
    await branch.connect(code, 'upload');
    const home = await device('home', clock, instance);
    await home.connect(code, 'replace');
    clock.advance();
    await home.session.removeSong(song.id);
    await home.session.setMeetingDays([3]);
    await home.client.run();
    await branch.client.run();
    expect(await branch.store.listSongs(branch.session.workspace.id)).toEqual([]);
    expect(branch.session.workspace.meetingDays).toEqual([3]);
  });

  it('stops with a clear status once the device is revoked', async () => {
    const { clock, instance, code } = await setup();
    const branch = await device('branch', clock, instance);
    await branch.connect(code, 'upload');
    const [enrolled] = instance.listDevices();
    instance.revokeDevice(enrolled!.id);
    await branch.client.run();
    expect(branch.client.status.kind).toBe('error');
  });
});

describe('importing the legacy lyrics service', () => {
  const legacy = (songId: number, overrides: Partial<LegacySong> = {}): LegacySong => ({
    songId,
    id: `song${songId}`,
    title: `Song ${songId}`,
    lyrics: 'one\ntwo\n\nthree',
    lyricist: 'Writer',
    composer: 'Writer',
    copyright: '',
    ccli: '',
    year: 2020,
    deleted: 0,
    ...overrides,
  });

  async function imported(
    songs: LegacySong[],
    instance: Instance,
    workspaceId: string,
    now: string,
  ) {
    const plan = planLegacyImport(instance, workspaceId, songs, now);
    applyLegacyImport(instance, workspaceId, plan);
    return plan;
  }

  it('reads both a JSON array and one object per line', () => {
    const rows = [legacy(1), legacy(2)];
    expect(parseLegacyExport(JSON.stringify(rows))).toEqual(rows);
    expect(parseLegacyExport(rows.map((r) => JSON.stringify(r)).join('\n') + '\n')).toEqual(rows);
  });

  it('reads text columns exported with HEX(), and refuses rows split by line breaks', () => {
    const hex = (text: string) => Buffer.from(text, 'utf8').toString('hex').toUpperCase();
    const tsv = `songId\ttitle_hex\tlyrics_hex\tccli_hex\n9\t${hex('世界真光')}\t${hex('a\tb\n\nc')}\tNULL\n`;
    expect(parseLegacyExport(tsv)).toEqual([
      { songId: '9', title: '世界真光', lyrics: 'a\tb\n\nc', ccli: null },
    ]);
    // An empty last value leaves only a trailing tab.
    expect(parseLegacyExport('songId\tccli_hex\n9\t\n')).toEqual([{ songId: '9', ccli: '' }]);
    expect(() => parseLegacyExport('songId\ttitle\tlyrics\n1\tA\tline 1\nline 2')).toThrow(/HEX/);
  });

  it('reads the tab-separated output of mysql --batch', () => {
    const tsv = [
      'songId\tid\ttitle\tlyrics\tccli\tyear',
      '7\tabc\tA\\tB\tline 1\\nline 2\\n\\nC:\\\\x\tNULL\t2020',
    ].join('\n');
    expect(parseLegacyExport(tsv)).toEqual([
      {
        songId: '7',
        id: 'abc',
        title: 'A\tB',
        lyrics: 'line 1\nline 2\n\nC:\\x',
        ccli: null,
        year: '2020',
      },
    ]);
  });

  it('brings live legacy songs to a computer that uses the church’s copy', async () => {
    const { clock, instance, workspace, code } = await setup();
    const plan = await imported(
      [
        legacy(1, {
          title: '世界真光',
          lyricist: 'Tim Hughes',
          composer: 'Tim Hughes',
          ccli: '3217555',
        }),
        legacy(2, { lyricist: '游智婷', composer: '陳麒安' }),
        legacy(3, { deleted: 1 }),
        legacy(4, { id: 'song4-probation' }),
        legacy(5, { lyrics: '' }),
      ],
      instance,
      workspace.id,
      clock.now(),
    );
    expect(plan).toMatchObject({ added: 2, skipped: 1, removed: 0 });

    clock.advance();
    const home = await device('home', clock, instance);
    await home.session.createSong({ title: 'Sample', lyrics: 'x' });
    await home.connect(code, 'replace');

    const songs = await home.store.listSongs(home.session.workspace.id);
    expect(songs.map((s) => [s.title, s.author, s.ccli])).toEqual([
      ['Song 2', '游智婷, 陳麒安', null],
      ['世界真光', 'Tim Hughes', '3217555'],
    ]);
    expect(await home.store.listSongRevisions(songs[0]!.id)).toHaveLength(1);
  });

  it('updates changed songs on a second import, keeping what was edited in Worship Q', async () => {
    const { clock, instance, workspace, code } = await setup();
    await imported([legacy(1), legacy(2), legacy(3)], instance, workspace.id, clock.now());
    clock.advance();
    const home = await device('home', clock, instance);
    await home.connect(code, 'replace');
    const byTitle = async () =>
      new Map((await home.store.listSongs(home.session.workspace.id)).map((s) => [s.title, s]));
    const before = await byTitle();

    clock.advance();
    await home.session.saveSong(before.get('Song 2')!.id, { lyrics: 'edited at home' });
    await home.client.run();

    clock.advance();
    const plan = await imported(
      [legacy(1, { lyrics: 'one\ntwo\n\nthree changed' }), legacy(2, { lyrics: 'legacy edit' })],
      instance,
      workspace.id,
      clock.now(),
    );
    expect(plan).toMatchObject({
      added: 0,
      updated: 1,
      unchanged: 0,
      removed: 1,
      kept: ['Song 2'],
    });
    expect(planLegacyImport(instance, workspace.id, [legacy(1)], clock.now()).records).toHaveLength(
      2,
    );

    clock.advance();
    await home.client.run();
    const after = await byTitle();
    const song1 = after.get('Song 1')!;
    expect(song1.lyrics).toBe('one\ntwo\n\nthree changed');
    expect(song1.revision).toBe(2);
    // Unchanged lines keep their identifiers, so a presented slide stays in place.
    expect(song1.lineIds.slice(0, 2)).toEqual(before.get('Song 1')!.lineIds.slice(0, 2));
    expect(after.get('Song 2')!.lyrics).toBe('edited at home');
    expect(after.has('Song 3')).toBe(false);
  });
});

describe('text holding half of a surrogate pair', () => {
  it('is replaced on the way in, and in what was stored before', async () => {
    const { clock, instance, workspace } = await setup();
    const song = (id: string, title: string) => ({
      kind: 'song' as const,
      id,
      key: id,
      revision: 1,
      updatedAt: clock.now(),
      data: { title, lyrics: 'a\ud83d b', lineIds: ['x'] },
    });
    instance.push(workspace.id, 'device', [song('s1', 'ok \ud83d\ude00')]);
    // As if stored by an earlier version of the instance.
    instance.db
      .prepare(
        `INSERT INTO record (workspace_id, kind, key, id, revision, updated_at, seq, data, device_id)
         VALUES (?, 'song', 's2', 's2', 1, ?, 99, ?, 'device')`,
      )
      .run(workspace.id, clock.now(), JSON.stringify(song('s2', '\udc00x').data));

    const { records } = instance.pull(workspace.id, 0);
    expect(records.map((r) => [r.data.title, r.data.lyrics])).toEqual([
      ['ok \ud83d\ude00', 'a\ufffd b'],
      ['\ufffdx', 'a\ufffd b'],
    ]);
    expect(JSON.stringify(records)).not.toMatch(/\\ud[89ab]|\\udc/i);
  });
});

describe('the Church Library', () => {
  /** Workspace A, whose computer has songs, and an empty workspace B. */
  async function twoBranches() {
    const { clock, instance, workspace: a, code: codeA } = await setup();
    const { workspace: b, code: codeB } = instance.createWorkspace('South Branch');
    const north = await device('north', clock, instance);
    const grace = await north.session.createSong({ title: 'Amazing Grace', lyrics: 'a\nb' });
    const holy = await north.session.createSong({ title: 'Holy Holy', lyrics: 'c' });
    await north.session.addBackground({
      id: 'bg-1',
      kind: 'image',
      fileName: 'bg-1.jpg',
      originalName: 'Sunrise.jpg',
    });
    await north.connect(codeA, 'upload');
    clock.advance();
    return { clock, instance, a, b, codeB, north, grace, holy };
  }

  const titles = async (d: Awaited<ReturnType<typeof device>>) =>
    (await d.store.listSongs(d.session.workspace.id)).map((s) => s.title).sort();

  it('brings the songs and backgrounds of the workspace that manages it to another', async () => {
    const { clock, instance, a, b, codeB, north } = await twoBranches();
    expect(instance.libraryPlan(a.id, LIBRARY_TYPES)).toEqual({
      songs: ['Amazing Grace', 'Holy Holy'],
      slides: [],
      websites: [],
      backgrounds: ['Sunrise.jpg'],
      overrides: [],
      hidden: [],
    });
    instance.setManageLibrary(a.id, true);
    expect(instance.getWorkspace(a.id)?.libraryTypes).toEqual(LIBRARY_TYPES);

    const south = await device('south', clock, instance);
    await south.connect(codeB, 'upload');
    expect(await titles(south)).toEqual(['Amazing Grace', 'Holy Holy']);
    const backgrounds = await south.store.listBackgrounds(south.session.workspace.id);
    expect(backgrounds.map((bg) => bg.originalName)).toEqual(['Sunrise.jpg']);

    // Later additions in A are the church's too; B's stay its own.
    clock.advance();
    await north.session.createSong({ title: 'New Church Song', lyrics: 'x' });
    await north.client.run();
    await south.session.createSong({ title: 'South Only', lyrics: 'y' });
    await south.client.run();
    await north.client.run();
    expect(await titles(south)).toEqual([
      'Amazing Grace',
      'Holy Holy',
      'New Church Song',
      'South Only',
    ]);
    expect(await titles(north)).toEqual(['Amazing Grace', 'Holy Holy', 'New Church Song']);
    // Content B only received is not taken for B's own.
    expect(instance.records(b.id, 'song').map((r) => r.record.data.title)).toEqual(['South Only']);
    expect(north.client.status.kind).toBe('idle');
  });

  it('keeps a workspace’s edits and removals of church songs to itself', async () => {
    const { clock, instance, a, codeB, north, grace, holy } = await twoBranches();
    instance.setManageLibrary(a.id, true);
    const south = await device('south', clock, instance);
    await south.connect(codeB, 'upload');

    clock.advance();
    await south.session.saveSong(grace.id, { title: 'Amazing Grace (South)' });
    await south.session.removeSong(holy.id);
    await south.client.run();
    await north.client.run();
    expect(await titles(north)).toEqual(['Amazing Grace', 'Holy Holy']);
    expect(await titles(south)).toEqual(['Amazing Grace (South)']);

    // A church edit does not overwrite B's own version.
    clock.advance();
    await north.session.saveSong(grace.id, { lyrics: 'changed by the church' });
    await north.client.run();
    await south.client.run();
    expect((await south.store.getSong(grace.id))?.title).toBe('Amazing Grace (South)');
    expect((await south.store.getSong(grace.id))?.lyrics).toBe('a\nb');
  });

  it('removes a church song everywhere, except where a workspace has its own version', async () => {
    const { clock, instance, a, codeB, north, grace, holy } = await twoBranches();
    instance.setManageLibrary(a.id, true);
    const south = await device('south', clock, instance);
    await south.connect(codeB, 'upload');
    clock.advance();
    await south.session.saveSong(grace.id, { title: 'Grace, South' });
    await south.client.run();

    clock.advance();
    await north.session.removeSong(grace.id);
    await north.session.removeSong(holy.id);
    await north.client.run();
    await south.client.run();
    expect(await titles(north)).toEqual([]);
    expect(await titles(south)).toEqual(['Grace, South']);
  });

  it('brings a workspace’s own versions into the Church Library when it starts managing it', async () => {
    const { clock, instance, a, b, codeB, north, grace, holy } = await twoBranches();
    instance.setManageLibrary(a.id, true);
    const south = await device('south', clock, instance);
    await south.connect(codeB, 'upload');
    clock.advance();
    await south.session.saveSong(grace.id, { title: 'Grace, South' });
    await south.session.removeSong(holy.id);
    await south.session.createSong({ title: 'South Only', lyrics: 'y' });
    await south.session.removeBackground('bg-1');
    await south.client.run();
    expect(await south.store.listBackgrounds(south.session.workspace.id)).toEqual([]);

    instance.setManageLibrary(a.id, false);
    expect(instance.libraryPlan(b.id, LIBRARY_TYPES)).toEqual({
      songs: ['South Only'],
      slides: [],
      websites: [],
      backgrounds: [],
      overrides: [{ title: 'Grace, South', churchChangedSince: false, usesChurchVersion: false }],
      hidden: ['Sunrise.jpg', 'Holy Holy'],
    });
    clock.advance();
    instance.setManageLibrary(b.id, true);
    expect(
      instance
        .records(b.id, 'song')
        .map((r) => r.record.data.title)
        .sort(),
    ).toEqual(['Grace, South', 'Holy Holy', 'South Only']);

    await south.client.run();
    await north.client.run();
    expect(await titles(south)).toEqual(['Grace, South', 'Holy Holy', 'South Only']);
    expect(await titles(north)).toEqual(['Grace, South', 'Holy Holy', 'South Only']);
    const backgrounds = await south.store.listBackgrounds(south.session.workspace.id);
    expect(backgrounds.map((bg) => bg.originalName)).toEqual(['Sunrise.jpg']);

    // A no longer manages it: its new songs stay its own.
    clock.advance();
    await north.session.createSong({ title: 'North Only', lyrics: 'z' });
    await north.client.run();
    await south.client.run();
    expect(await titles(south)).toEqual(['Grace, South', 'Holy Holy', 'South Only']);
  });
});

describe('two versions of a song (D31, D32)', () => {
  /** A managing workspace with one song, and a normal workspace with two computers. */
  async function churchAndBranch() {
    const { clock, instance, workspace: a, code: codeA } = await setup();
    const { workspace: b, code: codeB } = instance.createWorkspace('South Branch');
    const church = await device('church', clock, instance);
    const grace = await church.session.createSong({ title: 'Amazing Grace', lyrics: 'a\nb' });
    await church.connect(codeA, 'upload');
    instance.setManageLibrary(a.id, true);
    await church.client.run();
    clock.advance();
    const south1 = await device('south1', clock, instance);
    await south1.connect(codeB, 'upload');
    const south2 = await device('south2', clock, instance);
    await south2.connect(codeB, 'replace');
    clock.advance();
    return { clock, instance, a, b, church, south1, south2, grace };
  }

  it('marks where songs come from, and whether the workspace manages the Church Library', async () => {
    const { church, south1, grace } = await churchAndBranch();
    expect((await church.store.getSong(grace.id))?.origin).toBe('church');
    expect(church.store.managesChurch('song')).toBe(true);
    expect(await south1.store.getSong(grace.id)).toMatchObject({
      origin: 'church',
      useChurchVersion: false,
      versions: null,
    });
    expect(south1.store.managesChurch('song')).toBe(false);
    expect((await south1.syncStore.getState()).manageLibrary).toBe(false);
  });

  it('makes a version of a church song on edit, and brings both versions to the other computer', async () => {
    const { clock, church, south1, south2, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)' });
    const edited = (await south1.store.getSong(grace.id))!;
    expect(edited).toMatchObject({
      origin: 'workspace',
      useChurchVersion: false,
      title: 'Grace (South)',
    });
    expect(edited.versions).toMatchObject({ own: { revision: 2 }, church: { revision: 1 } });
    expect((await south1.store.getChurchVersion(grace.id))?.title).toBe('Amazing Grace');

    await south1.client.run();
    await south2.client.run();
    const other = (await south2.store.getSong(grace.id))!;
    expect(other).toMatchObject({ origin: 'workspace', title: 'Grace (South)' });
    expect(other.versions).not.toBeNull();
    expect((await south2.store.getChurchVersion(grace.id))?.title).toBe('Amazing Grace');

    // The church's later edit reaches both as the other version, leaving theirs alone.
    clock.advance();
    await church.session.saveSong(grace.id, { lyrics: 'a\nb\nc (church)' });
    await church.client.run();
    await south1.client.run();
    expect((await south1.store.getSong(grace.id))?.lyrics).toBe('a\nb');
    expect((await south1.store.getChurchVersion(grace.id))?.lyrics).toBe('a\nb\nc (church)');
    expect((await south1.store.getSong(grace.id))?.versions?.church.revision).toBe(2);
    // The church's computer sees one version, its own.
    expect((await church.store.getSong(grace.id))?.versions).toBeNull();
  });

  it('lets the workspace choose the church’s version, on every computer and in search', async () => {
    const { clock, south1, south2, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)', lyrics: 'south words' });
    await south1.client.run();
    await south2.client.run();
    clock.advance();

    await south2.session.setUseChurchVersion(grace.id, true);
    expect(await south2.store.getSong(grace.id)).toMatchObject({
      useChurchVersion: true,
      title: 'Amazing Grace',
      lyrics: 'a\nb',
    });
    const found = await south2.store.listSongs(south2.session.workspace.id, 'amazing');
    expect(found.map((s) => s.title)).toEqual(['Amazing Grace']);
    expect(await south2.store.listSongs(south2.session.workspace.id, 'south')).toEqual([]);

    await south2.client.run();
    await south1.client.run();
    expect(await south1.store.getSong(grace.id)).toMatchObject({
      useChurchVersion: true,
      title: 'Amazing Grace',
    });
    // The workspace's own version is still there to go back to.
    clock.advance();
    await south1.session.setUseChurchVersion(grace.id, false);
    expect((await south1.store.getSong(grace.id))?.title).toBe('Grace (South)');

    // Editing while the church's version is in use edits the workspace's version, from
    // what was on screen, and switches to it.
    clock.advance();
    await south1.session.setUseChurchVersion(grace.id, true);
    await south1.session.saveSong(grace.id, { lyrics: 'a\nb\nsouth again' });
    expect(await south1.store.getSong(grace.id)).toMatchObject({
      useChurchVersion: false,
      title: 'Amazing Grace',
      lyrics: 'a\nb\nsouth again',
    });
    expect((await south1.store.getChurchVersion(grace.id))?.lyrics).toBe('a\nb');
  });

  it('deletes the workspace’s version, going back to the church’s everywhere', async () => {
    const { clock, south1, south2, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)' });
    await south1.client.run();
    await south2.client.run();
    clock.advance();

    await south1.client.deleteOwnVersion('song', grace.id);
    expect(await south1.store.getSong(grace.id)).toMatchObject({
      origin: 'church',
      title: 'Amazing Grace',
      useChurchVersion: false,
      versions: null,
    });
    expect(await south1.store.getChurchVersion(grace.id)).toBeNull();
    await south2.client.run();
    expect(await south2.store.getSong(grace.id)).toMatchObject({
      origin: 'church',
      title: 'Amazing Grace',
      versions: null,
    });
    await expect(south1.client.deleteOwnVersion('song', grace.id)).rejects.toThrow();
  });

  it('turns a two-version song into the workspace’s own when the church deletes it', async () => {
    const { clock, church, south1, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)' });
    await south1.session.setUseChurchVersion(grace.id, true);
    await south1.client.run();
    clock.advance();
    await church.session.removeSong(grace.id);
    await church.client.run();
    await south1.client.run();
    expect(await south1.store.getSong(grace.id)).toMatchObject({
      title: 'Grace (South)',
      useChurchVersion: false,
      versions: null,
      removedAt: null,
    });
  });

  it('brings both versions and the choice to a computer that joins later', async () => {
    const { clock, instance, b, south1, south2, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)' });
    await south1.session.setUseChurchVersion(grace.id, true);
    await south1.client.run();
    clock.advance();
    // The church's record is earlier in the feed than the workspace's version: a new
    // computer passes it before it holds the song.
    const south3 = await device('south3', clock, instance);
    await south3.connect(instance.rotateCode(b.id), 'replace');
    expect(await south3.store.getSong(grace.id)).toMatchObject({
      title: 'Amazing Grace',
      useChurchVersion: true,
      versions: { own: { revision: 3 }, church: { revision: 1 } },
    });
    expect((await south3.store.getOwnVersion(grace.id))?.title).toBe('Grace (South)');
    // Search follows the version in use there too.
    const found = await south3.store.listSongs(south3.session.workspace.id, 'amazing');
    expect(found.map((s) => s.id)).toEqual([grace.id]);
    // And it presents what the others present.
    await south2.client.run();
    expect((await south2.store.getSong(grace.id))?.title).toBe('Amazing Grace');
  });

  it('links the versions again when the church restores its song within the retention period (D34)', async () => {
    const { clock, instance, church, south1, south2, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)' });
    await south1.client.run();
    await south2.client.run();
    expect((await south2.store.getSong(grace.id))?.versions).not.toBeNull();
    clock.advance();
    // South 2 is away while the church deletes the song and an administrator restores it.
    await church.session.removeSong(grace.id);
    await church.client.run();
    await south1.client.run();
    expect((await south1.store.getSong(grace.id))?.versions).toBeNull();
    clock.advance();
    expect(instance.restoreChurch('song', grace.id)).toBe('restored');
    await south1.client.run();
    await south2.client.run();
    for (const computer of [south1, south2]) {
      // The workspace's version stays in use; the church's is one toggle away again.
      expect(await computer.store.getSong(grace.id)).toMatchObject({
        title: 'Grace (South)',
        useChurchVersion: false,
        removedAt: null,
      });
      expect((await computer.store.getSong(grace.id))?.versions).not.toBeNull();
      expect((await computer.store.getChurchVersion(grace.id))?.title).toBe('Amazing Grace');
    }
    // A workspace that never had its own version simply has the song back.
    const north = await device('north', clock, instance);
    await north.connect(instance.createWorkspace('North').code, 'replace');
    expect(await north.store.getSong(grace.id)).toMatchObject({
      origin: 'church',
      title: 'Amazing Grace',
      removedAt: null,
    });
  });

  it('makes the song the workspace’s own on a computer that learns of the version and the deletion at once', async () => {
    const { clock, church, south1, south2, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)' });
    await south1.client.run();
    clock.advance();
    await church.session.removeSong(grace.id);
    await church.client.run();
    // South 2 still holds the church's song; one pull brings both changes.
    expect((await south2.store.getSong(grace.id))?.origin).toBe('church');
    await south2.client.run();
    expect(await south2.store.getSong(grace.id)).toMatchObject({
      title: 'Grace (South)',
      origin: 'workspace',
      versions: null,
      removedAt: null,
    });
    expect(await south2.store.getChurchVersion(grace.id)).toBeNull();
  });

  it('lets go of a version set aside for the church’s when the workspace starts managing the Church Library (D36)', async () => {
    const { clock, instance, b, south1, south2, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)' });
    await south1.session.setUseChurchVersion(grace.id, true);
    await south1.client.run();
    await south2.client.run();
    clock.advance();
    instance.setManageLibrary(b.id, true);
    for (const computer of [south1, south2]) {
      await computer.client.run();
      expect(await computer.store.getSong(grace.id)).toMatchObject({
        title: 'Amazing Grace',
        origin: 'church',
        versions: null,
      });
      expect(await computer.store.getChurchVersion(grace.id)).toBeNull();
    }
  });

  it('hides a church song as the workspace’s own record, and the hidden song stays hidden', async () => {
    const { clock, church, south1, south2, grace } = await churchAndBranch();
    await south1.session.removeSong(grace.id);
    expect(await south1.store.getSong(grace.id)).toMatchObject({ origin: 'workspace' });
    await south1.client.run();
    await south2.client.run();
    expect(await south2.store.listSongs(south2.session.workspace.id)).toEqual([]);
    clock.advance();
    await church.session.saveSong(grace.id, { title: 'Still the church’s' });
    await church.client.run();
    await south2.client.run();
    expect(await south2.store.listSongs(south2.session.workspace.id)).toEqual([]);
  });

  it('keeps a version 2 computer presenting the workspace’s version, with nothing new (D26)', async () => {
    const { clock, instance, b, south1, grace } = await churchAndBranch();
    await south1.session.saveSong(grace.id, { title: 'Grace (South)' });
    await south1.client.run();
    clock.advance();
    const old = await device('old', clock, instance, 2);
    const code = instance.rotateCode(b.id);
    await old.connect(code, 'replace');
    expect(await old.store.getSong(grace.id)).toMatchObject({
      title: 'Grace (South)',
      origin: null,
      versions: null,
    });
    expect((await old.syncStore.getState()).manageLibrary).toBeNull();
  });

  it('edits the church’s song in place on a computer of the managing workspace', async () => {
    const { church, grace } = await churchAndBranch();
    await church.session.saveSong(grace.id, { title: 'Amazing Grace (church edit)' });
    expect(await church.store.getSong(grace.id)).toMatchObject({
      origin: 'church',
      versions: null,
      title: 'Amazing Grace (church edit)',
    });
  });
});

describe('Church Library types', () => {
  const titles = async (d: Awaited<ReturnType<typeof device>>) =>
    (await d.store.listSongs(d.session.workspace.id)).map((s) => s.title).sort();
  const deck = (id: string) => ({
    source: 'notices.pptx',
    width: 1920,
    height: 1080,
    pages: [{ image: `deck-${id}-001.jpg`, slide: 1, step: 0, text: ['Notices'] }],
  });

  /** A workspace managing the whole Church Library with a song, a deck and a website. */
  async function managingAndBranch() {
    const { clock, instance, workspace: a, code: codeA } = await setup();
    const { workspace: b, code: codeB } = instance.createWorkspace('South Branch');
    const church = await device('church', clock, instance);
    const grace = await church.session.createSong({ title: 'Amazing Grace', lyrics: 'a\nb' });
    const notices = await church.session.createSong({
      title: 'Notices',
      deck: deck('0b0b0b0b-0000-4000-8000-000000000001'),
    });
    const site = await church.session.createSong({
      title: 'Giving',
      website: { url: 'https://example.org/give' },
    });
    await church.connect(codeA, 'upload');
    instance.setManageLibrary(a.id, true);
    await church.client.run();
    clock.advance();
    const south = await device('south', clock, instance);
    await south.connect(codeB, 'upload');
    clock.advance();
    return { clock, instance, a, b, church, south, grace, notices, site };
  }

  it('keeps new slides in a workspace that manages only songs and backgrounds', async () => {
    const { clock, instance, a, church, south } = await managingAndBranch();
    expect(await titles(south)).toEqual(['Amazing Grace', 'Giving', 'Notices']);
    instance.setLibraryTypes(a.id, ['songs', 'backgrounds']);
    await church.client.run();
    expect(church.store.managesChurch('song')).toBe(true);
    expect(church.store.managesChurch('song', { deck: deck('x') })).toBe(false);
    expect((await church.syncStore.getState()).manageLibraryTypes).toEqual([
      'songs',
      'backgrounds',
    ]);

    clock.advance();
    const welcome = await church.session.createSong({
      title: 'Welcome',
      deck: deck('0b0b0b0b-0000-4000-8000-000000000002'),
    });
    expect(welcome.origin).toBeNull();
    await church.session.createSong({ title: 'How Great', lyrics: 'c' });
    clock.advance();
    await church.client.run();
    await south.client.run();
    // The song reaches the branch; the slides stay with the workspace.
    expect(await titles(south)).toEqual(['Amazing Grace', 'Giving', 'How Great', 'Notices']);
    expect((await church.store.getSong(welcome.id))?.origin).toBe('workspace');
    expect(instance.listChurch('song').map((item) => item.title)).not.toContain('Welcome');
  });

  it('takes the church’s slides and websites into the workspace, out of every other', async () => {
    const { clock, instance, a, b, church, south, grace, notices, site } =
      await managingAndBranch();
    // The branch makes its own version of the website, which it keeps.
    await south.session.saveSong(site.id, { title: 'Giving (South)' });
    await south.client.run();
    instance.setLibraryTypes(a.id, ['songs', 'backgrounds']);
    clock.advance();

    const dry = instance.takeFromChurch(a.id, ['slides', 'websites'], false);
    expect(dry.items.map((item) => [item.type, item.title])).toEqual([
      ['slides', 'Notices'],
      ['websites', 'Giving'],
    ]);
    expect(dry.files).toEqual(['deck-0b0b0b0b-0000-4000-8000-000000000001-001.jpg']);
    expect(instance.listChurch('song').filter((item) => item.removedAt)).toEqual([]);

    const taken = instance.takeFromChurch(a.id, ['slides', 'websites']);
    expect(taken.items).toHaveLength(2);
    expect(taken.sharedFiles).toEqual([]);
    await church.client.run();
    await south.client.run();

    expect(await church.store.getSong(notices.id)).toMatchObject({
      origin: 'workspace',
      versions: null,
      title: 'Notices',
    });
    expect((await church.store.getSong(site.id))?.origin).toBe('workspace');
    expect((await church.store.getSong(grace.id))?.origin).toBe('church');
    expect(await titles(church)).toEqual(['Amazing Grace', 'Giving', 'Notices']);

    // The branch no longer has the slides; its version of the website is its own.
    expect(await titles(south)).toEqual(['Amazing Grace', 'Giving (South)']);
    expect(await south.store.getSong(site.id)).toMatchObject({
      origin: 'workspace',
      versions: null,
    });
    expect(instance.listWorkspaceLibrary(b.id, 'song')).toEqual([
      expect.objectContaining({ title: 'Giving (South)', change: { type: 'own' } }),
    ]);
    // The church's is deleted, by the workspace, for good.
    const deleted = instance.listChurch('song').filter((item) => item.removedAt);
    expect(deleted.map((item) => item.title).sort()).toEqual(['Giving', 'Notices']);
    expect(deleted.every((item) => item.filesRemovedAt !== null)).toBe(true);
    expect(instance.restoreChurch('song', notices.id)).toBe('files-removed');

    // Edits to them stay in the workspace.
    clock.advance();
    await church.session.saveSong(notices.id, { title: 'Notices (new)' });
    await church.client.run();
    await south.client.run();
    expect(await titles(south)).toEqual(['Amazing Grace', 'Giving (South)']);
    expect(instance.listWorkspaceLibrary(a.id, 'song')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Notices (new)', change: { type: 'own' } }),
      ]),
    );
  });
});

describe('Church Library files', () => {
  it('move to a workspace with their deck’s original, copied when another still uses them', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-files-'));
    try {
      const church = churchFilesDir(dataDir);
      mkdirSync(church, { recursive: true });
      const id = '0b0b0b0b-0000-4000-8000-000000000001';
      const shared = '0b0b0b0b-0000-4000-8000-000000000002';
      for (const name of [
        `deck-${id}-001.jpg`,
        `deck-${id}-original.pptx`,
        `deck-${shared}-001.jpg`,
        `deck-${shared}-original.key`,
        'other.jpg',
      ]) {
        writeFileSync(join(church, name), 'x');
      }
      const moved = moveFilesToWorkspace(
        dataDir,
        'ws-a',
        [`deck-${id}-001.jpg`, `deck-${shared}-001.jpg`],
        [`deck-${shared}-001.jpg`],
      );
      expect(moved).toBe(4);
      const own = workspaceFilesDir(dataDir, 'ws-a');
      expect(readdirSync(own).sort()).toEqual([
        `deck-${id}-001.jpg`,
        `deck-${id}-original.pptx`,
        `deck-${shared}-001.jpg`,
        `deck-${shared}-original.key`,
      ]);
      // The shared deck stays in the church's folder too; the rest left it.
      expect(readdirSync(church).sort()).toEqual([
        `deck-${shared}-001.jpg`,
        `deck-${shared}-original.key`,
        'other.jpg',
      ]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('a workspace that managed the whole Church Library manages every type after the upgrade', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-db-'));
    try {
      const path = join(dataDir, 'instance.db');
      const before = openDatabase(path);
      const instance = new Instance(before);
      const managing = instance.createWorkspace('North').workspace;
      const other = instance.createWorkspace('South').workspace;
      // As the database was before management was per type.
      const version = Number(before.prepare('PRAGMA user_version').get()!.user_version);
      // The migrations since then are undone too, so that they run again.
      before.exec('ALTER TABLE pairing_request DROP COLUMN allow_merge');
      before.exec('ALTER TABLE workspace DROP COLUMN library_types');
      before.prepare('UPDATE workspace SET manage_library = 1 WHERE id = ?').run(managing.id);
      before.exec(`PRAGMA user_version = ${version - 2}`);
      before.close();

      const after = new Instance(openDatabase(path));
      expect(after.getWorkspace(managing.id)?.libraryTypes).toEqual([...LIBRARY_TYPES]);
      expect(after.getWorkspace(other.id)?.libraryTypes).toEqual([]);
      after.db.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('are found in the workspace’s folder, then the church’s, and moved there', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-files-'));
    try {
      const own = workspaceFilesDir(dataDir, 'ws-a');
      mkdirSync(own, { recursive: true });
      writeFileSync(join(own, 'a.jpg'), 'a');
      writeFileSync(join(own, 'b.jpg.partial'), 'b');
      expect(findFile(dataDir, 'ws-a', 'a.jpg')).toBe(join(own, 'a.jpg'));
      expect(findFile(dataDir, 'ws-b', 'a.jpg')).toBeNull();

      expect(moveFilesToChurch(dataDir, 'ws-a', ['a.jpg', 'b.jpg.partial'])).toBe(1);
      expect(findFile(dataDir, 'ws-b', 'a.jpg')).toBe(join(churchFilesDir(dataDir), 'a.jpg'));
      expect(existsSync(join(own, 'a.jpg'))).toBe(false);
      expect(moveFilesToChurch(dataDir, 'ws-missing', ['a.jpg'])).toBe(0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
