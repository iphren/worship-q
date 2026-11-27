import { PROTOCOL_VERSION, type HostToRemote, type WorkspaceGrant } from '@worship-q/protocol';
import { Session } from '@worship-q/session';
import { createTestEnv, createTestStore, type NodeDriver } from '@worship-q/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteHost } from './index';

let driver: NodeDriver;
let session: Session;
let host: RemoteHost;
let sent: { to: string | undefined; message: HostToRemote }[];

beforeEach(async () => {
  const test = await createTestStore(undefined, createTestEnv('2026-10-11T09:00:00.000Z'));
  driver = test.driver;
  ({ session } = await Session.open(test.store, { now: () => test.env.date() }, 'UTC'));
  const a = await session.createSong({
    title: 'Amazing Grace',
    lyrics: 'Amazing grace\nHow sweet',
  });
  await session.addSong(session.today(), a.id);
  host = new RemoteHost(session, () => 'Sunday');
  sent = [];
  host.attach({ send: (to, message) => sent.push({ to, message }), drop: () => undefined });
});
afterEach(() => {
  host.dispose();
  driver.close();
});

/** Joins with an invitation and has the operator approve it. */
async function approved(connection: string, name = 'Sam') {
  const invite = host.invite();
  await host.message(connection, {
    type: 'hello',
    protocolVersion: PROTOCOL_VERSION,
    name,
    invite,
  });
  await host.approve(connection);
}

function lastTo(connection: string) {
  return sent.filter((entry) => entry.to === connection).at(-1)?.message;
}

describe('remote run-sheet editing', () => {
  it('tells controllers the live run sheet can be edited', async () => {
    await approved('p1');
    const view = sent.find((entry) => entry.message.type === 'view')?.message;
    expect(view).toMatchObject({ view: { editable: true } });
  });

  it('answers a search with the operator’s results', async () => {
    await approved('p1');
    await host.message('p1', { type: 'search', id: 's1', query: 'grace' });
    expect(lastTo('p1')).toEqual({
      type: 'searchResults',
      id: 's1',
      songs: [
        expect.objectContaining({
          title: 'Amazing Grace',
          kind: 'lyrics',
          preview: ['Amazing grace', 'How sweet'],
        }),
      ],
    });
  });

  it('sends each item’s badge, as the desktop marks it', async () => {
    const web = await session.createSong({
      title: 'Notices',
      lyrics: '',
      website: { url: 'https://example.com' },
    });
    await session.addSong(session.today(), web.id);
    await session.goLive(session.today());
    await approved('p1');
    await host.message('p1', { type: 'search', id: 's1', query: 'notices' });
    expect(lastTo('p1')).toMatchObject({ songs: [{ title: 'Notices', badge: 'website' }] });
    const view = [...sent].reverse().find((s) => s.message.type === 'view')?.message;
    const items = view?.type === 'view' ? view.view.items : [];
    expect(items.map((item) => item.badge)).toEqual([undefined, 'website']);
  });

  it('ignores searches and edits from connections that were not approved', async () => {
    const invite = host.invite();
    await host.message('p2', {
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      name: 'X',
      invite,
    });
    await host.message('p2', { type: 'search', id: 's1', query: 'grace' });
    const [song] = await session.store.listSongs(session.workspace.id);
    await host.message('p2', {
      type: 'command',
      id: 'c1',
      command: { type: 'addItem', songId: song!.id },
    });
    expect(sent.filter((entry) => entry.to === 'p2').map((entry) => entry.message.type)).toEqual([
      'pending',
    ]);
    expect((await session.viewLive())!.entries).toHaveLength(1);
  });

  it('shows the operator a removal, and undoes it, but not an addition', async () => {
    await approved('p1', 'Sam');
    const [song] = await session.store.listSongs(session.workspace.id);
    await host.message('p1', {
      type: 'command',
      id: 'c1',
      command: { type: 'addItem', songId: song!.id },
    });
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'c1', applied: true });
    expect(host.notices).toEqual([]);
    const added = (await session.viewLive())!.entries[1]!.item;

    await host.message('p1', {
      type: 'command',
      id: 'c2',
      command: { type: 'removeItem', itemId: added.id },
    });
    expect(host.notices).toEqual([
      expect.objectContaining({
        name: 'Sam',
        change: expect.objectContaining({ kind: 'removed' }),
      }),
    ]);
    expect((await session.viewLive())!.entries).toHaveLength(1);

    expect(await host.undo(host.notices[0]!.id)).toBe(true);
    expect(host.notices).toEqual([]);
    expect((await session.viewLive())!.entries).toHaveLength(2);
  });

  it('acknowledges an edit that could not be made without a notice', async () => {
    await approved('p1');
    await host.message('p1', {
      type: 'command',
      id: 'c1',
      command: { type: 'removeItem', itemId: 'missing' },
    });
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'c1', applied: false });
    expect(host.notices).toEqual([]);
  });
});

