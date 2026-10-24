import { PROTOCOL_VERSION, type HostToRemote, type RelayToCoordinator } from '@worship-q/protocol';
import { RemoteHost } from '@worship-q/remote';
import { Session } from '@worship-q/session';
import { createTestStore } from '@worship-q/store/testing';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db';
import { Instance } from './instance';
import { Relay, type Socket } from './relay';

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
}

const settle = () => new Promise((done) => setTimeout(done, 120));

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
  function desktop(name: string) {
    const enrolled = instance.enroll(code, name)!;
    const socket = new FakeSocket();
    const handlers = relay.desktop(socket);
    const original = socket.send.bind(socket);
    socket.send = (data: string) => {
      original(data);
      const message = JSON.parse(data) as RelayToCoordinator;
      if (message.type === 'message') void host.message(message.from, message.data);
      if (message.type === 'left') host.left(message.from);
    };
    host.attach({
      send: (to, data) => handlers.message(JSON.stringify({ type: 'send', to, data })),
      drop: (to) => handlers.message(JSON.stringify({ type: 'drop', to })),
    });
    handlers.message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token: enrolled.token,
        capabilities: { roles: ['coordinator'], appVersion: 'test' },
      }),
    );
    return { socket, handlers };
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

  return { instance, relay, session, host, desktop, phone, workspace };
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
    });
    second.handlers.message(JSON.stringify({ type: 'claim' }));
    expect(first.socket.last()).toMatchObject({ type: 'ready', coordinator: false });
    expect(second.socket.last()).toMatchObject({ type: 'ready', coordinator: true });

    second.handlers.close();
    const remote = phone({ invite: host.invite() });
    await settle();
    expect(remote.socket.last()).toEqual({ type: 'unavailable', reason: 'presentation-offline' });
  });

  it('tells an outdated phone to update', async () => {
    const { phone, desktop } = await setup();
    desktop('Branch laptop');
    const remote = phone({ protocolVersion: 999 });
    expect(remote.socket.last()).toEqual({ type: 'update-needed' });
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
