import {
  PROTOCOL_VERSION,
  type CoordinatorToFollower,
  type DesktopToRelay,
  type FollowerToCoordinator,
  type HostToRemote,
  type LiveSnapshot,
  type RelayToDesktop,
  type RelayToOutput,
} from '@worship-q/protocol';
import { createLiveState } from '@worship-q/live-state';
import { RemoteHost } from '@worship-q/remote';
import { Session } from '@worship-q/session';
import { createTestStore } from '@worship-q/store/testing';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db';
import { Instance } from './instance';
import { Relay, type Socket } from '@worship-q/relay';

class FakeSocket implements Socket {
  received: unknown[] = [];
  closed: number | null = null;
  send(data: string) {
    this.received.push(JSON.parse(data));
  }
  close(code?: number) {
    this.closed = code ?? 1000;
  }
  last<T>(): T {
    return this.received[this.received.length - 1] as T;
  }
  ofType<T extends { type: string }>(type: T['type']): T[] {
    return this.received.filter((m) => (m as T).type === type) as T[];
  }
}

const settle = () => new Promise((done) => setTimeout(done, 120));

const snapshot = (revision: number, coordinatorId: string): LiveSnapshot => ({
  revision,
  coordinatorId,
  state: createLiveState('rs1', '2026-10-11T09:00:00.000Z'),
  date: '2026-10-11',
  items: [],
  presented: null,
  devices: [],
});

async function setup() {
  const instance = new Instance(openDatabase(':memory:'));
  const { workspace, code } = instance.createWorkspace('North Branch');
  const relay = new Relay(instance);
  const { store, env } = await createTestStore();
  const { session } = await Session.open(store, { now: () => env.date() }, 'Europe/London');
  const song = await session.createSong({ title: 'Song', lyrics: 'one\ntwo\n\nthree' });
  await session.addSong(session.openDate, song.id);
  const host = new RemoteHost(session, () => 'North Branch');

  /** Connects a desktop the way the app does, wiring relay messages into the host. */
  function desktop(
    name: string,
    options: { token?: string; role?: 'operator' | 'viewer'; withHost?: boolean } = {},
  ) {
    const token = options.token ?? instance.enroll(code, name)!.token;
    const socket = new FakeSocket();
    const handlers = relay.desktop(socket);
    const say = (message: DesktopToRelay) => handlers.message(JSON.stringify(message));
    if (options.withHost !== false) {
      const original = socket.send.bind(socket);
      socket.send = (data: string) => {
        original(data);
        const message = JSON.parse(data) as RelayToDesktop;
        if (message.type === 'message') void host.message(message.from, message.data);
        if (message.type === 'left') host.left(message.from);
      };
      host.attach({
        send: (to, data) => say({ type: 'send', to, data }),
        drop: (to) => say({ type: 'drop', to }),
      });
    }
    say({
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
    });
    const ready = socket.last<Extract<RelayToDesktop, { type: 'ready' }>>();
    return { socket, handlers, token, say, deviceId: ready.deviceId };
  }

  function phone(fields: Record<string, unknown>) {
    const socket = new FakeSocket();
    const handlers = relay.remote(socket);
    const say = (message: unknown) => handlers.message(JSON.stringify(message));
    say({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      workspace: workspace.id,
      name: 'Phone',
      ...fields,
    });
    return { socket, handlers, say };
  }

  function output(token: string) {
    const socket = new FakeSocket();
    const handlers = relay.output(socket);
    const say = (message: unknown) => handlers.message(JSON.stringify(message));
    say({ type: 'hello', protocolVersion: PROTOCOL_VERSION, token });
    return { socket, handlers, say };
  }

  return { instance, relay, session, host, desktop, phone, output, workspace };
}

