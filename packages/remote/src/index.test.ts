import { PROTOCOL_VERSION, type HostToRemote } from '@worship-q/protocol';
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
