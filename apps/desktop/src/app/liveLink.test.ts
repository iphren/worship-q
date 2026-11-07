/**
 * Two desktops sharing one live state through the real relay (plan M1.9, M2.3, M2.6, M4.4,
 * M4.5, M8.1): the coordinator and follower logic, the relay's routing and the sessions'
 * snapshot handling, with only the sockets and the server's storage faked.
 */
import { DEFAULT_EXPIRY_MS } from '@worship-q/live-state';
import {
  PROTOCOL_VERSION,
  type DesktopToRelay,
  type HostToRemote,
  type LiveSnapshot,
  type RelayToDesktop,
  type WorkspaceGrant,
} from '@worship-q/protocol';
import { Relay, type RelayDirectory, type Socket } from '@worship-q/relay';
import { RemoteHost } from '@worship-q/remote';
import { Session } from '@worship-q/session';
import { migrate, Store, SyncStore } from '@worship-q/store';
import { openNodeDriver } from '@worship-q/store/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveLink, type LiveBackupApi } from './liveLink';
import { ObsLink, obsSettingsStore } from './obs';
import { answerEverything, FakeNative, memoryStorage } from './obs.testing';
import { ObsShare, shareObsWithPhones } from './obsShare';

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
  options: {
    role?: 'operator' | 'viewer';
    driver?: ReturnType<typeof openNodeDriver>;
    /** The driver belongs to an earlier desktop, which closes it. */
    reuse?: boolean;
    /** A version 4 desktop that takes OBS messages, with a fake OBS on its computer. */
    obs?: boolean;
    /** Whether the church server relays OBS messages (protocol 4). */
    obsSupported?: () => boolean;
    /** Taking the coordinator role waits this long, as on a server far away. */
    slowStart?: number;
  } = {},
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
  const sync = new SyncStore(store);
  /** Everything the desktop sent to the relay, and received from it. */
  const sent: DesktopToRelay[] = [];
  const received: RelayToDesktop[] = [];

  // OBS on this computer, as the app sets it up (cloud.ts), with the native core faked.
  const obsNative = new FakeNative();
  answerEverything(obsNative);
  obsNative.answers.set('SetCurrentProgramScene', () => null);
  obsNative.answers.set('GetSourceScreenshot', () => ({
    imageData: 'data:image/webp;base64,UklGRoY=',
  }));
  const obsLink = new ObsLink({
    native: obsNative,
    settings: obsSettingsStore(() => memoryStorage(), deviceId),
    secrets: { get: async () => null, set: async () => undefined, delete: async () => undefined },
    now: time.ms,
    delay: (ms) => new Promise((done) => setTimeout(done, ms / 100)),
  });
  const obs = options.obs
    ? new ObsShare({ deviceId: () => deviceId, deviceName: () => name, now: time.ms })
    : null;
  if (obs) {
    obs.setLink(obsLink);
    await obsLink.start();
    shareObsWithPhones(obs, host);
  }
  const capabilities = () => ({
    roles: ['coordinator' as const],
    appVersion: 'test',
    fonts: true,
    screens: true,
    media: true,
    transparency: true,
    ...(options.obs ? { obs: options.obsSupported?.() ?? true } : {}),
  });

  let handlers: ReturnType<Relay['desktop']> | null = null;
  const socket: Socket = {
    send: (data) => {
      const message = JSON.parse(data) as RelayToDesktop;
      received.push(message);
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
    capabilities,
    obs,
    obsSupported: options.obsSupported,
    send: (message: DesktopToRelay) => {
      sent.push(message);
      handlers?.message(JSON.stringify(message));
    },
    backup,
    grantsRegistered: {
      get: async () => registered,
      set: async () => {
        if (options.slowStart) await new Promise((done) => setTimeout(done, options.slowStart));
        registered = true;
      },
    },
    // Kept in the desktop's own database, so it lasts across a restart on the same one.
    revisions: {
      get: async () => (await sync.getState()).revisionCeiling ?? 0,
      reserve: async (ceiling) => void (await sync.setState({ revisionCeiling: ceiling })),
    },
    newId: () => `${name}-cmd-${++counter}`,
    now: time.ms,
  });
  host.attach({
    send: (to, data) => handlers?.message(JSON.stringify({ type: 'send', to, data })),
    drop: (to) => handlers?.message(JSON.stringify({ type: 'drop', to })),
  });
  /** As the app does, over the relay; or as over the LAN, with the relay standing in for the room. */
  const connect = (transport: 'relay' | 'lan' = 'relay') => {
    handlers = relay.desktop(socket);
    link.connected(transport);
    handlers.message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token,
        role: options.role,
        capabilities: capabilities(),
        live: link.presence(),
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
    obs?.stop();
    obsLink.stop();
    host.dispose();
    if (!options.reuse) driver.close();
  });
  /** Turns the OBS link on and has OBS answer, as when OBS is running on this computer. */
  const obsOn = async () => {
    await obsLink.activate();
    obsNative.status({ state: 'connected', obsVersion: '33.0.1' });
    await settle();
  };
  return {
    session,
    host,
    link,
    store,
    driver,
    connect,
    disconnect,
    deviceId,
    token,
    sent,
    received,
    obs: obs!,
    obsLink,
    obsNative,
    obsOn,
  };
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