describe('remote control through the relay', () => {
  it('needs an operator’s approval before a phone can navigate', async () => {
    const { host, desktop, phone, session } = await setup();
    const first = desktop('Branch laptop');
    expect(first.socket.received[0]).toMatchObject({ type: 'ready', coordinator: true });

    const remote = phone({ invite: host.invite() });
    await settle();
    const pending = remote.socket.last<HostToRemote>();
    expect(pending).toMatchObject({ type: 'pending' });
    expect(host.pending[0]?.code).toBe((pending as { code: string }).code);

    // Commands before approval are ignored.
    remote.say({ type: 'command', id: 'c0', command: { type: 'next' } });
    await settle();
    expect(session.live?.presented).toBeNull();

    await host.approve(host.pending[0]!.connection);
    await settle();
    const approved = remote.socket.received.find(
      (m) => (m as HostToRemote).type === 'approved',
    ) as { grant: string };
    expect(approved.grant).toContain('.');
    const view = remote.socket.last<Extract<HostToRemote, { type: 'view' }>>();
    expect(view.view.items[0]?.pieces.map((p) => [p.lines, p.block])).toEqual([
      [['one', 'two'], 0],
      [['three'], 1],
    ]);

    remote.say({ type: 'command', id: 'c1', command: { type: 'next' } });
    // Sent twice after a reconnection, it is applied once.
    remote.say({ type: 'command', id: 'c1', command: { type: 'next' } });
    await settle();
    expect(session.live?.presented?.pieceId).toBe(view.view.items[0]!.pieces[0]!.id);
    expect(remote.socket.received).toContainEqual({ type: 'ack', id: 'c1', applied: true });
    const shown = remote.socket.last<Extract<HostToRemote, { type: 'view' }>>();
    expect(shown.view.presented?.pieceId).toBe(view.view.items[0]!.pieces[0]!.id);

    // The grant lets the phone back in without another approval, until it is revoked.
    const again = phone({ grant: approved.grant });
    await settle();
    expect(again.socket.received).toContainEqual({ type: 'approved', grant: approved.grant });
    await host.disconnectAll();
    const third = phone({ grant: approved.grant });
    await settle();
    expect(third.socket.last()).toEqual({ type: 'denied', reason: 'revoked' });
  });

  it('turns away a phone without a valid invitation', async () => {
    const { desktop, phone } = await setup();
    desktop('Branch laptop');
    const remote = phone({ invite: 'made-up' });
    await settle();
    expect(remote.socket.last()).toEqual({ type: 'denied', reason: 'invalid-invite' });
  });

  it('keeps one coordinator until another device takes over', async () => {
    const { desktop, phone, host } = await setup();
    const first = desktop('Branch laptop');
    const second = desktop('Home laptop');
    expect(second.socket.last()).toMatchObject({
      type: 'ready',
      coordinator: false,
      coordinatorName: 'Branch laptop',
      coordinatorId: first.deviceId,
    });
    second.say({ type: 'claim' });
    expect(first.socket.last()).toMatchObject({ type: 'ready', coordinator: false });
    expect(second.socket.last()).toMatchObject({ type: 'ready', coordinator: true });

    second.handlers.close();
    first.handlers.close();
    const remote = phone({ invite: host.invite() });
    await settle();
    expect(remote.socket.last()).toEqual({ type: 'unavailable', reason: 'presentation-offline' });
  });

  it('gives the role back to a coordinator that reconnects before its old connection ends', async () => {
    const { desktop, phone, host } = await setup();
    const asleep = desktop('Branch laptop');
    const awake = desktop('Branch laptop', { token: asleep.token });
    expect(awake.socket.last()).toMatchObject({ type: 'ready', coordinator: true });
    expect(asleep.socket.closed).toBe(4002);

    // The old connection times out later; phones still reach the new one.
    asleep.handlers.close();
    const remote = phone({ invite: host.invite() });
    await settle();
    expect(remote.socket.last()).toMatchObject({ type: 'pending' });
  });

  it('answers pings from desktops and phones', async () => {
    const { desktop, phone } = await setup();
    const laptop = desktop('Branch laptop');
    laptop.say({ type: 'ping' });
    expect(laptop.socket.last()).toEqual({ type: 'pong' });
    const remote = phone({ invite: 'made-up' });
    remote.say({ type: 'ping' });
    expect(remote.socket.last()).toEqual({ type: 'pong' });
  });

  it('tells an outdated phone to update', async () => {
    const { phone, desktop } = await setup();
    desktop('Branch laptop');
    const remote = phone({ protocolVersion: 999 });
    expect(remote.socket.last()).toEqual({ type: 'update-needed' });
  });

  it('tells a version 1 desktop to update (M1.1)', async () => {
    const { relay } = await setup();
    const socket = new FakeSocket();
    relay.desktop(socket).message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        token: 'anything',
        capabilities: { roles: [], appVersion: '0.4.0' },
      }),
    );
    expect(socket.last()).toEqual({ type: 'update-needed' });
    expect(socket.closed).toBe(4000);
  });

  it('rejects a desktop without a valid token', async () => {
    const { relay } = await setup();
    const socket = new FakeSocket();
    relay.desktop(socket).message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token: 'nope',
        capabilities: { roles: [], appVersion: 'x' },
      }),
    );
    expect(socket.last()).toEqual({ type: 'rejected', reason: 'unauthorized' });
    expect(socket.closed).toBe(4001);
  });
});

