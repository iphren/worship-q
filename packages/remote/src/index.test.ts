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

  it('shows the operator each edit, and undoes it', async () => {
    await approved('p1', 'Sam');
    const [song] = await session.store.listSongs(session.workspace.id);
    await host.message('p1', {
      type: 'command',
      id: 'c1',
      command: { type: 'addItem', songId: song!.id },
    });
    expect(lastTo('p1')).toEqual({ type: 'ack', id: 'c1', applied: true });
    expect(host.notices).toEqual([
      expect.objectContaining({ name: 'Sam', change: expect.objectContaining({ kind: 'added' }) }),
    ]);
    expect((await session.viewLive())!.entries).toHaveLength(2);

    expect(await host.undo(host.notices[0]!.id)).toBe(true);
    expect(host.notices).toEqual([]);
    expect((await session.viewLive())!.entries).toHaveLength(1);
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
    host.notify('Streaming laptop', { kind: 'added', item, title: 'Amazing Grace' }, false);
    expect(host.notices[0]).toMatchObject({ name: 'Streaming laptop', undoable: false });
    expect(await host.undo(host.notices[0]!.id)).toBe(false);
    expect((await session.viewLive())!.entries).toHaveLength(2);
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
