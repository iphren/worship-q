/**
 * Two desktops sharing one live state through the real relay (plan M1.9, M2.3, M2.6, M4.4,
 * M4.5, M8.1): the coordinator and follower logic, the relay's routing and the sessions'
 * snapshot handling, with only the sockets and the server's storage faked.
 */
import { DEFAULT_EXPIRY_MS } from '@worship-q/live-state';
import {
  PROTOCOL_VERSION,
  type DesktopToRelay,
  type LiveSnapshot,
  type RelayToDesktop,
  type WorkspaceGrant,
} from '@worship-q/protocol';
import { Relay, type RelayDirectory, type Socket } from '@worship-q/relay';
import { RemoteHost } from '@worship-q/remote';
import { Session } from '@worship-q/session';
import { migrate, Store, SyncStore } from '@worship-q/store';
import { openNodeDriver } from '@worship-q/store/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveLink, type LiveBackupApi } from './liveLink';

const SUNDAY = '2026-10-11';

function clock(start = `${SUNDAY}T09:00:00.000Z`) {
  let now = Date.parse(start);
  return {
    now: () => new Date(now).toISOString(),
    date: () => new Date(now),
    ms: () => now,
    advance: (ms: number) => (now += ms),
  };
}
type Clock = ReturnType<typeof clock>;

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 25));
};

/** A church instance that knows three desktops and nothing else. */
function directory(): RelayDirectory & { tokens: Map<string, { id: string; name: string }> } {
  const tokens = new Map<string, { id: string; name: string }>();
  return {
    tokens,
    authenticate: (token) => {
      const device = tokens.get(token);
      return device ? { ...device, workspaceId: 'ws' } : null;
    },
    getWorkspace: (id) => (id === 'ws' ? { id } : null),
    isActiveDevice: () => true,
    authenticateOutputLink: () => null,
    isActiveOutputLink: () => true,
    outputLook: () => null,
  };
}

function backupStore(): LiveBackupApi & { stored: LiveSnapshot | null; grants: WorkspaceGrant[] } {
  const store = {
    stored: null as LiveSnapshot | null,
    grants: [] as WorkspaceGrant[],
    put: async (snapshot: LiveSnapshot, grants: WorkspaceGrant[]) => {
      store.stored = snapshot;
      store.grants = grants;
    },
    get: async () => ({ snapshot: store.stored, grants: store.grants }),
  };
  return store;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function desktop(
  name: string,
  time: Clock,
  relay: Relay,
  dir: ReturnType<typeof directory>,
  backup: LiveBackupApi | null,
  options: { role?: 'operator' | 'viewer'; driver?: ReturnType<typeof openNodeDriver> } = {},
) {
  const driver = options.driver ?? openNodeDriver();
  await migrate(driver);
  let counter = 0;
  const store = new Store(driver, { now: time.now, newId: () => `${name}-${++counter}` });
  const { session } = await Session.open(store, { now: time.date }, 'UTC', { role: options.role });
  const deviceId = `device-${name}`;
  const token = `token-${name}`;
  dir.tokens.set(token, { id: deviceId, name });
  const host = new RemoteHost(
    session,
    () => 'North Branch',
    time.ms,
    () => deviceId,
  );
  let registered = false;

  let handlers: ReturnType<Relay['desktop']> | null = null;
  const socket: Socket = {
    send: (data) => {
      const message = JSON.parse(data) as RelayToDesktop;
      // The desktop sees relay messages a moment later, as over a network.
      setTimeout(() => {
        if (message.type === 'message') void host.message(message.from, message.data);
        else if (message.type === 'left') host.left(message.from);
        else link.receive(message);
      }, 1);
    },
    close: () => undefined,
  };
  const link = new LiveLink({
    session,
    host,
    deviceId: () => deviceId,
    deviceName: () => name,
    capabilities: () => ({
      roles: ['coordinator'],
      appVersion: 'test',
      fonts: true,
      screens: true,
      media: true,
      transparency: true,
    }),
    send: (message: DesktopToRelay) => handlers?.message(JSON.stringify(message)),
    backup,
    grantsRegistered: {
      get: async () => registered,
      set: async () => void (registered = true),
    },
    newId: () => `${name}-cmd-${++counter}`,
    now: time.ms,
  });
  host.attach({
    send: (to, data) => handlers?.message(JSON.stringify({ type: 'send', to, data })),
    drop: (to) => handlers?.message(JSON.stringify({ type: 'drop', to })),
  });
  const connect = () => {
    handlers = relay.desktop(socket);
    link.connected('relay');
    handlers.message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token,
        role: options.role,
        capabilities: {
          roles: ['coordinator'],
          appVersion: 'test',
          fonts: true,
          screens: true,
          media: true,
          transparency: true,
        },
      } satisfies DesktopToRelay),
    );
  };
  const disconnect = () => {
    handlers?.close();
    handlers = null;
    link.disconnected();
  };
  connect();
  cleanups.push(() => {
    link.stop();
    host.dispose();
    driver.close();
  });
  return { session, host, link, store, driver, connect, disconnect, deviceId, token };
}

