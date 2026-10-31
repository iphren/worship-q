/**
 * Phase 2: the session as coordinator (building snapshots, applying other devices'
 * commands), as follower (sending commands, rendering from snapshots) and as viewer.
 */
import { DEFAULT_EXPIRY_MS } from '@worship-q/live-state';
import type { CommandOrigin, LiveSnapshot, OperatorCommand } from '@worship-q/protocol';
import { Store } from '@worship-q/store';
import {
  createTestEnv,
  createTestStore,
  type NodeDriver,
  type TestEnv,
} from '@worship-q/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from './index';

const SUNDAY = '2026-10-11';
const NEXT_SUNDAY = '2026-10-18';
const HOUR = 60 * 60 * 1000;
const ORIGIN: CommandOrigin = { kind: 'operator', deviceId: 'B', name: 'Streaming laptop' };
const mediaUrl = (fileName: string) => `media://${fileName}`;

let driver: NodeDriver;
let env: TestEnv;
let store: Store;
let session: Session;

beforeEach(async () => {
  ({ driver, env, store } = await createTestStore(
    undefined,
    createTestEnv(`${SUNDAY}T09:00:00.000Z`),
  ));
  ({ session } = await Session.open(store, { now: () => env.date() }, 'UTC'));
});
afterEach(() => driver.close());

async function song(title: string, lyrics: string) {
  return session.createSong({ title, lyrics });
}

async function snapshot(revision = 1): Promise<LiveSnapshot> {
  const body = await session.buildSnapshot('A');
  return { ...body!, revision };
}

describe('building snapshots (M1.6)', () => {
  it('carries the live run sheet’s items after add, remove and move', async () => {
    const a = await song('A', 'a1\na2');
    const b = await song('B', 'b1');
    const c = await song('C', 'c1');
    await session.addSong(SUNDAY, a.id);
    const itemB = await session.addSong(SUNDAY, b.id);
    await session.addSong(SUNDAY, c.id);
    expect((await snapshot()).items.map((item) => item.title)).toEqual(['A', 'B', 'C']);
    await session.moveItem(itemB.id, 0);
    expect((await snapshot()).items.map((item) => item.title)).toEqual(['B', 'A', 'C']);
    await session.removeItem(itemB.id);
    const items = (await snapshot()).items;
    expect(items.map((item) => item.title)).toEqual(['A', 'C']);
    expect(items[0]).toMatchObject({
      songId: a.id,
      kind: 'lyrics',
      removed: false,
      pieces: [{ lines: ['a1', 'a2'], block: 0 }],
    });
  });

  it('carries the presented piece, flagged when it is from the previous run sheet', async () => {
    const a = await song('A', 'a1\na2');
    await session.addSong(SUNDAY, a.id);
    await session.next();
    const live = await snapshot();
    expect(live.presented).toMatchObject({
      songId: a.id,
      title: 'A',
      pieces: [{ lines: ['a1', 'a2'] }],
      previous: false,
      websiteUrl: null,
    });
    expect(live.date).toBe(SUNDAY);
    expect(live.state).toEqual(session.live);
    await session.goLive(NEXT_SUNDAY);
    const after = await snapshot();
    expect(after.date).toBe(NEXT_SUNDAY);
    expect(after.items).toEqual([]);
    expect(after.presented).toMatchObject({ title: 'A', previous: true });
  });

  it('marks a song removed from the library and a website’s address', async () => {
    const a = await song('A', 'a1');
    const web = await session.createSong({
      title: 'Web',
      website: { url: 'https://example.org/' },
    });
    await session.addSong(SUNDAY, a.id);
    await session.addSong(SUNDAY, web.id);
    await session.removeSong(a.id);
    const items = (await snapshot()).items;
    expect(items[0]).toMatchObject({ removed: true });
    expect(items[1]).toMatchObject({
      kind: 'website',
      pieces: [{ lines: ['https://example.org/'] }],
    });
  });
});