describe('phones on a follower (M2.6, M2.7, D25)', () => {
  function coordination(coordinating: boolean) {
    const forwarded: unknown[] = [];
    const registered: WorkspaceGrant[] = [];
    const revoked: (string | null)[] = [];
    const phones: unknown[] = [];
    host.setCoordination({
      coordinating,
      forward: async (id, origin, command) => {
        forwarded.push({ id, origin, command });
        return true;
      },
      registerGrant: (grant) => void registered.push(grant),
      revokeGrant: (id) => void revoked.push(id),
      phones: (list) => void phones.push(list),
    });
    return { forwarded, registered, revoked, phones };
  }

  it('forwards an approved phone’s commands to the coordinator in the phone’s name', async () => {
    const { forwarded, registered, phones } = coordination(false);
    await approved('p1', 'Sam');
    expect(registered).toEqual([
      expect.objectContaining({ name: 'Sam', secretHash: expect.any(String) }),
    ]);
    expect(phones.at(-1)).toEqual([{ grantId: registered[0]!.id, name: 'Sam' }]);
    await host.message('p1', { type: 'command', id: 'c1', command: { type: 'next' } });
    expect(forwarded).toEqual([
      {
        id: 'c1',
        origin: { kind: 'phone', grantId: registered[0]!.id, name: 'Sam' },
        command: { type: 'next' },
      },
    ]);
    // Nothing was applied here; the coordinator's snapshot brings the change.
    expect(session.live?.presented).toBeNull();
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'c1', applied: true });
    expect(host.notices).toEqual([]);
  });

  it('applies commands itself while coordinating', async () => {
    coordination(true);
    await approved('p1');
    await host.message('p1', { type: 'command', id: 'c1', command: { type: 'next' } });
    expect(session.live?.presented).not.toBeNull();
  });

  it('accepts a grant approved on another computer from the coordinator’s list, and drops one revoked there', async () => {
    coordination(false);
    const grant = {
      id: 'g-other',
      secretHash: await sha('s3cret'),
      name: 'Kim',
      createdAt: '2026-10-11T09:00:00.000Z',
    };
    await host.applyGrantList([grant]);
    await host.message('p9', {
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      name: 'Kim',
      grant: 'g-other.s3cret',
    });
    expect(sent.filter((e) => e.to === 'p9').map((e) => e.message.type)).toEqual([
      'approved',
      'view',
    ]);
    expect(host.connected.map((c) => c.name)).toEqual(['Kim']);
    await host.applyGrantList([]);
    expect(lastTo('p9')).toEqual({ type: 'denied', reason: 'revoked' });
    expect(host.connected).toEqual([]);
    expect(await host.localGrants()).toEqual([]);
  });

  it('tells the coordinator about revocations made here', async () => {
    const { revoked } = coordination(false);
    await approved('p1');
    const grantId = host.connected[0]!.grantId;
    await host.disconnect('p1');
    await host.disconnectAll();
    expect(revoked).toEqual([grantId, null]);
  });

  it('shows an edit made elsewhere without a way to undo it (D24)', async () => {
    const [song] = await session.store.listSongs(session.workspace.id);
    const item = await session.addSong(session.today(), song!.id);
    await session.removeItem(item.id);
    host.notify('Streaming laptop', { kind: 'removed', item, title: 'Amazing Grace' }, false);
    expect(host.notices[0]).toMatchObject({ name: 'Streaming laptop', undoable: false });
    expect(await host.undo(host.notices[0]!.id)).toBe(false);
    expect((await session.viewLive())!.entries).toHaveLength(1);
  });

  it('does not show an addition or a move, which the run sheet itself shows', async () => {
    const [song] = await session.store.listSongs(session.workspace.id);
    const item = await session.addSong(session.today(), song!.id);
    const change = {
      kind: 'moved',
      item,
      title: 'Amazing Grace',
      fromIndex: 0,
      toIndex: 1,
    } as const;
    host.notify('Anna', change);
    host.notify('Streaming laptop', change, false);
    host.notify('Anna', { kind: 'added', item, title: 'Amazing Grace' });
    expect(host.notices).toEqual([]);
  });

  it('puts this device’s identifier in its invitations, so the relay routes scans here', async () => {
    const routed = new RemoteHost(
      session,
      () => 'Sunday',
      () => Date.now(),
      () => 'device-B',
    );
    routed.attach({ send: () => undefined, drop: () => undefined });
    const invite = routed.invite();
    expect(invite.startsWith('device-B.')).toBe(true);
    await routed.message('p1', {
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      name: 'Sam',
      invite,
    });
    expect(routed.pending).toHaveLength(1);
    routed.dispose();
  });
});