describe('one live state across desktops (M1.7)', () => {
  const command = (id: string): FollowerToCoordinator => ({
    type: 'command',
    id,
    origin: { kind: 'operator', deviceId: 'B', name: 'Streaming' },
    command: { type: 'next' },
  });

  it('carries a follower’s commands to the coordinator and its snapshots back', async () => {
    const { desktop } = await setup();
    const a = desktop('Projector', { withHost: false });
    const b = desktop('Streaming', { withHost: false });
    expect(b.socket.last()).toMatchObject({ type: 'ready', coordinator: false });

    b.say({ type: 'toCoordinator', data: command('c1') });
    expect(a.socket.last()).toEqual({ type: 'peer', from: b.deviceId, data: command('c1') });

    const data: CoordinatorToFollower = { type: 'snapshot', snapshot: snapshot(1, a.deviceId) };
    a.say({ type: 'toFollower', data });
    expect(b.socket.last()).toEqual({ type: 'peer', from: a.deviceId, data });
    // The coordinator does not receive its own broadcast.
    expect(a.socket.ofType<RelayToDesktop>('peer')).toHaveLength(1);

    // Answers go to the one follower that asked.
    a.say({ type: 'toFollower', to: b.deviceId, data: { type: 'ack', id: 'c1', applied: true } });
    expect(b.socket.last()).toMatchObject({ type: 'peer', data: { type: 'ack', id: 'c1' } });
  });

  it('only the coordinator may send snapshots, and only followers commands', async () => {
    const { desktop } = await setup();
    const a = desktop('Projector', { withHost: false });
    const b = desktop('Streaming', { withHost: false });
    const before = [a.socket.received.length, b.socket.received.length];
    b.say({ type: 'toFollower', data: { type: 'snapshot', snapshot: snapshot(1, b.deviceId) } });
    a.say({ type: 'toCoordinator', data: command('x') });
    expect([a.socket.received.length, b.socket.received.length]).toEqual(before);
  });

  it('lets a desktop joining later ask the coordinator for the full snapshot', async () => {
    const { desktop } = await setup();
    const a = desktop('Projector', { withHost: false });
    desktop('Streaming', { withHost: false });
    const c = desktop('Third', { withHost: false });
    c.say({ type: 'toCoordinator', data: { type: 'resync', have: 0 } });
    expect(a.socket.last()).toEqual({
      type: 'peer',
      from: c.deviceId,
      data: { type: 'resync', have: 0 },
    });
    a.say({
      type: 'toFollower',
      to: c.deviceId,
      data: { type: 'snapshot', snapshot: snapshot(7, a.deviceId) },
    });
    expect(c.socket.last()).toMatchObject({ type: 'peer', data: { snapshot: { revision: 7 } } });
  });

  it('names every connected desktop to each of them', async () => {
    const { desktop } = await setup();
    const a = desktop('Projector', { withHost: false });
    const b = desktop('Streaming', { withHost: false, role: 'viewer' });
    const ready = b.socket.last<Extract<RelayToDesktop, { type: 'ready' }>>();
    expect(ready.peers.map((p) => [p.name, p.role])).toEqual([
      ['Projector', 'operator'],
      ['Streaming', 'viewer'],
    ]);
    b.handlers.close();
    const after = a.socket.last<Extract<RelayToDesktop, { type: 'ready' }>>();
    expect(after.peers.map((p) => p.name)).toEqual(['Projector']);
  });

  it('a viewer never becomes coordinator (M3.2)', async () => {
    const { desktop } = await setup();
    const viewer = desktop('Projector PC', { withHost: false, role: 'viewer' });
    expect(viewer.socket.last()).toMatchObject({
      type: 'ready',
      coordinator: false,
      coordinatorId: null,
    });
    viewer.say({ type: 'claim' });
    expect(viewer.socket.last()).toMatchObject({ type: 'ready', coordinator: false });
    const operator = desktop('Laptop', { withHost: false });
    expect(operator.socket.last()).toMatchObject({ type: 'ready', coordinator: true });
    operator.handlers.close();
    expect(viewer.socket.last()).toMatchObject({
      type: 'ready',
      coordinator: false,
      coordinatorId: null,
    });
  });
});

