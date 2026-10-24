import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '@worship-q/session';
import { migrate, Store, SyncStore, type StoreEnv } from '@worship-q/store';
import { openNodeDriver } from '@worship-q/store/testing';
import { SyncClient, type FileTransfer, type InstanceApi } from '@worship-q/sync';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db';
import { churchFilesDir, findFile, moveFilesToChurch, workspaceFilesDir } from './files';
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

function directApi(instance: Instance, token: () => string | null): InstanceApi {
  const device = () => {
    const found = instance.authenticate(token() ?? '');
    if (!found) throw new Error('unauthorized');
    return found;
  };
  return {
    enroll: async (code, name) => {
      const enrolled = instance.enroll(code, name);
      if (!enrolled) throw new Error('invalid-code');
      const workspace = instance.getWorkspace(enrolled.device.workspaceId)!;
      return { deviceId: enrolled.device.id, deviceToken: enrolled.token, workspace };
    },
    workspace: async () => {
      const d = device();
      return { ...instance.getWorkspace(d.workspaceId)!, deviceName: d.name };
    },
    claim: async (contentId) => instance.claimContent(device().workspaceId, contentId),
    push: async (records) => {
      const d = device();
      return { remap: instance.push(d.workspaceId, d.id, records).remap };
    },
    pull: async (since) => ({
      ...instance.pull(device().workspaceId, since, 3),
      church: instance.churchSettings(),
    }),
  };
}

const noFiles: FileTransfer = {
  upload: async () => undefined,
  download: async () => undefined,
  missing: async () => [],
};

async function device(name: string, clock: Clock, instance: Instance) {
  const driver = openNodeDriver();
  await migrate(driver);
  let counter = 0;
  const env: StoreEnv = { now: clock.now, newId: () => `${name}-${++counter}` };
  const store = new Store(driver, env);
  const { session } = await Session.open(store, { now: clock.date }, 'Europe/London');
  const syncStore = new SyncStore(store);
  let token: string | null = null;
  const api = directApi(instance, () => token);
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
    expect(instance.libraryPlan(a.id)).toEqual({
      songs: ['Amazing Grace', 'Holy Holy'],
      backgrounds: ['Sunrise.jpg'],
      overrides: [],
      hidden: [],
    });
    instance.setManageLibrary(a.id, true);
    expect(instance.getWorkspace(a.id)?.manageLibrary).toBe(true);

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
    expect(instance.libraryPlan(b.id)).toEqual({
      songs: ['South Only'],
      backgrounds: [],
      overrides: ['Grace, South'],
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

describe('Church Library files', () => {
  it('are found in the workspace’s folder, then the church’s, and moved there', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-files-'));
    try {
      const own = workspaceFilesDir(dataDir, 'ws-a');
      mkdirSync(own, { recursive: true });
      writeFileSync(join(own, 'a.jpg'), 'a');
      writeFileSync(join(own, 'b.jpg.partial'), 'b');
      expect(findFile(dataDir, 'ws-a', 'a.jpg')).toBe(join(own, 'a.jpg'));
      expect(findFile(dataDir, 'ws-b', 'a.jpg')).toBeNull();

      expect(moveFilesToChurch(dataDir, 'ws-a')).toBe(1);
      expect(findFile(dataDir, 'ws-b', 'a.jpg')).toBe(join(churchFilesDir(dataDir), 'a.jpg'));
      expect(existsSync(join(own, 'a.jpg'))).toBe(false);
      expect(moveFilesToChurch(dataDir, 'ws-missing')).toBe(0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