async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('OBS on phones (OBS plan M2.8)', () => {
  const idle = { active: false, phase: null, durationMs: null, paused: false };
  const obsView = {
    status: 'connected' as const,
    ownerName: 'Streaming laptop',
    reachable: true,
    scenes: ['Lyrics', 'Camera'],
    currentScene: 'Lyrics',
    favourites: ['Lyrics', 'Camera'] as [string, string],
    stream: idle,
    record: idle,
    virtualCam: idle,
  };

  function fakeObs() {
    const fake = {
      commands: [] as unknown[],
      watching: [] as boolean[],
      current: obsView as typeof obsView | null,
      view: () => fake.current,
      command: async (command: unknown) => {
        fake.commands.push(command);
        return { ok: false, code: 600, error: 'No such scene' };
      },
      watch: (on: boolean) => fake.watching.push(on),
    };
    host.setObs({ view: fake.view, command: fake.command, watching: fake.watch });
    return fake;
  }

  const views = (connection: string) =>
    sent.filter((e) => e.to === connection && e.message.type === 'view').map((e) => e.message);

  it('shows phones OBS in their view, and nothing where there is none', async () => {
    await approved('p1');
    expect(views('p1').at(-1)).toMatchObject({ view: { obs: null } });
    const fake = fakeObs();
    await new Promise((done) => setTimeout(done, 120));
    expect(views('p1').at(-1)).toMatchObject({ view: { obs: { ownerName: 'Streaming laptop' } } });
    fake.current = null;
    host.obsChanged();
    await new Promise((done) => setTimeout(done, 120));
    expect(views('p1').at(-1)).toMatchObject({ view: { obs: null } });
  });

  it('passes an approved phone’s command on and answers it with OBS’s reply', async () => {
    const fake = fakeObs();
    await approved('p1');
    await host.message('p1', {
      type: 'obsCommand',
      id: 'o1',
      command: { type: 'setScene', scene: 'Gone' },
    });
    expect(fake.commands).toEqual([{ type: 'setScene', scene: 'Gone' }]);
    expect(lastTo('p1')).toEqual({
      type: 'obsAck',
      id: 'o1',
      ok: false,
      code: 600,
      error: 'No such scene',
    });
  });

  it('ignores a phone that was not approved, and answers no-obs where there is none', async () => {
    const fake = fakeObs();
    await host.message('stranger', {
      type: 'obsCommand',
      id: 'x',
      command: { type: 'startStream' },
    });
    expect(fake.commands).toEqual([]);
    host.setObs(null);
    await approved('p1');
    await host.message('p1', { type: 'obsCommand', id: 'o2', command: { type: 'startStream' } });
    expect(lastTo('p1')).toEqual({ type: 'obsAck', id: 'o2', ok: false, error: 'no-obs' });
  });

  it('counts phones watching the monitor, and sends images to those only', async () => {
    const fake = fakeObs();
    await approved('p1');
    await approved('p2', 'Alex');
    await host.message('p1', { type: 'obsWatch', watching: true });
    await host.message('p2', { type: 'obsWatch', watching: true });
    expect(fake.watching).toEqual([true]);
    host.obsSnapshot({ image: 'data:image/webp;base64,AAAA', takenAt: 't' });
    await host.message('p2', { type: 'obsWatch', watching: false });
    host.obsSnapshot({ image: 'data:image/webp;base64,BBBB', takenAt: 't2' });
    const images = sent.filter((e) => e.message.type === 'obsSnapshot').map((e) => e.to);
    expect(images).toEqual(['p1', 'p2', 'p1']);
    expect(fake.watching).toEqual([true]);
  });

  it('stops counting a watching phone that leaves or loses its approval', async () => {
    const fake = fakeObs();
    await approved('p1');
    await host.message('p1', { type: 'obsWatch', watching: true });
    host.left('p1');
    expect(fake.watching).toEqual([true, false]);
    await approved('p2', 'Alex');
    await host.message('p2', { type: 'obsWatch', watching: true });
    await host.disconnectAll();
    expect(fake.watching).toEqual([true, false, true, false]);
    // A stranger cannot make the OBS computer take screenshots.
    await host.message('stranger', { type: 'obsWatch', watching: true });
    expect(fake.watching).toEqual([true, false, true, false]);
  });
});