describe('phones on every operator device (M2.5, M2.8)', () => {
  it('routes a phone to the desktop whose invitation it holds', async () => {
    const { desktop, phone } = await setup();
    const a = desktop('Projector', { withHost: false });
    const b = desktop('Streaming', { withHost: false });
    const remote = phone({ invite: `${b.deviceId}.secret` });
    expect(b.socket.last()).toMatchObject({
      type: 'message',
      data: { invite: `${b.deviceId}.secret` },
    });
    expect(a.socket.ofType<RelayToDesktop>('message')).toHaveLength(0);
    remote.say({ type: 'command', id: 'c1', command: { type: 'next' } });
    expect(b.socket.last()).toMatchObject({ type: 'message', data: { type: 'command', id: 'c1' } });
    // Only that desktop may answer it.
    const from = (b.socket.last() as { from: string }).from;
    a.say({ type: 'send', to: from, data: { type: 'ack', id: 'c1', applied: true } });
    expect(remote.socket.received).toEqual([]);
    b.say({ type: 'send', to: from, data: { type: 'ack', id: 'c1', applied: true } });
    expect(remote.socket.last()).toEqual({ type: 'ack', id: 'c1', applied: true });
  });

  it('sends a phone back with its grant to the coordinator when its desktop closes', async () => {
    const { desktop, phone } = await setup();
    const a = desktop('Projector', { withHost: false });
    const b = desktop('Streaming', { withHost: false });
    const remote = phone({ invite: `${b.deviceId}.secret` });
    b.handlers.close();
    expect(remote.socket.last()).toEqual({ type: 'unavailable', reason: 'reconnect' });
    expect(remote.socket.closed).toBe(4005);
    const again = phone({ grant: 'g1.secret' });
    expect(a.socket.last()).toMatchObject({ type: 'message', data: { grant: 'g1.secret' } });
    expect(again.socket.received).toEqual([]);
  });

  it('routes a phone whose desktop is gone to the coordinator', async () => {
    const { desktop, phone } = await setup();
    const a = desktop('Projector', { withHost: false });
    phone({ invite: 'not-here.secret' });
    expect(a.socket.last()).toMatchObject({ type: 'message', data: { invite: 'not-here.secret' } });
  });
});

describe('handover (M2.3)', () => {
  it('flips the roles and carries the old coordinator’s final snapshot to the new one', async () => {
    const { desktop } = await setup();
    const a = desktop('Projector', { withHost: false });
    const b = desktop('Streaming', { withHost: false });
    b.say({ type: 'claim' });
    expect(a.socket.last()).toMatchObject({
      type: 'ready',
      coordinator: false,
      coordinatorId: b.deviceId,
    });
    expect(b.socket.last()).toMatchObject({ type: 'ready', coordinator: true });
    const handover: FollowerToCoordinator = {
      type: 'handover',
      snapshot: snapshot(12, a.deviceId),
    };
    a.say({ type: 'toCoordinator', data: handover });
    expect(b.socket.last()).toEqual({ type: 'peer', from: a.deviceId, data: handover });
    b.say({ type: 'toFollower', data: { type: 'snapshot', snapshot: snapshot(13, b.deviceId) } });
    expect(a.socket.last()).toMatchObject({ type: 'peer', data: { snapshot: { revision: 13 } } });
  });
});