describe('the connected-devices list (M8)', () => {
  it('leaves a malformed device out, so followers still see the presentation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { a, b } = await venue();
      const connectedAt = new Date().toISOString();
      a.link.setLanPeers([
        // No id, as LAN connections arrived before the fix to the native event.
        { deviceId: undefined as unknown as string, name: 'Ghost', role: 'operator', connectedAt },
        // A hello from another version of the app, passed on unchecked.
        {
          deviceId: 'other-version',
          name: 'Newer',
          role: 'operator',
          connectedAt,
          capabilities: { missingFonts: [{ family: 'Inter' }, 'Arial'] } as never,
        },
      ]);
      await a.session.next();
      await settle();
      expect(slide(b.session)).toBe(slide(a.session));
      expect(slide(b.session)).not.toBeNull();
      const names = b.link.status.devices.map((d) => d.name);
      expect(names).not.toContain('Ghost');
      expect(b.link.status.devices.find((d) => d.name === 'Newer')).toMatchObject({
        connection: 'lan',
        missingFonts: ['Arial'],
      });
      expect(warn).toHaveBeenCalledWith(
        'Left a malformed device out of the list',
        expect.objectContaining({ name: 'Ghost' }),
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
    }
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

  it('tells the relay what it follows on the LAN, so the role is kept for a coordinator the server loses (D14)', async () => {
    const { a, b } = await venue();
    const presences = () => b.sent.filter((m) => m.type === 'presence').map((m) => m.live);
    // Following over the relay is not worth telling: the server sees the coordinator itself.
    expect(presences()).toEqual([]);

    // The streaming computer finds the projector on the venue network and switches to it.
    b.disconnect();
    b.connect('lan');
    await settle();
    expect(b.link.status).toMatchObject({ role: 'follower', transport: 'lan' });
    expect(presences().at(-1)).toMatchObject({ kind: 'following', deviceId: a.deviceId });
    const said = presences().length;
    await a.session.next();
    await settle();
    // Not said again for every snapshot.
    expect(presences().length).toBe(said);

    // The projector's internet drops. The server names it still: Streaming reaches it.
    a.disconnect();
    await settle();
    expect(b.link.status).toMatchObject({
      role: 'follower',
      coordinatorId: a.deviceId,
      coordinatorName: 'Projector',
      coordinatorLost: false,
    });
    // It comes back and carries on, nobody having taken over.
    a.connect();
    await settle();
    expect(a.link.status).toMatchObject({ role: 'coordinator', demoted: false });
    expect(b.link.status).toMatchObject({ role: 'follower', coordinatorId: a.deviceId });
    await a.session.next();
    await settle();
    expect(slide(b.session)).toBe(slide(a.session));
    expect(a.session.live?.presented?.index).toBe(1);
  });

  it('keeps saying the coordinator is lost while the relay names nobody, even as its snapshots still arrive (D14)', async () => {
    const { a, b } = await venue();
    // The server lost the projector's connection; this computer still has it over the LAN.
    b.link.receive({
      type: 'ready',
      workspaceId: 'ws',
      deviceId: b.deviceId,
      coordinator: false,
      coordinatorName: null,
      coordinatorId: null,
      peers: [],
    });
    await settle();
    expect(b.link.status).toMatchObject({ coordinatorLost: true, coordinatorId: null });
    await a.session.next();
    await settle();
    // The snapshot is shown, but the server's word stands, without flickering every second.
    expect(slide(b.session)).toBe(slide(a.session));
    expect(slide(b.session)).not.toBeNull();
    expect(b.link.status.coordinatorLost).toBe(true);
  });

  it('follows the relay’s latest word when the role moves on while taking over', async () => {
    const { time, dir, relay, backup, a, b } = await venue();
    const c = await desktop('Vestry', time, relay, dir, backup);
    await a.session.next();
    await settle();
    a.disconnect();
    await settle();

    // Streaming sorts before Vestry, so a tie between the two copies would keep B (D14).
    // The server is slow to answer, so B is still taking over when C claims the role.
    let release = () => {};
    const gate = new Promise<void>((done) => (release = done));
    const get = backup!.get;
    backup!.get = async () => {
      await gate;
      return get();
    };
    b.link.claim();
    await settle(2);
    c.link.claim();
    await settle(2);
    release();
    await settle();

    expect(c.link.status.role).toBe('coordinator');
    expect(b.link.status).toMatchObject({
      role: 'follower',
      coordinatorId: c.deviceId,
      coordinatorName: 'Vestry',
    });
    expect(b.session.following).toBe(true);
    // B's commands go to C.
    const revision = c.link.snapshot!.revision;
    await b.session.next();
    await settle();
    expect(c.link.snapshot!.revision).toBeGreaterThan(revision);
    expect(b.link.snapshot!.revision).toBe(c.link.snapshot!.revision);
  });

  it('after presenting apart offline, keeps the more recent copy and drops the other (D14)', async () => {
    const { time, a, b } = await venue();
    await a.session.next();
    await settle();
    a.disconnect();
    await settle();
    b.disconnect();
    // The venue loses the internet; B presents on its own, as it does with nobody to follow.
    b.link.connected('lan');
    b.link.receive({
      type: 'ready',
      workspaceId: 'ws',
      deviceId: b.deviceId,
      coordinator: true,
      coordinatorName: 'Streaming',
      coordinatorId: b.deviceId,
      peers: [],
    });
    await settle();
    expect(b.link.status.role).toBe('coordinator');
    time.advance(1000);
    await a.session.next();
    time.advance(1000);
    await b.session.setBlank(true);
    await settle();
    expect(a.session.live).toMatchObject({ blank: false, presented: { index: 1 } });
    expect(b.session.live).toMatchObject({ blank: true, presented: { index: 0 } });

    // The internet is back. A reconnects first, but B changed more recently.
    a.connect();
    await settle();
    b.link.disconnected();
    b.connect();
    await settle();
    expect(b.link.status.role).toBe('coordinator');
    expect(a.link.status).toMatchObject({ role: 'follower', coordinatorName: 'Streaming' });
    // A's copy was dropped, not merged in: both show B's.
    expect(b.session.live).toMatchObject({ blank: true, presented: { index: 0 } });
    expect(a.session.live).toMatchObject({ blank: true, presented: { index: 0 } });
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

describe('a coordinator restarting (M4.6)', () => {
  /** Closes the app on `who` and opens it again on the same database, as switching viewer mode does. */
  async function restart(
    who: Awaited<ReturnType<typeof desktop>>,
    name: string,
    venueParts: Awaited<ReturnType<typeof venue>>,
    role?: 'operator' | 'viewer',
  ) {
    who.disconnect();
    who.link.stop();
    who.host.dispose();
    await settle();
    const { time, relay, dir, backup } = venueParts;
    return desktop(name, time, relay, dir, backup, { driver: who.driver, role, reuse: true });
  }

  it('numbers past what it sent before, so a follower takes what it sends next', async () => {
    const parts = await venue({ backup: false });
    const { a, b } = parts;
    for (let i = 0; i < 3; i++) await a.session.next();
    await settle();
    const before = b.link.snapshot!.revision;
    expect(before).toBeGreaterThan(1);

    const again = await restart(a, 'Projector', parts);
    await settle();
    expect(again.link.status.role).toBe('coordinator');
    expect(again.link.snapshot!.revision).toBeGreaterThan(before);
    expect(b.link.status).toMatchObject({ role: 'follower', coordinatorId: again.deviceId });

    // The follower moves the slide and sees it move, as does the coordinator.
    await b.session.next();
    await settle();
    expect(again.session.live?.presented?.index).toBe(1);
    expect(slide(b.session)).toBe(slide(again.session));
  });

  it('keeps numbering up after going viewer and back', async () => {
    const parts = await venue({ backup: false });
    const { a, b } = parts;
    for (let i = 0; i < 3; i++) await a.session.next();
    await settle();
    const before = b.link.snapshot!.revision;

    const viewer = await restart(a, 'Projector', parts, 'viewer');
    await settle();
    expect(viewer.link.status.role).toBe('viewer');
    expect(b.link.status).toMatchObject({ role: 'follower', coordinatorLost: true });
    const operator = await restart(viewer, 'Projector', parts);
    await settle();
    expect(operator.link.status.role).toBe('coordinator');
    expect(operator.link.snapshot!.revision).toBeGreaterThan(before);

    await b.session.next();
    await settle();
    expect(slide(b.session)).toBe(slide(operator.session));
  });

  it('saves its reservation once a block, not for every snapshot', async () => {
    const { a } = await venue({ backup: false });
    const ceiling = async () => (await new SyncStore(a.store).getState()).revisionCeiling;
    const first = await ceiling();
    expect(first).toBeGreaterThan(a.link.snapshot!.revision);
    for (let i = 0; i < 5; i++) {
      await a.session.next();
      await settle(2);
    }
    expect(a.link.snapshot!.revision).toBeLessThan(first!);
    expect(await ceiling()).toBe(first);
  });

  it('continues the numbering of a live state it takes over, so a handover still counts (M2.3)', async () => {
    const parts = await venue({ backup: false });
    const { a, b } = parts;
    // B presented once, so it holds a reservation well above A's numbering.
    b.link.claim();
    await settle();
    expect(b.link.status.role).toBe('coordinator');
    const reservedByB = (await new SyncStore(b.store).getState()).revisionCeiling!;
    a.link.claim();
    await settle();
    expect(a.link.status.role).toBe('coordinator');
    await a.session.next();
    await settle();
    const fromA = b.link.snapshot!.revision;
    expect(fromA).toBeLessThan(reservedByB);

    // Taking it back continues from A's copy, below B's own reservation.
    b.link.claim();
    await settle();
    expect(b.link.status.role).toBe('coordinator');
    expect(b.link.snapshot!.revision).toBeLessThan(reservedByB);
    expect(slide(b.session)).toBe(slide(a.session));
  });

  it('numbers past its last copy on the server when it comes back alone', async () => {
    const parts = await venue();
    const { a, b, backup } = parts;
    for (let i = 0; i < 3; i++) await a.session.next();
    await new Promise((done) => setTimeout(done, 1200));
    const backedUp = backup!.stored!.revision;
    b.disconnect();
    const again = await restart(a, 'Projector', parts);
    await settle();
    expect(again.link.status.role).toBe('coordinator');
    await again.session.next();
    await new Promise((done) => setTimeout(done, 1200));
    // The server keeps the newer copy only when its number is higher.
    expect(backup!.stored!.revision).toBeGreaterThan(backedUp);
    expect(backup!.stored!.state.presented?.index).toBe(again.session.live?.presented?.index);
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

describe('OBS control across the workspace (OBS plan M2)', () => {
  /** A coordinator, a follower, and the streaming laptop as a viewer running OBS. */
  async function church(
    options: { obsSupported?: () => boolean; oldDesktop?: boolean; slowLaptop?: boolean } = {},
  ) {
    const time = clock();
    const dir = directory();
    const relay = new Relay(dir, time.ms);
    const opts = { obs: true, obsSupported: options.obsSupported };
    const a = await desktop('Projector', time, relay, dir, null, opts);
    const b = await desktop('Laptop', time, relay, dir, null, {
      ...opts,
      slowStart: options.slowLaptop ? 300 : undefined,
    });
    const s = await desktop('Streaming', time, relay, dir, null, { ...opts, role: 'viewer' });
    const old = options.oldDesktop ? await desktop('Old', time, relay, dir, null) : null;
    await settle();
    return { time, relay, a, b, s, old };
  }

  const obsTo = (d: { received: RelayToDesktop[] }) =>
    d.received.filter(
      (m) => m.type === 'peer' && String((m.data as { type?: string })?.type).startsWith('obs'),
    );

  it('shows every desktop the OBS state of a viewer that runs OBS, and nothing before', async () => {
    const { a, b, s } = await church();
    expect(a.link.status.role).toBe('coordinator');
    expect(s.link.status.role).toBe('viewer');
    expect(a.obs.view.state).toBeNull();
    expect(b.obs.view.state).toBeNull();
    await s.obsOn();
    for (const d of [a, b]) {
      expect(d.obs.view).toMatchObject({
        local: false,
        reachable: true,
        state: { ownerName: 'Streaming', status: 'connected', currentScene: 'Lyrics' },
      });
    }
    expect(s.obs.view).toMatchObject({ local: true, state: { currentScene: 'Lyrics' } });
    // A change made in OBS itself reaches everyone.
    s.obsNative.event('CurrentProgramSceneChanged', { sceneName: 'Camera' });
    await settle();
    expect(b.obs.view.state?.currentScene).toBe('Camera');
  });

  it('carries a command from any desktop to OBS and answers the one that asked', async () => {
    const { a, b, s } = await church();
    await s.obsOn();
    // From a follower, through the coordinator.
    expect(await b.obs.command({ type: 'setScene', scene: 'Camera' })).toEqual({ ok: true });
    // From the coordinator itself.
    s.obsNative.answers.set('StartStream', () => {
      throw { code: 500, comment: 'running' };
    });
    expect(await a.obs.command({ type: 'startStream' })).toEqual({ ok: true });
    s.obsNative.answers.set('StopRecord', () => {
      throw { code: 702, comment: 'Recording is busy' };
    });
    expect(await b.obs.command({ type: 'stopRecord' })).toEqual({
      ok: false,
      code: 702,
      error: 'Recording is busy',
    });
    expect(s.obsNative.asked.map((r) => r.type)).toEqual(
      expect.arrayContaining(['SetCurrentProgramScene', 'StartStream', 'StopRecord']),
    );
  });

  it('works when the coordinator itself runs OBS', async () => {
    const { a, b, s } = await church();
    await a.obsOn();
    expect(b.obs.view.state?.ownerName).toBe('Projector');
    expect(s.obs.view.state?.ownerName).toBe('Projector');
    expect(await s.obs.command({ type: 'setScene', scene: 'Blank' })).toEqual({ ok: true });
    expect(a.obsNative.asked.at(-1)).toMatchObject({
      type: 'SetCurrentProgramScene',
      data: { sceneName: 'Blank' },
    });
  });

  it('sends an older desktop no OBS message at all', async () => {
    const { s, old } = await church({ oldDesktop: true });
    await s.obsOn();
    s.obsNative.event('CurrentProgramSceneChanged', { sceneName: 'Camera' });
    await settle();
    expect(obsTo(old!)).toEqual([]);
  });

  it('hands OBS to a later activation and turns the earlier link off silently (O9)', async () => {
    const { time, a, b, s } = await church();
    await s.obsOn();
    time.advance(60_000);
    await b.obsOn();
    expect(s.obsLink.view.settings.active).toBe(false);
    expect(s.obs.view).toMatchObject({ local: false, takenOverBy: 'Laptop' });
    expect(a.obs.view.state?.ownerName).toBe('Laptop');
    expect(s.obs.view.state?.ownerName).toBe('Laptop');
    expect(s.obsNative.disconnects).toBe(1);
    // Taking it back is one switch, and the other turns off in turn.
    time.advance(60_000);
    await s.obsOn();
    expect(b.obsLink.view.settings.active).toBe(false);
    expect(a.obs.view.state?.ownerName).toBe('Streaming');
    expect(s.obs.view.takenOverBy).toBeNull();
  });

  it('removes the controls everywhere when the OBS computer turns its link off or leaves', async () => {
    const { a, b, s } = await church();
    await s.obsOn();
    await s.obsLink.deactivate();
    await settle();
    expect(a.obs.view.state).toBeNull();
    expect(b.obs.view.state).toBeNull();
    await s.obsOn();
    expect(b.obs.view.state).not.toBeNull();
    s.disconnect();
    await settle();
    expect(a.obs.view.state).toBeNull();
    expect(b.obs.view.state).toBeNull();
    // Back: shared again without anyone touching anything.
    s.connect();
    await settle();
    expect(b.obs.view.state?.ownerName).toBe('Streaming');
  });

  it('fails a command whose OBS computer left before answering', async () => {
    const { a, b, s } = await church();
    await s.obsOn();
    // OBS has not answered StartRecord yet when its computer leaves.
    const asked = b.obs.command({ type: 'startRecord' });
    await settle();
    s.disconnect();
    expect(await asked).toEqual({ ok: false, error: 'owner-left' });
    expect(a.obs.view.state).toBeNull();
  });

  it('keeps the OBS computer’s own controls, and says why nothing is shared, against an older server (M2.9)', async () => {
    const { a, s } = await church({ obsSupported: () => false });
    await s.obsOn();
    expect(s.obs.view).toMatchObject({ local: true, sharingBlocked: true });
    expect(await s.obs.command({ type: 'setScene', scene: 'Camera' })).toEqual({ ok: true });
    expect(a.obs.view.state).toBeNull();
    expect(s.sent.some((m) => m.type === 'toCoordinator' && m.data.type.startsWith('obs'))).toBe(
      false,
    );
  });

  it('keeps OBS shared through a coordinator handover', async () => {
    const { a, b, s } = await church();
    await s.obsOn();
    b.link.claim();
    await settle();
    expect(b.link.status.role).toBe('coordinator');
    expect(a.obs.view.state?.ownerName).toBe('Streaming');
    expect(b.obs.view.state?.ownerName).toBe('Streaming');
    expect(await a.obs.command({ type: 'setScene', scene: 'Camera' })).toEqual({ ok: true });
  });

  it('shows OBS on a coordinator that took a while to take the role', async () => {
    const { a, b, s } = await church({ slowLaptop: true });
    await s.obsOn();
    // The OBS computer's state reaches the laptop while it is still taking the role.
    b.link.claim();
    await settle();
    await settle();
    expect(b.link.status.role).toBe('coordinator');
    expect(b.obs.view.state?.ownerName).toBe('Streaming');
    expect(a.obs.view.state?.ownerName).toBe('Streaming');
    expect(await a.obs.command({ type: 'setScene', scene: 'Camera' })).toEqual({ ok: true });
  });

  it('takes monitor images only while some desktop watches, and delivers them to it alone (M5)', async () => {
    const { a, b, s } = await church();
    await s.obsOn();
    const shots = () => s.obsNative.count('GetSourceScreenshot');
    expect(shots()).toBe(0);
    b.obs.setWatchingHere(true);
    await settle();
    expect(shots()).toBeGreaterThan(0);
    expect(b.obs.image?.image).toBe('data:image/webp;base64,UklGRoY=');
    expect(a.obs.image).toBeNull();
    b.obs.setWatchingHere(false);
    await settle();
    const after = shots();
    await settle();
    expect(shots()).toBe(after);
  });

  it('stops the monitor images when the watching desktop leaves without saying so', async () => {
    const { b, s } = await church();
    await s.obsOn();
    b.obs.setWatchingHere(true);
    await settle();
    b.disconnect();
    await settle();
    const after = s.obsNative.count('GetSourceScreenshot');
    await settle();
    expect(s.obsNative.count('GetSourceScreenshot')).toBe(after);
  });

  it('keeps forwarding OBS after the coordinator’s own connection drops and comes back', async () => {
    const { a, b, s } = await church();
    await s.obsOn();
    expect(a.link.status.role).toBe('coordinator');
    // Streaming fills the venue's upload; the coordinator's relay connection drops a moment.
    a.disconnect();
    await settle();
    a.connect();
    await settle();
    expect(a.link.status.role).toBe('coordinator');
    expect(a.obs.view.state?.ownerName).toBe('Streaming');
    expect(b.obs.view.state?.ownerName).toBe('Streaming');
    s.obsNative.event('CurrentProgramSceneChanged', { sceneName: 'Camera' });
    await settle();
    expect(a.obs.view.state?.currentScene).toBe('Camera');
    expect(b.obs.view.state?.currentScene).toBe('Camera');
    expect(await a.obs.command({ type: 'setScene', scene: 'Blank' })).toEqual({ ok: true });
    expect(await b.obs.command({ type: 'setScene', scene: 'Lyrics' })).toEqual({ ok: true });
  });

  it('gives a phone on a desktop without OBS the OBS view and its commands (M2.8)', async () => {
    const { b, s } = await church();
    await s.obsOn();
    const phone: HostToRemote[] = [];
    b.host.attach({ send: (_to, data) => phone.push(data), drop: () => undefined });
    const invite = b.host.invite();
    await b.host.message('phone-1', {
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      name: 'Sam',
      invite,
    });
    await b.host.approve('phone-1');
    await settle();
    const toPhone = () => phone;
    const view = toPhone()
      .filter((m) => m.type === 'view')
      .at(-1);
    expect(view).toMatchObject({ view: { obs: { ownerName: 'Streaming', reachable: true } } });
    await b.host.message('phone-1', {
      type: 'obsCommand',
      id: 'p1',
      command: { type: 'setScene', scene: 'Camera' },
    });
    expect(toPhone().at(-1)).toEqual({ type: 'obsAck', id: 'p1', ok: true });
    s.obsNative.event('CurrentProgramSceneChanged', { sceneName: 'Camera' });
    await settle();
    expect(
      toPhone()
        .filter((m) => m.type === 'view')
        .at(-1),
    ).toMatchObject({
      view: { obs: { currentScene: 'Camera' } },
    });
  });
});