async function venue(options: { backup?: boolean } = {}) {
  const time = clock();
  const dir = directory();
  const relay = new Relay(dir, time.ms);
  const backup = options.backup === false ? null : backupStore();
  const a = await desktop('Projector', time, relay, dir, backup);
  const song = await a.session.createSong({ title: 'Amazing Grace', lyrics: 'one\ntwo\n\nthree' });
  await a.session.addSong(SUNDAY, song.id);
  const b = await desktop('Streaming', time, relay, dir, backup);
  // Content synchronization is not part of this: the follower is given the same song as the
  // instance would send it.
  const { revision, updatedAt } = song;
  const fields: Record<string, unknown> = { ...song };
  delete fields.workspaceId;
  delete fields.id;
  delete fields.revision;
  delete fields.updatedAt;
  await b.session.applyRemote(() =>
    new SyncStore(b.store).applyRemote(b.session.workspace.id, [
      { kind: 'song', id: song.id, key: song.id, revision, updatedAt, data: fields },
    ]),
  );
  await settle();
  return { time, dir, relay, backup, a, b, song };
}

const slide = (session: Session) => session.live?.presented?.pieceId ?? null;

describe('two desktops, one live state (M1.9, M1.10)', () => {
  it('makes the first desktop coordinator and the second a follower showing the same slide', async () => {
    const { a, b } = await venue();
    expect(a.link.status.role).toBe('coordinator');
    expect(b.link.status).toMatchObject({ role: 'follower', coordinatorName: 'Projector' });
    expect(b.session.following).toBe(true);

    await a.session.next();
    await settle();
    expect(slide(b.session)).toBe(slide(a.session));
    expect(slide(b.session)).not.toBeNull();
    expect(b.session.snapshot?.items[0]?.title).toBe('Amazing Grace');

    // A command from the follower lands on the coordinator and comes back to both.
    await b.session.next();
    await settle();
    expect(a.session.live?.presented?.index).toBe(1);
    expect(slide(b.session)).toBe(slide(a.session));
  });

  it('keeps a follower’s command across a dropped connection and applies it once', async () => {
    const { a, b } = await venue();
    b.disconnect();
    await b.session.next();
    await b.session.next();
    await settle();
    expect(a.session.live?.presented).toBeNull();
    b.connect();
    await settle();
    expect(a.session.live?.presented?.index).toBe(1);
    expect(slide(b.session)).toBe(slide(a.session));
    // Nothing is pending once answered.
    expect(b.link.snapshot?.revision).toBeGreaterThan(0);
  });

  it('shows the follower a presented song it does not have, from the snapshot', async () => {
    const { a, b } = await venue();
    const only = await a.session.createSong({ title: 'Only on A', lyrics: 'alpha\nbeta' });
    await a.session.addSong(SUNDAY, only.id);
    const view = (await a.session.viewLive())!;
    await a.session.play(view.entries[1]!.item.id, view.entries[1]!.pieces[0]!.id);
    await settle();
    const frame = await b.session.frame(() => '');
    expect(frame.song?.pieces[0]?.lines).toEqual(['alpha', 'beta']);
    expect((await b.session.viewLive())!.entries.map((e) => e.song.title)).toEqual([
      'Amazing Grace',
      'Only on A',
    ]);
  });
});