describe('browser outputs (M7.3, M7.8)', () => {
  it('feeds an output page snapshots and drops one that tries to send anything', async () => {
    const { desktop, output, instance, workspace } = await setup();
    const a = desktop('Projector', { withHost: false });
    const { token } = instance.createOutputLink(workspace.id, 'subtitle', 'OBS');
    const page = output(token);
    expect(page.socket.received[0]).toMatchObject({ type: 'ready', kind: 'subtitle' });
    // The relay asks the coordinator for the current snapshot for it.
    const ask = a.socket.last<Extract<RelayToDesktop, { type: 'peer' }>>();
    expect(ask).toMatchObject({ type: 'peer', data: { type: 'resync', have: 0 } });
    expect(ask.from.startsWith('output:')).toBe(true);
    a.say({
      type: 'toFollower',
      to: ask.from,
      data: { type: 'snapshot', snapshot: snapshot(3, a.deviceId) },
    });
    expect(page.socket.last()).toMatchObject({ type: 'snapshot', snapshot: { revision: 3 } });
    // Broadcasts reach it; acks and grant lists do not.
    a.say({ type: 'toFollower', data: { type: 'snapshot', snapshot: snapshot(4, a.deviceId) } });
    a.say({ type: 'toFollower', data: { type: 'grantList', grants: [] } });
    expect(page.socket.last()).toMatchObject({ type: 'snapshot', snapshot: { revision: 4 } });
    expect(page.socket.ofType<RelayToOutput>('snapshot')).toHaveLength(2);
    // The coordinator sees it among the peers.
    const ready = a.socket.ofType<Extract<RelayToDesktop, { type: 'ready' }>>('ready').at(-1)!;
    expect(ready.peers.map((p) => [p.name, p.role])).toContainEqual(['OBS', 'output']);

    page.say({ type: 'command', id: 'x', command: { type: 'next' } });
    expect(page.socket.closed).toBe(4006);
  });

  it('refuses a wrong or revoked token', async () => {
    const { output, instance, workspace } = await setup();
    const wrong = output('nope');
    expect(wrong.socket.last()).toEqual({ type: 'rejected', reason: 'unauthorized' });
    const { link, token } = instance.createOutputLink(workspace.id, 'slideshow', 'Foyer');
    instance.revokeOutputLinks(workspace.id, link.id);
    const revoked = output(token);
    expect(revoked.socket.last()).toEqual({ type: 'rejected', reason: 'unauthorized' });
  });

  it('keeps an output fed across a handover and tells it to wait when the coordinator is gone', async () => {
    const { desktop, output, instance, workspace, relay } = await setup();
    const a = desktop('Projector', { withHost: false });
    const b = desktop('Streaming', { withHost: false });
    const { link, token } = instance.createOutputLink(workspace.id, 'slideshow', 'Foyer');
    const page = output(token);
    b.say({ type: 'claim' });
    b.say({ type: 'toFollower', data: { type: 'snapshot', snapshot: snapshot(9, b.deviceId) } });
    expect(page.socket.last()).toMatchObject({ type: 'snapshot', snapshot: { revision: 9 } });
    b.handlers.close();
    expect(page.socket.last()).toEqual({ type: 'waiting' });
    // Another coordinator picks it up again.
    a.say({ type: 'claim' });
    expect(a.socket.last()).toMatchObject({ type: 'peer', data: { type: 'resync' } });
    instance.revokeOutputLinks(workspace.id, link.id);
    relay.outputRevoked(link.id);
    expect(page.socket.last()).toEqual({ type: 'rejected', reason: 'revoked' });
    expect(page.socket.closed).toBe(4001);
  });
});