describe('videos on phones (media uploads M5.5, M6.6)', () => {
  const video = {
    file: 'video-0f8fad5b-d9cb-469f-a165-70867728950e.mp4',
    source: 'Welcome.mp4',
    width: 1920,
    height: 1080,
    durationSeconds: 90,
    bytes: 1000,
    autoplay: false,
  };

  async function presentVideo() {
    const clip = await session.createSong({ title: 'Welcome', video });
    await session.addSong(session.today(), clip.id);
    const view = (await session.viewLive())!;
    const entry = view.entries.find((e) => e.song.id === clip.id)!;
    await session.play(entry.item.id, 'video');
    return entry.item.id;
  }

  it('shows a video item’s title and duration, and its clock while presented', async () => {
    const itemId = await presentVideo();
    await approved('p1');
    const view = sent.filter((e) => e.message.type === 'view').at(-1)!.message as Extract<
      HostToRemote,
      { type: 'view' }
    >;
    expect(view.view.items.find((item) => item.itemId === itemId)).toMatchObject({
      kind: 'video',
      title: 'Welcome',
      pieces: [{ id: 'video', lines: ['1:30'], textless: true }],
    });
    expect(view.view.video).toMatchObject({
      itemId,
      playing: false,
      position: 0,
      durationSeconds: 90,
    });
  });

  it('offers captions only for a YouTube video, and applies a phone’s captions (protocol 11)', async () => {
    const view = () =>
      (
        sent.filter((e) => e.message.type === 'view').at(-1)!.message as Extract<
          HostToRemote,
          { type: 'view' }
        >
      ).view;
    await presentVideo();
    await approved('p1');
    expect(view().video).not.toHaveProperty('captions');

    const youtube = await session.createSong({
      title: 'Video',
      website: { url: 'https://youtu.be/dQw4w9WgXcQ', durationSeconds: 213 },
    });
    await session.addSong(session.today(), youtube.id);
    const entry = (await session.viewLive())!.entries.find((e) => e.song.id === youtube.id)!;
    await session.play(entry.item.id, 'website');
    await host.message('p1', {
      type: 'command',
      id: 'cc1',
      command: { type: 'videoCaptions', itemId: entry.item.id, on: true },
    });
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'cc1', applied: true });
    expect(session.video).toMatchObject({ captions: true });
  });

  it('applies a phone’s play, pause and seek, and acknowledges each', async () => {
    const itemId = await presentVideo();
    await approved('p1');
    await host.message('p1', { type: 'command', id: 'v1', command: { type: 'videoPlay', itemId } });
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'v1', applied: true });
    expect(session.video).toMatchObject({ playing: true });
    await host.message('p1', {
      type: 'command',
      id: 'v2',
      command: { type: 'videoSeek', itemId, seconds: 30 },
    });
    expect(session.video).toMatchObject({ position: 30 });
    await host.message('p1', {
      type: 'command',
      id: 'v3',
      command: { type: 'videoPause', itemId },
    });
    expect(session.video).toMatchObject({ playing: false });
  });

  it('forwards a phone’s video command to the coordinator with its id', async () => {
    const forwarded: unknown[] = [];
    host.setCoordination({
      coordinating: false,
      forward: async (id, _origin, command) => {
        forwarded.push({ id, command });
        return true;
      },
      registerGrant: () => undefined,
      revokeGrant: () => undefined,
      phones: () => undefined,
    });
    await approved('p1');
    await host.message('p1', {
      type: 'command',
      id: 'v1',
      command: { type: 'videoPlay', itemId: 'item' },
    });
    expect(forwarded).toEqual([{ id: 'v1', command: { type: 'videoPlay', itemId: 'item' } }]);
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'v1', applied: true });
  });
});