describe('commands from other devices (M2.1, D24)', () => {
  it('goes live with a date, making the run sheet if needed, and applies each identifier once', async () => {
    const a = await song('A', 'a1');
    await session.addSong(SUNDAY, a.id);
    await session.next();
    expect(
      await session.applyOperatorCommand('g1', { type: 'goLive', date: NEXT_SUNDAY }, ORIGIN),
    ).toEqual({
      result: 'applied',
    });
    expect(session.liveDate).toBe(NEXT_SUNDAY);
    // Go live alone leaves the screen as it was.
    expect(session.presentingPreviousContent).toBe(true);
    expect(
      await session.applyOperatorCommand('g1', { type: 'goLive', date: SUNDAY }, ORIGIN),
    ).toEqual({
      result: 'duplicate',
    });
    expect(session.liveDate).toBe(NEXT_SUNDAY);
  });

  it('applies navigation once per identifier and reports edits for the notice', async () => {
    const a = await song('A', 'a1\na2');
    const b = await song('B', 'b1');
    await session.addSong(SUNDAY, a.id);
    expect(await session.applyOperatorCommand('n1', { type: 'next' }, ORIGIN)).toEqual({
      result: 'applied',
    });
    expect(await session.applyOperatorCommand('n1', { type: 'next' }, ORIGIN)).toEqual({
      result: 'duplicate',
    });
    expect(session.live?.presented?.songId).toBe(a.id);
    const added = await session.applyOperatorCommand(
      'e1',
      { type: 'addItem', songId: b.id },
      ORIGIN,
    );
    expect(added).toMatchObject({ result: 'applied', change: { kind: 'added', title: 'B' } });
    expect(
      await session.applyOperatorCommand('e1', { type: 'addItem', songId: b.id }, ORIGIN),
    ).toEqual({
      result: 'rejected',
    });
    expect((await session.viewLive())!.entries.map((e) => e.song.title)).toEqual(['A', 'B']);
  });
});

describe('following a coordinator (M1.8, M2.2)', () => {
  const sent: OperatorCommand[] = [];
  beforeEach(() => {
    sent.length = 0;
    session.follow({ send: (command) => sent.push(command) });
  });

  it('sends Go live and navigation to the coordinator instead of changing its own state', async () => {
    const a = await song('A', 'a1');
    const before = session.live;
    await session.goLive(NEXT_SUNDAY);
    await session.next();
    await session.setBlank(true);
    await session.addSong(session.liveDate!, a.id);
    expect(sent).toEqual([
      { type: 'goLive', date: NEXT_SUNDAY },
      { type: 'next' },
      { type: 'blank' },
      { type: 'addItem', songId: a.id },
    ]);
    expect(session.live).toEqual(before);
    expect(session.following).toBe(true);
  });

  it('keeps edits to another date to itself (criterion 18)', async () => {
    const a = await song('A', 'a1');
    await session.editRunSheet(NEXT_SUNDAY);
    await session.addSong(NEXT_SUNDAY, a.id);
    expect(sent).toEqual([]);
    expect(session.openDate).toBe(NEXT_SUNDAY);
    expect((await session.viewDate(NEXT_SUNDAY)).entries).toHaveLength(1);
    expect(session.liveDate).toBe(SUNDAY);
  });

  it('shows the coordinator’s run sheet and slide, also for a song it does not have yet', async () => {
    const theirs: LiveSnapshot = {
      revision: 4,
      coordinatorId: 'A',
      state: {
        ...session.live!,
        runSheetId: 'rs-on-A',
        presented: {
          runSheetId: 'rs-on-A',
          itemId: 'it1',
          songId: 'song-on-A',
          pieceId: 'p1',
          index: 0,
        },
        revision: 3,
      },
      date: SUNDAY,
      items: [
        {
          itemId: 'it1',
          songId: 'song-on-A',
          title: 'Only there',
          removed: false,
          kind: 'lyrics',
          pieces: [
            { id: 'p1', lines: ['first', 'second'], block: 0 },
            { id: 'p2', lines: ['third'], block: 1 },
          ],
        },
      ],
      presented: {
        itemId: 'it1',
        pieceId: 'p1',
        songId: 'song-on-A',
        title: 'Only there',
        kind: 'lyrics',
        pieces: [
          { id: 'p1', lines: ['first', 'second'], block: 0 },
          { id: 'p2', lines: ['third'], block: 1 },
        ],
        background: { color: '#112233', assetId: null },
        websiteUrl: null,
        previous: false,
      },
      devices: [],
    };
    await session.applySnapshot(theirs);
    expect(session.isLive).toBe(true);
    expect(session.liveDate).toBe(SUNDAY);
    expect(session.snapshot?.revision).toBe(4);
    const view = (await session.viewLive())!;
    expect(view.entries.map((e) => [e.song.title, e.pieces.map((p) => p.id)])).toEqual([
      ['Only there', ['p1', 'p2']],
    ]);
    const frame = await session.frame(mediaUrl);
    expect(frame.song).toEqual({
      id: 'song-on-A',
      pieces: [
        { id: 'p1', lines: ['first', 'second'] },
        { id: 'p2', lines: ['third'] },
      ],
    });
    expect(frame.pieceId).toBe('p1');
    expect(frame.background.color).toBe('#112233');
    // The synchronized copy is kept for recovery.
    expect(await store.loadLiveState(session.workspace.id)).toEqual(theirs.state);
    // The phones' view is built from the same items.
    expect((await session.snapshotItems()).map((item) => item.title)).toEqual(['Only there']);
  });

  it('holds the live state itself again when it stops following', async () => {
    session.follow(null);
    expect(session.following).toBe(false);
    expect(session.snapshot).toBeNull();
    await session.next();
    expect(sent).toEqual([]);
  });
});

