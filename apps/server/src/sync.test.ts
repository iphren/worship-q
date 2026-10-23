import { Session } from '@worship-q/session';
import { migrate, Store, SyncStore, type StoreEnv } from '@worship-q/store';
import { openNodeDriver } from '@worship-q/store/testing';
import { SyncClient, type FileTransfer, type InstanceApi } from '@worship-q/sync';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db';
import { Instance } from './instance';

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