describe('the Bible on phones (P7.1, P7.2, B15, B26)', () => {
  const toc = { version: 'NIVUK', books: [{ book: 'MRK', name: 'Mark', chapters: [45, null] }] };
  const passage = {
    reference: 'MRK.15.5',
    texts: [
      {
        version: 'NIVUK',
        credit: 'NIVUK',
        provider: 'youversion' as const,
        copyright: '',
        units: [
          { chapter: 15, verses: [5], label: '5', lines: [{ text: 'But Jesus', indent: 0 }] },
        ],
        fumsToken: null,
      },
    ],
  };
  const calls: string[] = [];
  const bible = {
    versions: async () => ({
      offered: [{ id: 'NIVUK', name: 'NIV', credit: 'NIVUK', language: 'en' as const }],
      versions: ['NIVUK'],
    }),
    setVersions: async (versions: string[]) => void calls.push(`set ${versions.join(',')}`),
    toc: async (version: string, chapter?: { book: string; chapter: number }) => {
      calls.push(`toc ${version}${chapter ? ` ${chapter.book}.${chapter.chapter}` : ''}`);
      return toc;
    },
    passage: async () => passage,
    search: async () => ({ references: ['MRK.15.5'], searched: true }),
  };

  beforeEach(() => {
    calls.length = 0;
    host.setBible(bible);
  });

  it('answers each request through the desktop, with the workspace’s versions', async () => {
    await approved('p1');
    await host.message('p1', { type: 'bibleVersions', id: 'v' });
    expect(lastTo('p1')).toEqual({
      type: 'bibleVersions',
      id: 'v',
      offered: [{ id: 'NIVUK', name: 'NIV', credit: 'NIVUK', language: 'en' }],
      versions: ['NIVUK'],
    });
    await host.message('p1', {
      type: 'bibleToc',
      id: 't',
      version: 'NIVUK',
      book: 'MRK',
      chapter: 2,
    });
    expect(lastTo('p1')).toEqual({ type: 'bibleToc', id: 't', toc });
    expect(calls).toContain('toc NIVUK MRK.2');
    await host.message('p1', {
      type: 'biblePassage',
      id: 'p',
      reference: 'MRK.15.5',
      versions: ['NIVUK'],
    });
    expect(lastTo('p1')).toEqual({ type: 'biblePassage', id: 'p', passage });
    await host.message('p1', { type: 'bibleSearch', id: 's', version: 'NIVUK', query: 'love' });
    expect(lastTo('p1')).toEqual({
      type: 'bibleSearch',
      id: 's',
      references: ['MRK.15.5'],
      searched: true,
    });
    await host.message('p1', { type: 'bibleSetVersions', versions: ['NIVUK'] });
    expect(calls).toContain('set NIVUK');
  });

  it('refuses a version the church does not offer', async () => {
    await approved('p1');
    await host.message('p1', { type: 'bibleToc', id: 't', version: 'ESV' });
    expect(lastTo('p1')).toEqual({ type: 'bibleToc', id: 't', toc: null, error: 'not-offered' });
    await host.message('p1', {
      type: 'biblePassage',
      id: 'p',
      reference: 'MRK.15.5',
      versions: ['NIVUK', 'ESV'],
    });
    expect(lastTo('p1')).toMatchObject({ passage: null, error: 'not-offered' });
    await host.message('p1', { type: 'bibleSearch', id: 's', version: 'ESV', query: 'x' });
    expect(lastTo('p1')).toMatchObject({ references: [], error: 'not-offered' });
  });

  it('says offline when the desktop has no Bible, and passes on a refused passage', async () => {
    await approved('p1');
    host.setBible({
      ...bible,
      passage: async () => {
        throw Object.assign(new Error('nope'), { code: 'not-found' });
      },
    });
    await host.message('p1', {
      type: 'biblePassage',
      id: 'p',
      reference: 'MRK.15.5',
      versions: ['NIVUK'],
    });
    expect(lastTo('p1')).toMatchObject({ passage: null, error: 'not-found' });
    host.setBible(null);
    await host.message('p1', { type: 'bibleToc', id: 't', version: 'NIVUK' });
    expect(lastTo('p1')).toMatchObject({ toc: null, error: 'offline' });
  });

  it('ignores Bible requests from a connection not approved', async () => {
    const invite = host.invite();
    await host.message('p2', {
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      name: 'X',
      invite,
    });
    await host.message('p2', { type: 'bibleVersions', id: 'v' });
    expect(sent.filter((e) => e.to === 'p2').map((e) => e.message.type)).toEqual(['pending']);
  });

  it('adds a phone’s passage after the presented item, and presents it when asked', async () => {
    const b = await session.createSong({ title: 'B', lyrics: 'b1' });
    await session.addSong(session.today(), b.id);
    const view = (await session.viewLive())!;
    await session.play(view.entries[0]!.item.id, view.entries[0]!.pieces[0]!.id);
    await approved('p1', 'Sam');
    await host.message('p1', {
      type: 'command',
      id: 'c1',
      command: { type: 'addPassage', passage, present: true },
    });
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'c1', applied: true });
    const titles = (await session.viewLive())!.entries.map((entry) => entry.song.title);
    expect(titles).toEqual(['Amazing Grace', 'Mark 15:5', 'B']);
    expect(session.live!.presented!.pieceId).toBe('v15:5');
    // The phone sees the passage's slide with its columns.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const fresh = [...sent].reverse().find((s) => s.message.type === 'view')?.message;
    const item =
      fresh?.type === 'view' ? fresh.view.items.find((i) => i.title === 'Mark 15:5') : null;
    expect(item).toMatchObject({ kind: 'passage', badge: 'bible' });
    expect(item!.pieces[0]!.passage!.columns[0]!.credit).toBe('NIVUK');
  });
});