describe('viewer mode (M3)', () => {
  async function viewer() {
    const opened = await Session.open(store, { now: () => env.date() }, 'UTC', { role: 'viewer' });
    return opened.session;
  }

  it('starts nothing and shows an empty output until a snapshot arrives', async () => {
    await store.clearLiveState(session.workspace.id);
    const view = await viewer();
    expect(view.isViewer).toBe(true);
    expect(view.isLive).toBe(false);
    expect(session.live).not.toBeNull();
    await view.next();
    await view.goLive(SUNDAY);
    expect(view.isLive).toBe(false);
    const theirs = await snapshot(2);
    await view.applySnapshot(theirs);
    expect(view.isLive).toBe(true);
    expect(view.liveDate).toBe(SUNDAY);
  });

  it('keeps the last snapshot when the coordinator disappears, until it expires (M3.4)', async () => {
    const a = await song('A', 'a1');
    await session.addSong(SUNDAY, a.id);
    await session.next();
    const view = await viewer();
    view.follow({ send: () => undefined });
    await view.applySnapshot(await snapshot(1));
    view.follow(null);
    expect(view.isLive).toBe(true);
    env.advance(DEFAULT_EXPIRY_MS - HOUR);
    await view.heartbeat();
    expect(view.isLive).toBe(true);
    // A viewer never keeps it alive: the coordinator's last stamp is what counts.
    expect(view.live?.lastActiveAt).toBe(`${SUNDAY}T09:00:00.000Z`);
    env.advance(2 * HOUR);
    await view.heartbeat();
    expect(view.isLive).toBe(false);
    expect(await store.loadLiveState(session.workspace.id)).toBeNull();
  });

  it('reopens as a viewer with what it last showed, while that is unexpired', async () => {
    const a = await song('A', 'a1');
    await session.addSong(SUNDAY, a.id);
    await session.next();
    const first = await viewer();
    await first.applySnapshot(await snapshot(1));
    env.advance(HOUR);
    const again = await viewer();
    expect(again.isLive).toBe(true);
    expect(again.live?.presented?.songId).toBe(a.id);
  });
});