describe('operators together (M2)', () => {
  it('hands over with Use this computer without changing any screen (M2.3)', async () => {
    const { a, b } = await venue();
    await a.session.next();
    await settle();
    const before = slide(a.session);
    const revision = b.link.snapshot!.revision;
    b.link.claim();
    await settle();
    expect(b.link.status.role).toBe('coordinator');
    expect(a.link.status).toMatchObject({
      role: 'follower',
      demoted: true,
      coordinatorName: 'Streaming',
    });
    expect(slide(a.session)).toBe(before);
    expect(slide(b.session)).toBe(before);
    expect(b.link.snapshot!.revision).toBeGreaterThan(revision);
    // Commands now go the other way.
    await a.session.next();
    await settle();
    expect(b.session.live?.presented?.index).toBe(1);
    expect(slide(a.session)).toBe(slide(b.session));
  });

  it('a follower’s Go live changes the live run sheet everywhere; its edits elsewhere stay local (M2.1, M2.2)', async () => {
    const { a, b } = await venue();
    await b.session.goLive('2026-10-18');
    await settle();
    expect(a.session.liveDate).toBe('2026-10-18');
    expect(b.session.liveDate).toBe('2026-10-18');
    const extra = await b.session.createSong({ title: 'Prepared', lyrics: 'x' });
    await b.session.editRunSheet('2026-10-25');
    await b.session.addSong('2026-10-25', extra.id);
    await settle();
    expect((await a.session.viewDate('2026-10-25')).entries).toEqual([]);
    expect(a.session.liveDate).toBe('2026-10-18');
  });

  it('shows other operators a live run-sheet edit, with Undo only on the coordinator (D24)', async () => {
    const { a, b, song } = await venue();
    await b.session.addSong(SUNDAY, song.id);
    await settle();
    expect((await a.session.viewLive())!.entries).toHaveLength(2);
    expect(a.host.notices).toEqual([
      expect.objectContaining({ name: 'Streaming', undoable: true }),
    ]);
    expect(b.host.notices).toEqual([
      expect.objectContaining({ name: 'Streaming', undoable: false }),
    ]);
    expect(b.session.snapshot?.items).toHaveLength(2);
  });

  it('a grant approved on the follower is accepted by the coordinator, and lives on without the follower (M2.6)', async () => {
    const { a, b, relay } = await venue();
    const phone = {
      received: [] as unknown[],
      send(d: string) {
        this.received.push(JSON.parse(d));
      },
      close() {},
    };
    const handlers = relay.remote(phone);
    handlers.message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        workspace: 'ws',
        name: 'Sam',
        invite: b.host.invite(),
      }),
    );
    await settle();
    expect(b.host.pending).toHaveLength(1);
    await b.host.approve(b.host.pending[0]!.connection);
    await settle();
    const approved = phone.received.find((m) => (m as { type: string }).type === 'approved') as {
      grant: string;
    };
    expect(approved).toBeDefined();
    expect((await a.host.localGrants()).map((g) => g.name)).toEqual(['Sam']);
    // The phone's command travels through the follower to the coordinator, in the phone's name.
    handlers.message(JSON.stringify({ type: 'command', id: 'p1', command: { type: 'next' } }));
    await settle();
    expect(a.session.live?.presented?.index).toBe(0);
    expect(phone.received).toContainEqual({ type: 'ack', id: 'p1', applied: true });
    expect(a.link.status.devices.map((d) => [d.name, d.role])).toContainEqual(['Sam', 'phone']);

    // The follower closes: the phone comes back with its grant to the coordinator.
    b.disconnect();
    await settle();
    expect(phone.received.at(-1)).toEqual({ type: 'unavailable', reason: 'reconnect' });
    const again = {
      received: [] as unknown[],
      send(d: string) {
        this.received.push(JSON.parse(d));
      },
      close() {},
    };
    relay.remote(again).message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        workspace: 'ws',
        name: 'Sam',
        grant: approved.grant,
      }),
    );
    await settle();
    expect(again.received[0]).toEqual({ type: 'approved', grant: approved.grant });
  });

  it('Disconnect all on one computer drops phones approved on another (M8.3)', async () => {
    const { a, b, relay } = await venue();
    const phone = {
      received: [] as unknown[],
      send(d: string) {
        this.received.push(JSON.parse(d));
      },
      close() {},
    };
    const handlers = relay.remote(phone);
    handlers.message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        workspace: 'ws',
        name: 'Kim',
        invite: b.host.invite(),
      }),
    );
    await settle();
    await b.host.approve(b.host.pending[0]!.connection);
    await settle();
    expect(b.host.connected).toHaveLength(1);
    expect((await a.host.localGrants()).map((g) => g.name)).toEqual(['Kim']);
    await a.host.disconnectAll();
    await settle();
    expect(await b.host.localGrants()).toEqual([]);
    expect(b.host.connected).toEqual([]);
    expect(phone.received.at(-1)).toEqual({ type: 'denied', reason: 'revoked' });
  });
});