describe('websites added by their address from phones (protocol 8)', () => {
  it('says in the view whether phones can add websites', async () => {
    await approved('p1', 'Sam');
    const first = lastTo('p1');
    expect(first?.type === 'view' && first.view.websites).toBe(false);
    host.setWebsites({ available: () => true, title: () => Promise.resolve(null) });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const fresh = lastTo('p1');
    expect(fresh?.type === 'view' && fresh.view.websites).toBe(true);
  });

  it('adds a phone’s website named by the title read here', async () => {
    const asked: string[] = [];
    host.setWebsites({
      available: () => true,
      title: (url) => {
        asked.push(url);
        return Promise.resolve('Live stream');
      },
    });
    await approved('p1', 'Sam');
    await host.message('p1', {
      type: 'command',
      id: 'c1',
      command: { type: 'addWebsite', url: 'example.org/live' },
    });
    expect(asked).toEqual(['example.org/live']);
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'c1', applied: true });
    const titles = (await session.viewLive())!.entries.map((entry) => entry.song.title);
    expect(titles.at(-1)).toBe('Live stream');
  });
});

describe('live audio for phones (M4.1, M4.2)', () => {
  function audio() {
    const signals: { phone: { grantId: string; name: string }; kind: string }[] = [];
    const gone: string[] = [];
    const left: string[] = [];
    let view: { ownerId: string; ownerName: string; activatedAt: string; status: 'live' } | null =
      null;
    host.setAudio({
      view: () => view,
      signal: (phone, signal) => signals.push({ phone, kind: signal.kind }),
      gone: (grantId) => gone.push(grantId),
      left: (grantId) => left.push(grantId),
    });
    return {
      signals,
      gone,
      left,
      setView: (next: typeof view) => {
        view = next;
      },
    };
  }

  const grantOf = (connection: string) => {
    const approval = sent.find((e) => e.to === connection && e.message.type === 'approved');
    return (approval!.message as { grant: string }).grant.split('.')[0]!;
  };

  it('shows null with no broadcast, and the broadcaster with one', async () => {
    const env = audio();
    await approved('p1');
    const first = sent.filter((e) => e.message.type === 'view').at(-1)!.message;
    expect(first).toMatchObject({ view: { audio: null } });
    env.setView({ ownerId: 'B', ownerName: 'Sound desk', activatedAt: 't', status: 'live' });
    host.audioChanged();
    await new Promise((done) => setTimeout(done, 120));
    const next = sent.filter((e) => e.message.type === 'view').at(-1)!.message;
    expect(next).toMatchObject({ view: { audio: { ownerName: 'Sound desk', status: 'live' } } });
  });

  it('forwards an approved phone’s signal in its grant’s name, and ignores one not approved', async () => {
    const env = audio();
    await approved('p1', 'Sam');
    await host.message('p1', { type: 'audioSignal', signal: { kind: 'listen', session: 's' } });
    expect(env.signals).toEqual([
      { phone: { grantId: grantOf('p1'), name: 'Sam' }, kind: 'listen' },
    ]);
    await host.message('stranger', {
      type: 'audioSignal',
      signal: { kind: 'listen', session: 's' },
    });
    expect(env.signals).toHaveLength(1);
  });

  it('delivers the broadcaster’s signals to that phone only', async () => {
    audio();
    await approved('p1', 'Sam');
    await approved('p2', 'Kim');
    const grant = grantOf('p1');
    sent.length = 0;
    host.audioSignal(grant, { kind: 'retaken', session: 's' });
    expect(sent.map((e) => e.to)).toEqual(['p1']);
  });

  it('closes a phone’s audio at once when its grant is revoked', async () => {
    const env = audio();
    await approved('p1');
    const grant = host.connected[0]!.grantId;
    await host.disconnect('p1');
    expect(env.gone).toEqual([grant]);
  });

  it('closes every phone’s audio when every grant is revoked', async () => {
    const env = audio();
    await approved('p1');
    await approved('p2');
    await host.disconnectAll();
    expect(env.gone).toHaveLength(2);
  });

  it('says a phone left only after 10 s without it, and never that its grant is gone', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const env = audio();
      await approved('p1');
      const grant = host.connected[0]!.grantId;
      host.left('p1');
      vi.advanceTimersByTime(9000);
      expect(env.left).toEqual([]);
      vi.advanceTimersByTime(1000);
      // Only what it opened through this desktop is closed: it may listen through another.
      expect(env.left).toEqual([grant]);
      expect(env.gone).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing when the phone is back within the 10 s', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const env = audio();
      await approved('p1');
      const grant = (
        sent.find((e) => e.to === 'p1' && e.message.type === 'approved')!.message as {
          grant: string;
        }
      ).grant;
      host.left('p1');
      vi.advanceTimersByTime(5000);
      await host.message('p1-again', {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        name: 'Phone',
        grant,
      });
      vi.advanceTimersByTime(60_000);
      expect(env.left).toEqual([]);
      expect(env.gone).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says once that a phone left when the relay goes away with it', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const env = audio();
      await approved('p1');
      const grant = host.connected[0]!.grantId;
      host.detach();
      host.left('p1');
      vi.advanceTimersByTime(10_000);
      expect(env.left).toEqual([grant]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('slide thumbnails from this desktop (public server S7)', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const thumb = `deck-${ID}-001-t.jpg`;

  async function deckLive() {
    const deck = await session.createSong({
      title: 'Talk',
      lyrics: 'Hello',
      deck: {
        source: 'Talk.pptx',
        width: 1440,
        height: 1080,
        pages: [
          { image: `deck-${ID}-001.jpg`, thumbnail: thumb, slide: 1, step: 0, text: ['Hello'] },
        ],
      },
    });
    await session.addSong(session.today(), deck.id);
    await session.goLive(session.today());
  }

  it('marks the view, and answers a thumbnail of the live run sheet with its bytes', async () => {
    const read: string[] = [];
    host.setThumbnails({ read: async (name) => (read.push(name), 'aGVsbG8='), everyone: true });
    await deckLive();
    await approved('p1');
    const view = sent.filter((e) => e.message.type === 'view').at(-1)?.message;
    expect(view).toMatchObject({ view: { thumbnailVia: 'host' } });
    await host.message('p1', { type: 'thumbnail', name: thumb });
    expect(lastTo('p1')).toEqual({ type: 'thumbnail', name: thumb, data: 'aGVsbG8=' });
    expect(read).toEqual([thumb]);
  });

  it('answers missing for a slide not in the live run sheet, never reading it', async () => {
    const read: string[] = [];
    host.setThumbnails({ read: async (name) => (read.push(name), 'x'), everyone: true });
    await deckLive();
    await approved('p1');
    const other = `deck-${ID.replace('0f', '1f')}-001-t.jpg`;
    await host.message('p1', { type: 'thumbnail', name: other });
    expect(lastTo('p1')).toEqual({ type: 'thumbnail', name: other, missing: true });
    expect(read).toEqual([]);
  });

  it('ignores a name that is not a thumbnail’s, as the phone’s messages are checked', async () => {
    host.setThumbnails({ read: async () => 'x', everyone: true });
    await deckLive();
    await approved('p1');
    const before = sent.length;
    await host.message('p1', { type: 'thumbnail', name: '../instance.db' });
    expect(sent).toHaveLength(before);
  });

  it('answers missing when this computer lacks the file', async () => {
    host.setThumbnails({ read: async () => null, everyone: true });
    await deckLive();
    await approved('p1');
    await host.message('p1', { type: 'thumbnail', name: thumb });
    expect(lastTo('p1')).toEqual({ type: 'thumbnail', name: thumb, missing: true });
  });

  it('answers a phone without approval nothing', async () => {
    host.setThumbnails({ read: async () => 'x', everyone: true });
    await deckLive();
    await host.message('p9', { type: 'thumbnail', name: thumb });
    expect(sent.filter((e) => e.to === 'p9')).toEqual([]);
  });

  it('leaves the view unmarked on a church server, whose phones fetch over HTTP', async () => {
    await deckLive();
    await approved('p1');
    const view = sent.filter((e) => e.message.type === 'view').at(-1)?.message as {
      view: { thumbnailVia?: string };
    };
    expect(view.view.thumbnailVia).toBeUndefined();
  });
  it('sends them from here only to phones on the venue network, on a church server (M2.8)', async () => {
    host.attach({
      send: (to, message) => sent.push({ to, message }),
      drop: () => undefined,
      local: (to) => to === 'lan-1',
    });
    host.setThumbnails({ read: async () => 'aGk=', everyone: false });
    await deckLive();
    await approved('lan-1');
    await approved('relay-1');
    const viewOf = (to: string) =>
      (
        sent.filter((e) => e.to === to && e.message.type === 'view').at(-1)?.message as {
          view: { thumbnailVia?: string };
        }
      ).view;
    expect(viewOf('lan-1').thumbnailVia).toBe('host');
    expect(viewOf('relay-1').thumbnailVia).toBeUndefined();
    await host.message('lan-1', { type: 'thumbnail', name: thumb });
    expect(lastTo('lan-1')).toEqual({ type: 'thumbnail', name: thumb, data: 'aGk=' });
  });
});

describe('phones on the venue network when the relay goes away (native apps M2.8)', () => {
  it('forgets only the phones that came through the relay', async () => {
    await approved('lan-1', 'Ana');
    await approved('relay-1', 'Ben');
    host.forget((connection) => connection !== 'lan-1');
    expect(host.connected.map((c) => c.name)).toEqual(['Ana']);
    expect(host.available).toBe(true);
    const before = sent.length;
    await host.message('lan-1', { type: 'command', id: 'c1', command: { type: 'next' } });
    expect(sent.length).toBeGreaterThan(before);
  });

  it('forgets a request waiting for approval that came through the relay', async () => {
    await host.message('relay-2', {
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      name: 'Cy',
      invite: host.invite(),
    });
    expect(host.pending.map((r) => r.connection)).toEqual(['relay-2']);
    host.forget(() => true);
    expect(host.pending).toEqual([]);
  });
});

describe('the operator devices phones may trust on the venue network (N30)', () => {
  const desk = {
    deviceId: 'd1',
    name: 'Main',
    fingerprint: 'AB:CD',
    addresses: ['10.0.0.2'],
    port: 47311,
  };

  it('gives phones the devices with each view', async () => {
    host.setDevices(() => [desk]);
    await approved('p1');
    expect(lastTo('p1')).toMatchObject({ type: 'view', view: { devices: [desk] } });
  });

  it('gives none unless the desktop says which', async () => {
    await approved('p1');
    const view = lastTo('p1') as { view: { devices?: unknown } };
    expect(view.view).not.toHaveProperty('devices');
  });
});
