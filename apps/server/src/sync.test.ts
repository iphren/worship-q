import { Session } from '@worship-q/session';
import { migrate, Store, SyncStore, type StoreEnv } from '@worship-q/store';
import { openNodeDriver } from '@worship-q/store/testing';
import { SyncClient, type FileTransfer, type InstanceApi } from '@worship-q/sync';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db';
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
    async connect(code: string, mode: 'upload' | 'merge' | 'replace') {
      const enrolled = await client.enroll('https://example.org', code, name);
      token = enrolled.deviceToken;
      await client.join(mode);
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