describe('recovery (M4)', () => {
  it('mirrors the coordinator’s snapshot to the server (M4.2)', async () => {
    const { a, backup } = await venue();
    await a.session.next();
    await new Promise((done) => setTimeout(done, 1200));
    expect(backup!.stored?.state.presented?.pieceId).toBe(slide(a.session));
    expect(backup!.stored?.coordinatorId).toBe(a.deviceId);
  });

  it('lets a follower carry on from the same slide when the coordinator is lost, and makes the returning one follow (M4.4, M4.5)', async () => {
    const { a, b } = await venue();
    await a.session.next();
    await a.session.next();
    await settle();
    const before = slide(b.session);
    a.disconnect();
    await settle();
    expect(b.link.status).toMatchObject({
      role: 'follower',
      coordinatorLost: true,
      coordinatorId: null,
    });
    expect(slide(b.session)).toBe(before);

    b.link.claim();
    await settle();
    expect(b.link.status).toMatchObject({ role: 'coordinator', coordinatorLost: false });
    expect(slide(b.session)).toBe(before);
    expect(b.session.following).toBe(false);
    // The carried-on live state can be moved on from where it was.
    await b.session.previous();
    expect(b.session.live?.presented?.index).toBe(0);

    a.connect();
    await settle();
    expect(a.link.status).toMatchObject({
      role: 'follower',
      demoted: true,
      coordinatorName: 'Streaming',
    });
    expect(slide(a.session)).toBe(slide(b.session));
    expect(a.session.live?.presented?.index).toBe(0);
  });

  it('the first operator device after a restart takes the server’s unexpired live state (M4.6)', async () => {
    const time = clock();
    const dir = directory();
    const relay = new Relay(dir, time.ms);
    const backup = backupStore();
    const a = await desktop('Projector', time, relay, dir, backup);
    const song = await a.session.createSong({ title: 'A', lyrics: 'one\ntwo' });
    await a.session.addSong(SUNDAY, song.id);
    await a.session.next();
    await new Promise((done) => setTimeout(done, 1200));
    expect(backup.stored).not.toBeNull();
    a.disconnect();

    // Another computer opens later, with its own fresh start.
    time.advance(60 * 60 * 1000);
    const c = await desktop('Office', time, relay, dir, backup);
    await settle();
    expect(c.link.status.role).toBe('coordinator');
    expect(c.session.live?.presented?.songId).toBe(song.id);
    expect(c.session.live?.startedAt).toBe(backup.stored!.state.startedAt);

    // Once expired, the server's copy is ignored.
    c.disconnect();
    time.advance(DEFAULT_EXPIRY_MS + 1000);
    const d = await desktop('Late', time, relay, dir, backup);
    await settle();
    expect(d.session.live?.presented).toBeNull();
  });
});

describe('viewer mode (M3)', () => {
  it('a viewer follows, never coordinates, and keeps the last slide when the coordinator leaves', async () => {
    const time = clock();
    const dir = directory();
    const relay = new Relay(dir, time.ms);
    const viewer = await desktop('Projector PC', time, relay, dir, null, { role: 'viewer' });
    await settle();
    expect(viewer.link.status).toMatchObject({ role: 'viewer', coordinatorId: null });
    expect(viewer.session.isLive).toBe(false);

    const a = await desktop('Laptop', time, relay, dir, null);
    const song = await a.session.createSong({ title: 'A', lyrics: 'one\ntwo' });
    await a.session.addSong(SUNDAY, song.id);
    await a.session.next();
    await settle();
    expect(viewer.session.isLive).toBe(true);
    expect(viewer.session.live?.presented?.songId).toBe(song.id);
    expect(a.link.status.devices.map((d) => [d.name, d.role])).toContainEqual([
      'Projector PC',
      'viewer',
    ]);

    a.disconnect();
    await settle();
    expect(viewer.link.status).toMatchObject({ role: 'viewer', coordinatorLost: true });
    expect(viewer.session.live?.presented?.songId).toBe(song.id);
    viewer.link.claim();
    await settle();
    expect(viewer.link.status.role).toBe('viewer');
  });
});
