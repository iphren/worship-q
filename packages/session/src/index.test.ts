import { DEFAULT_EXPIRY_MS } from '@worship-q/live-state';
import type { OutputFrame, Passage } from '@worship-q/protocol';
import { Store } from '@worship-q/store';
import {
  createTestEnv,
  createTestStore,
  type NodeDriver,
  type TestEnv,
} from '@worship-q/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ReadOnlyDateError,
  Session,
  passageSongFields,
  songKind,
  songPieces,
  VIDEO_PIECE_ID,
  WEBSITE_PIECE_ID,
  type StartKind,
} from './index';

// The clock starts on Sunday 11 October 2026, 09:00 in the workspace timezone (UTC).
const SUNDAY = '2026-10-11';
const NEXT_SUNDAY = '2026-10-18';
const LAST_SUNDAY = '2026-10-04';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const mediaUrl = (fileName: string) => `media://${fileName}`;

let driver: NodeDriver;
let env: TestEnv;
let store: Store;
let session: Session;
let start: StartKind;

/** Opens the app again on the same database, as after a restart or a crash. */
async function reopen() {
  ({ session, start } = await Session.open(store, { now: () => env.date() }, 'UTC'));
  return session;
}

/** The lyrics currently on the output, or null when it shows only the background. */
async function shown(): Promise<string[] | null> {
  const frame = await session.frame(mediaUrl);
  if (frame.blank) return null;
  return frame.song?.pieces.find((piece) => piece.id === frame.pieceId)?.lines ?? null;
}

async function song(title: string, lyrics: string) {
  return session.createSong({ title, lyrics });
}

/** Plans a date without leaving it open: write through the store, as an earlier week did. */
async function plan(date: string, songIds: string[]) {
  const sheet = await store.ensureRunSheet(session.workspace.id, date);
  for (const id of songIds) await store.addItem(sheet.id, id);
  return sheet;
}

async function playAt(entryIndex: number, pieceIndex: number) {
  const view = (await session.viewLive())!;
  const entry = view.entries[entryIndex]!;
  return session.play(entry.item.id, entry.pieces[pieceIndex]!.id);
}

beforeEach(async () => {
  ({ driver, env, store } = await createTestStore(
    undefined,
    createTestEnv('2026-10-11T09:00:00.000Z'),
  ));
  await reopen();
});
afterEach(() => driver.close());

describe('first run', () => {
  it('creates a local workspace with Sunday meetings', () => {
    expect(session.workspace.meetingDays).toEqual([0]);
    expect(session.workspace.timezone).toBe('UTC');
  });

  it('goes live with the next meeting date, including today, with nothing presented', async () => {
    expect(start).toBe('started');
    expect(session.isLive).toBe(true);
    expect(session.liveDate).toBe(SUNDAY);
    expect(session.openDate).toBe(SUNDAY);
    expect(session.live?.presented).toBeNull();

    driver.close();
    ({ driver, env, store } = await createTestStore(
      undefined,
      createTestEnv('2026-10-12T09:00:00.000Z'),
    ));
    await reopen();
    expect(session.liveDate).toBe(NEXT_SUNDAY);
    expect(session.openDate).toBe(NEXT_SUNDAY);
  });

  it('shows an empty output', async () => {
    expect(await session.frame(mediaUrl)).toMatchObject({
      blank: false,
      song: null,
      pieceId: null,
    });
  });

  it('covers the whole local-only path: song, run sheet, present', async () => {
    const created = await song(
      'Amazing Grace',
      'Amazing grace\n奇异恩典\n\nHow sweet the sound\n何等甘甜',
    );
    await session.addSong(session.openDate, created.id);
    await session.goLive(session.openDate);
    await session.next();
    expect(await shown()).toEqual(['Amazing grace', '奇异恩典']);
    await session.next();
    expect(await shown()).toEqual(['How sweet the sound', '何等甘甜']);
  });
});

describe('start rules (criterion 31)', () => {
  it('starts live from today’s run sheet with nothing presented', async () => {
    const a = await song('A', 'a1\na2');
    await plan(SUNDAY, [a.id]);
    await reopen();
    expect(session.liveDate).toBe(SUNDAY);
    expect(session.openDate).toBe(SUNDAY);
    expect(session.live?.presented).toBeNull();
    expect(await shown()).toBeNull();
  });

  it('goes live with a planned today even when it is not a meeting day', async () => {
    env.setNow('2026-10-14T09:00:00.000Z'); // Wednesday
    await reopen();
    expect(session.liveDate).toBe(NEXT_SUNDAY);
    const a = await song('A', 'a1');
    await plan('2026-10-14', [a.id]);
    env.advance(DEFAULT_EXPIRY_MS + 1000);
    await reopen();
    expect(session.liveDate).toBe('2026-10-14');
  });

  it('does not treat an empty run sheet as a plan for today', async () => {
    env.setNow('2026-10-14T09:00:00.000Z'); // Wednesday
    await store.ensureRunSheet(session.workspace.id, '2026-10-14');
    env.advance(DEFAULT_EXPIRY_MS + 1000);
    await reopen();
    expect(session.liveDate).toBe(NEXT_SUNDAY);
  });

  it('resumes the run sheet, piece and blank flag after the app is killed mid-presentation', async () => {
    const a = await song('A', 'a1\na2\n\na3\na4');
    await plan(SUNDAY, [a.id]);
    await reopen();
    await playAt(0, 1);
    await session.setBlank(true);
    const before = session.live;

    env.advance(5 * 60 * 1000);
    await reopen(); // no shutdown step ran: the state was saved on every change
    expect(start).toBe('resumed');
    expect(session.live).toMatchObject({
      runSheetId: before!.runSheetId,
      presented: before!.presented,
      blank: true,
    });
    await session.setBlank(false);
    expect(await shown()).toEqual(['a3', 'a4']);
  });

  it('resumes last week’s live state within the expiry period even on a later date', async () => {
    const a = await song('A', 'a1');
    await plan(SUNDAY, [a.id]);
    await reopen();
    await session.next();
    env.advance(DEFAULT_EXPIRY_MS - 1000);
    await reopen();
    expect(start).toBe('resumed');
    expect(await shown()).toEqual(['a1']);
  });

  it('after expiry starts afresh from today’s run sheet with nothing presented', async () => {
    const a = await song('A', 'a1');
    await plan(SUNDAY, [a.id]);
    await plan(NEXT_SUNDAY, [a.id]);
    await reopen();
    await session.next();

    env.advance(7 * DAY);
    await reopen();
    expect(start).toBe('started');
    expect(session.liveDate).toBe(NEXT_SUNDAY);
    expect(session.live?.presented).toBeNull();
    expect(session.live?.blank).toBe(false);
  });

  it('after expiry with nothing planned today goes live with the next meeting date', async () => {
    const a = await song('A', 'a1');
    await plan(SUNDAY, [a.id]);
    await reopen();
    await session.next();

    env.advance(3 * DAY); // Wednesday
    await reopen();
    expect(start).toBe('started');
    expect(session.liveDate).toBe(NEXT_SUNDAY);
    expect(session.openDate).toBe(NEXT_SUNDAY);
    expect(session.live?.presented).toBeNull();
    expect(await shown()).toBeNull();
    expect((await store.loadLiveState(session.workspace.id))?.runSheetId).toBe(
      session.live!.runSheetId,
    );
  });

  it('stays alive while the app is open, however long', async () => {
    const a = await song('A', 'a1');
    await plan(SUNDAY, [a.id]);
    await reopen();
    for (let i = 0; i < 10; i++) {
      env.advance(DEFAULT_EXPIRY_MS - 1000);
      await session.heartbeat();
    }
    await reopen();
    expect(start).toBe('resumed');
  });

  it('goes live again on reopening after the presentation was ended, with nothing presented', async () => {
    const a = await song('A', 'a1');
    await plan(SUNDAY, [a.id]);
    await reopen();
    await session.next();
    await session.endPresentation();
    env.advance(HOUR);
    await reopen();
    expect(start).toBe('started');
    expect(session.liveDate).toBe(SUNDAY);
    expect(session.live?.presented).toBeNull();
    expect(await shown()).toBeNull();
  });

  it('moves the open date on with the calendar while the app stays open', async () => {
    await session.endPresentation();
    let notified = 0;
    session.subscribe(() => notified++);
    expect(session.openDate).toBe(SUNDAY);
    await session.heartbeat();
    expect(notified).toBe(0);

    env.advance(DAY);
    await session.heartbeat();
    expect(notified).toBe(1);
    expect(session.openDate).toBe(NEXT_SUNDAY);
  });

  it('goes live with today when its run sheet was tried out and ended the day before', async () => {
    env.setNow('2026-10-10T22:00:00.000Z');
    await reopen();
    await session.goLive(SUNDAY);
    expect(await session.endPresentation()).toBe(SUNDAY);
    env.advance(3 * HOUR);
    await reopen();
    expect(session.today()).toBe(SUNDAY);
    expect(session.liveDate).toBe(SUNDAY);
  });
});

describe('presenting', () => {
  let a: Awaited<ReturnType<typeof song>>;
  let b: Awaited<ReturnType<typeof song>>;
  beforeEach(async () => {
    a = await song('A', 'a1\na2\n\na3\na4');
    b = await song('B', 'b1\nb2');
    await plan(SUNDAY, [a.id, b.id, a.id]);
    await reopen();
  });

  it('shows every piece of the live run sheet, with a repeated song as its own item', async () => {
    const view = (await session.viewLive())!;
    expect(view.entries.map((e) => [e.song.title, e.pieces.length])).toEqual([
      ['A', 2],
      ['B', 1],
      ['A', 2],
    ]);
    expect(view.entries[0]!.item.id).not.toBe(view.entries[2]!.item.id);
  });

  it('presents any piece in any order', async () => {
    await playAt(2, 1);
    expect(await shown()).toEqual(['a3', 'a4']);
    expect(session.live?.presented?.index).toBe(4);
    await playAt(1, 0);
    expect(await shown()).toEqual(['b1', 'b2']);
  });

  it('steps through songs with next and previous', async () => {
    const seen: (string[] | null)[] = [];
    for (let i = 0; i < 6; i++) {
      await session.next();
      seen.push(await shown());
    }
    expect(seen.map((lines) => lines?.[0])).toEqual(['a1', 'a3', 'b1', 'a1', 'a3', 'a3']);
    await session.previous();
    expect(await shown()).toEqual(['a1', 'a2']);
  });

  it('applies rapid commands in order', async () => {
    await Promise.all([session.next(), session.next(), session.next()]);
    expect(await shown()).toEqual(['b1', 'b2']);
  });

  it('blank shows the background without lyrics and keeps the position', async () => {
    await session.next();
    await session.setBlank(true);
    const frame = await session.frame(mediaUrl);
    expect(frame.blank).toBe(true);
    expect(frame.pieceId).not.toBeNull();
    await session.setBlank(false);
    expect(await shown()).toEqual(['a1', 'a2']);
  });

  it('does nothing when nothing is live', async () => {
    await session.endPresentation();
    expect(await session.next()).toBe(false);
    expect(await session.setBlank(true)).toBe(false);
    expect(await shown()).toBeNull();
  });

  it('tells listeners when something changed', async () => {
    let calls = 0;
    const unsubscribe = session.subscribe(() => calls++);
    const version = session.version;
    await session.next();
    expect(calls).toBe(1);
    expect(session.version).toBe(version + 1);
    unsubscribe();
    await session.next();
    expect(calls).toBe(1);
  });
});

describe('jumping to a slide of the presented item', () => {
  beforeEach(async () => {
    const first = await song('First', 'one\n\ntwo\n\nthree');
    const second = await song('Second', 'four\n\nfive');
    await session.addSong(session.openDate, first.id);
    await session.addSong(session.openDate, second.id);
    await session.goLive(session.openDate);
  });

  it('presents the slide at that position of the presented item', async () => {
    await playAt(1, 0);
    expect(await session.playSlide(1)).toBe(true);
    expect(await shown()).toEqual(['five']);
    expect(await session.playSlide(0)).toBe(true);
    expect(await shown()).toEqual(['four']);
  });

  it('uses the first item when nothing is presented yet', async () => {
    expect(await session.playSlide(2)).toBe(true);
    expect(await shown()).toEqual(['three']);
  });

  it('does nothing when the item has no such slide', async () => {
    await playAt(1, 0);
    expect(await session.playSlide(2)).toBe(false);
    expect(await shown()).toEqual(['four']);
  });

  it('shows the lyrics again when blank', async () => {
    await playAt(0, 0);
    await session.setBlank(true);
    await session.playSlide(1);
    expect(await shown()).toEqual(['two']);
  });
});

describe('moving between items without presenting', () => {
  beforeEach(async () => {
    const first = await song('First', 'one\n\ntwo');
    const second = await song('Second', 'three\n\nfour');
    const third = await song('Third', 'five');
    for (const { id } of [first, second, third]) await session.addSong(session.openDate, id);
    await session.goLive(session.openDate);
  });

  const itemAt = async (index: number) => (await session.viewLive())!.entries[index]!.item.id;

  it('leaves the screen as it is', async () => {
    await playAt(0, 1);
    expect(await session.browseItem(1)).toBe(true);
    expect(session.browsedItemId).toBe(await itemAt(1));
    expect(await shown()).toEqual(['two']);
  });

  it('moves the slide keys to the browsed item', async () => {
    await playAt(0, 0);
    await session.browseItem(1);
    await session.browseItem(1);
    expect(await session.playSlide(0)).toBe(true);
    expect(await shown()).toEqual(['five']);
    expect(session.browsedItemId).toBeNull();
  });

  it('starts from the first item when nothing is presented yet', async () => {
    await session.browseItem(1);
    expect(session.browsedItemId).toBe(await itemAt(1));
  });

  it('stays put at either end of the run sheet', async () => {
    await playAt(0, 0);
    expect(await session.browseItem(-1)).toBe(false);
    expect(session.browsedItemId).toBeNull();
    await session.browseItem(1);
    await session.browseItem(1);
    expect(await session.browseItem(1)).toBe(false);
    expect(session.browsedItemId).toBe(await itemAt(2));
  });

  it('is forgotten once another slide is presented', async () => {
    await playAt(0, 0);
    await session.browseItem(1);
    await playAt(0, 1);
    expect(session.browsedItemId).toBeNull();
    await session.next();
    expect(await shown()).toEqual(['three']);
  });

  it('presents the browsed item with down, next and space', async () => {
    await playAt(0, 0);
    await session.browseItem(1);
    await session.stepInItem(1);
    expect(await shown()).toEqual(['three']);

    await session.browseItem(1);
    await session.next();
    expect(await shown()).toEqual(['five']);

    await session.browseItem(-1);
    await session.unblankOrNext();
    expect(await shown()).toEqual(['three']);
  });

  it('presents the last slide of the browsed item with up', async () => {
    await playAt(2, 0);
    await session.browseItem(-1);
    await session.stepInItem(-1);
    expect(await shown()).toEqual(['four']);
  });

  it('presents the browsed item rather than the blanked one', async () => {
    await playAt(0, 0);
    await session.setBlank(true);
    await session.browseItem(1);
    await session.unblankOrNext();
    expect(session.live!.blank).toBe(false);
    expect(await shown()).toEqual(['three']);

    await session.setBlank(true);
    await session.browseItem(1);
    await session.stepInItem(1);
    expect(session.live!.blank).toBe(false);
    expect(await shown()).toEqual(['five']);
  });

  it('acts on the presented item when browsing back to it', async () => {
    await playAt(0, 0);
    await session.browseItem(1);
    await session.browseItem(-1);
    await session.stepInItem(1);
    expect(await shown()).toEqual(['two']);
  });

  it('can be moved to any item directly', async () => {
    await playAt(0, 0);
    expect(await session.browseTo(await itemAt(2))).toBe(true);
    expect(await shown()).toEqual(['one']);
    await session.stepInItem(1);
    expect(await shown()).toEqual(['five']);
    expect(await session.browseTo('missing')).toBe(false);
  });

  it('unblanks with space while blank when no other item is browsed', async () => {
    await playAt(0, 0);
    await session.setBlank(true);
    await session.unblankOrNext();
    expect(session.live!.blank).toBe(false);
    expect(await shown()).toEqual(['one']);
  });
});

describe('run-sheet edits in live mode', () => {
  let a: Awaited<ReturnType<typeof song>>;
  let b: Awaited<ReturnType<typeof song>>;
  beforeEach(async () => {
    a = await song('A', 'a1\na2');
    b = await song('B', 'b1\nb2');
    await plan(SUNDAY, [a.id, b.id]);
    await reopen();
  });

  it('do not change what is on screen', async () => {
    await playAt(1, 0);
    const view = (await session.viewLive())!;
    await session.removeItem(view.entries[1]!.item.id);
    expect(await shown()).toEqual(['b1', 'b2']);
    await session.addSong(SUNDAY, a.id);
    await session.moveItem(view.entries[0]!.item.id, 1);
    expect(await shown()).toEqual(['b1', 'b2']);
  });

  it('continue from the removed item’s place on next', async () => {
    const c = await song('C', 'c1');
    await session.addSong(SUNDAY, c.id);
    await playAt(1, 0);
    const view = (await session.viewLive())!;
    await session.removeItem(view.entries[1]!.item.id);
    await session.next();
    expect(await shown()).toEqual(['c1']);
  });

  it('are kept in the dated run sheet after the presentation ends', async () => {
    await session.addSong(SUNDAY, b.id);
    await session.endPresentation();
    const view = await session.viewDate(SUNDAY);
    expect(view.entries.map((e) => e.song.title)).toEqual(['A', 'B', 'B']);
  });
});

describe('adding at a place (media uploads U16, U17)', () => {
  let a: Awaited<ReturnType<typeof song>>;
  let b: Awaited<ReturnType<typeof song>>;
  let c: Awaited<ReturnType<typeof song>>;
  beforeEach(async () => {
    a = await song('A', 'a1');
    b = await song('B', 'b1');
    c = await song('C', 'c1');
    await plan(SUNDAY, [a.id, b.id]);
    await reopen();
  });
  const titles = async () => (await session.viewDate(SUNDAY)).entries.map((e) => e.song.title);
  const itemOf = async (index: number) => (await session.viewDate(SUNDAY)).entries[index]!.item;

  it('places the song after the item named, first with null, last without one', async () => {
    await session.addSong(SUNDAY, c.id, (await itemOf(0)).id);
    expect(await titles()).toEqual(['A', 'C', 'B']);
    await session.addSong(SUNDAY, c.id, null);
    expect(await titles()).toEqual(['C', 'A', 'C', 'B']);
    await session.addSong(SUNDAY, c.id);
    expect(await titles()).toEqual(['C', 'A', 'C', 'B', 'C']);
  });

  it('goes last when the item named is gone', async () => {
    const first = await itemOf(0);
    await session.removeItem(first.id);
    await session.addSong(SUNDAY, c.id, first.id);
    expect(await titles()).toEqual(['B', 'C']);
  });

  it('follows the item at its new place when it was moved', async () => {
    const first = await itemOf(0);
    await session.moveItem(first.id, 1);
    await session.addSong(SUNDAY, c.id, first.id);
    expect(await titles()).toEqual(['B', 'A', 'C']);
  });

  it('sends the place to the coordinator from a follower', async () => {
    const sent: unknown[] = [];
    session.follow({ send: (command) => sent.push(command) });
    const first = await itemOf(0);
    await session.addSong(SUNDAY, c.id, first.id);
    await session.addSong(SUNDAY, c.id, null);
    await session.addSong(SUNDAY, c.id);
    expect(sent).toEqual([
      { type: 'addItem', songId: c.id, afterItemId: first.id },
      { type: 'addItem', songId: c.id, afterItemId: null },
      { type: 'addItem', songId: c.id },
    ]);
  });

  it('puts a removed item back in its place, as it was', async () => {
    await session.addSong(SUNDAY, c.id);
    const middle = await itemOf(1);
    await session.removeItem(middle.id);
    expect(await titles()).toEqual(['A', 'C']);
    await session.restoreItem(middle, (await itemOf(0)).id);
    expect(await titles()).toEqual(['A', 'B', 'C']);
    expect((await itemOf(1)).id).toBe(middle.id);
  });

  it('asks the coordinator for the song again after the same item, from a follower', async () => {
    const second = await itemOf(1);
    const sent: unknown[] = [];
    session.follow({ send: (command) => sent.push(command) });
    await session.restoreItem(second, (await itemOf(0)).id);
    expect(sent).toEqual([{ type: 'addItem', songId: b.id, afterItemId: (await itemOf(0)).id }]);
  });

  it('is placed by the coordinator as a phone’s edit is', async () => {
    const first = await itemOf(0);
    await session.remoteEdit('e1', { type: 'addItem', songId: c.id, afterItemId: first.id });
    expect((await session.viewLive())!.entries.map((e) => e.song.title)).toEqual(['A', 'C', 'B']);
  });

  it('makes an editable run sheet live when nothing is', async () => {
    await session.endPresentation();
    expect(session.isLive).toBe(false);
    await session.addSong(SUNDAY, c.id, null);
    expect(session.liveDate).toBe(SUNDAY);
    expect(session.live?.presented).toBeNull();
  });
});

describe('run-sheet edits from a remote controller', () => {
  let a: Awaited<ReturnType<typeof song>>;
  let b: Awaited<ReturnType<typeof song>>;
  let c: Awaited<ReturnType<typeof song>>;
  beforeEach(async () => {
    a = await song('A', 'a1');
    b = await song('B', 'b1');
    c = await song('C', 'c1');
    await plan(SUNDAY, [a.id, b.id]);
    await reopen();
  });

  async function titles() {
    return (await session.viewLive())!.entries.map((entry) => entry.song.title);
  }
  async function itemIds() {
    return (await session.viewLive())!.entries.map((entry) => entry.item.id);
  }

  it('add a song at the end, at the top, or after an item', async () => {
    const [first] = await itemIds();
    await session.remoteEdit('1', { type: 'addItem', songId: c.id });
    await session.remoteEdit('2', { type: 'addItem', songId: c.id, afterItemId: null });
    await session.remoteEdit('3', { type: 'addItem', songId: c.id, afterItemId: first! });
    expect(await titles()).toEqual(['C', 'A', 'C', 'B', 'C']);
  });

  it('add at the end after an item that is gone', async () => {
    await session.remoteEdit('1', { type: 'addItem', songId: c.id, afterItemId: 'gone' });
    expect(await titles()).toEqual(['A', 'B', 'C']);
  });

  it('cannot add a song removed from the library', async () => {
    await session.removeSong(c.id);
    expect(await session.remoteEdit('1', { type: 'addItem', songId: c.id })).toBeNull();
    expect(await titles()).toEqual(['A', 'B']);
  });

  it('move an item after another or to the top', async () => {
    await session.addSong(SUNDAY, c.id);
    const [ia, ib, ic] = await itemIds();
    const moved = await session.remoteEdit('1', {
      type: 'moveItem',
      itemId: ia!,
      afterItemId: ib!,
    });
    expect(moved).toMatchObject({ kind: 'moved', title: 'A', fromIndex: 0, toIndex: 1 });
    expect(await titles()).toEqual(['B', 'A', 'C']);
    await session.remoteEdit('2', { type: 'moveItem', itemId: ic!, afterItemId: null });
    expect(await titles()).toEqual(['C', 'B', 'A']);
  });

  it('do not report a move that leaves the order as it was', async () => {
    const [ia] = await itemIds();
    expect(
      await session.remoteEdit('1', { type: 'moveItem', itemId: ia!, afterItemId: null }),
    ).toBeNull();
  });

  it('remove an item and leave the screen as it is', async () => {
    await playAt(1, 0);
    const [, ib] = await itemIds();
    const removed = await session.remoteEdit('1', { type: 'removeItem', itemId: ib! });
    expect(removed).toMatchObject({ kind: 'removed', title: 'B' });
    expect(await titles()).toEqual(['A']);
    expect(await shown()).toEqual(['b1']);
  });

  it('apply a repeated edit once', async () => {
    await session.remoteEdit('same', { type: 'addItem', songId: c.id });
    expect(await session.remoteEdit('same', { type: 'addItem', songId: c.id })).toBeNull();
    expect(await titles()).toEqual(['A', 'B', 'C']);
  });

  it('only reach the live run sheet', async () => {
    const future = await plan(NEXT_SUNDAY, [a.id]);
    const [other] = await store.listItems(future.id);
    expect(await session.remoteEdit('1', { type: 'removeItem', itemId: other!.id })).toBeNull();
    expect(await store.listItems(future.id)).toHaveLength(1);
  });

  it('do nothing once the presentation has ended', async () => {
    await session.endPresentation();
    expect(await session.remoteEdit('1', { type: 'addItem', songId: c.id })).toBeNull();
  });

  it('can be undone', async () => {
    const added = (await session.remoteEdit('1', { type: 'addItem', songId: c.id }))!;
    expect(await session.undoRemoteEdit(added)).toBe(true);
    expect(await titles()).toEqual(['A', 'B']);

    const [ia, ib] = await itemIds();
    const moved = (await session.remoteEdit('2', {
      type: 'moveItem',
      itemId: ia!,
      afterItemId: ib!,
    }))!;
    await session.undoRemoteEdit(moved);
    expect(await titles()).toEqual(['A', 'B']);

    const removed = (await session.remoteEdit('3', { type: 'removeItem', itemId: ia! }))!;
    await session.undoRemoteEdit(removed);
    expect(await itemIds()).toEqual([ia, ib]);
  });

  it('restore a removed presented item, so next continues from it', async () => {
    const [ia] = await itemIds();
    await playAt(0, 0);
    const removed = (await session.remoteEdit('1', { type: 'removeItem', itemId: ia! }))!;
    await session.undoRemoteEdit(removed);
    await session.next();
    expect(await shown()).toEqual(['b1']);
  });

  it('cannot be undone once another run sheet is live', async () => {
    const added = (await session.remoteEdit('1', { type: 'addItem', songId: c.id }))!;
    await session.goLive(NEXT_SUNDAY);
    expect(await session.undoRemoteEdit(added)).toBe(false);
    expect((await session.viewDate(SUNDAY)).entries).toHaveLength(3);
  });
});

describe('ending', () => {
  beforeEach(async () => {
    const a = await song('A', 'a1');
    await plan(SUNDAY, [a.id]);
    await reopen();
    await session.next();
  });

  it('clears the output and opens the current or next meeting day', async () => {
    expect(await session.endPresentation()).toBe(SUNDAY);
    expect(session.isLive).toBe(false);
    expect(session.liveDate).toBeNull();
    expect(session.openDate).toBe(SUNDAY);

    env.advance(DAY);
    expect(session.openDate).toBe(NEXT_SUNDAY);
    expect(await shown()).toBeNull();
    expect((await session.frame(mediaUrl)).song).toBeNull();
  });

  it('goes live with the run sheet that is edited next', async () => {
    await session.endPresentation();
    const live = session.live;
    await session.viewDate(NEXT_SUNDAY);
    expect(session.live).toBe(live);

    await session.editRunSheet(NEXT_SUNDAY);
    expect(session.liveDate).toBe(NEXT_SUNDAY);
    expect(session.openDate).toBe(NEXT_SUNDAY);
    expect(await shown()).toBeNull();

    await session.endPresentation();
    expect(session.openDate).toBe(SUNDAY);
    const b = await song('B', 'b1');
    await session.addSong(SUNDAY, b.id);
    expect(session.liveDate).toBe(SUNDAY);
    expect(session.live?.presented).toBeNull();

    await session.endPresentation();
    const [first] = (await session.viewDate(SUNDAY)).entries;
    await session.removeItem(first!.item.id);
    expect(session.liveDate).toBe(SUNDAY);
    expect(await shown()).toBeNull();
  });

  it('can go live again afterwards', async () => {
    await session.endPresentation();
    await session.goLive(SUNDAY);
    expect(session.isLive).toBe(true);
    expect(session.live?.presented).toBeNull();
    await session.next();
    expect(await shown()).toEqual(['a1']);
  });

  it('offers to end once the live date has passed, and never ends by itself', async () => {
    expect(session.keptTooLong).toBe(false);
    env.advance(DAY);
    await session.heartbeat();
    expect(session.keptTooLong).toBe(true);
    expect(session.isLive).toBe(true);
    expect(await shown()).toEqual(['a1']);

    expect(await session.endPresentation()).toBe(NEXT_SUNDAY);
    expect(session.keptTooLong).toBe(false);
  });
});

describe('calendar safety (criterion 18)', () => {
  let a: Awaited<ReturnType<typeof song>>;
  let b: Awaited<ReturnType<typeof song>>;
  beforeEach(async () => {
    a = await song('A', 'a1\na2');
    b = await song('B', 'b1\nb2');
    await plan(SUNDAY, [a.id]);
    await plan(NEXT_SUNDAY, [b.id]);
    await reopen();
    await session.next();
  });

  it('treats other dates as read-only until Edit run sheet or Go live', async () => {
    expect(session.canEdit(SUNDAY)).toBe(true);
    expect(session.canEdit(NEXT_SUNDAY)).toBe(false);
    await expect(session.addSong(NEXT_SUNDAY, a.id)).rejects.toBeInstanceOf(ReadOnlyDateError);

    const other = await session.viewDate(NEXT_SUNDAY);
    await expect(session.removeItem(other.entries[0]!.item.id)).rejects.toBeInstanceOf(
      ReadOnlyDateError,
    );
    await expect(session.moveItem(other.entries[0]!.item.id, 0)).rejects.toBeInstanceOf(
      ReadOnlyDateError,
    );
    expect((await session.viewDate(NEXT_SUNDAY)).entries).toHaveLength(1);
  });

  it('browsing another date changes nothing', async () => {
    const live = session.live;
    await session.viewDate(NEXT_SUNDAY);
    await session.viewDate('2027-01-01');
    expect(session.live).toBe(live);
    expect(session.openDate).toBe(SUNDAY);
    expect(await store.getRunSheetByDate(session.workspace.id, '2027-01-01')).toBeNull();
  });

  it('Edit run sheet changes another date without touching the live run sheet or the output', async () => {
    const live = session.live;
    await session.editRunSheet(NEXT_SUNDAY);
    await session.addSong(NEXT_SUNDAY, a.id);

    expect(session.openDate).toBe(NEXT_SUNDAY);
    expect(session.liveDate).toBe(SUNDAY);
    expect(session.live).toBe(live);
    expect(await shown()).toEqual(['a1', 'a2']);
    expect((await session.viewDate(NEXT_SUNDAY)).entries.map((e) => e.song.title)).toEqual([
      'B',
      'A',
    ]);
    expect((await session.viewLive())!.entries.map((e) => e.song.title)).toEqual(['A']);
    // The live run sheet stays editable as well.
    expect(session.canEdit(SUNDAY)).toBe(true);
  });

  it('Go live keeps the presented piece until another is played', async () => {
    await session.setBlank(true);
    await session.setBlank(false);
    await session.goLive(NEXT_SUNDAY);

    expect(session.liveDate).toBe(NEXT_SUNDAY);
    expect(session.openDate).toBe(NEXT_SUNDAY);
    expect(await shown()).toEqual(['a1', 'a2']);
    expect(session.presentingPreviousContent).toBe(true);
    expect((await session.viewLive())!.entries.map((e) => e.song.title)).toEqual(['B']);

    await session.next();
    expect(await shown()).toEqual(['b1', 'b2']);
    expect(session.presentingPreviousContent).toBe(false);
  });

  it('Go live on a date with no plan creates an empty live run sheet', async () => {
    await session.goLive('2026-12-25');
    expect(session.liveDate).toBe('2026-12-25');
    expect((await session.viewLive())!.entries).toEqual([]);
    expect(await shown()).toEqual(['a1', 'a2']);
    await session.next();
    expect(await shown()).toEqual(['a1', 'a2']);
  });

  it('still shows the edited lyrics of previous content after Go live', async () => {
    await session.goLive(NEXT_SUNDAY);
    await session.saveSong(a.id, { lyrics: 'a1 fixed\na2' });
    expect(await shown()).toEqual(['a1 fixed', 'a2']);
  });
});

describe('meeting days (criterion 19)', () => {
  // Monday 12 October 2026.
  beforeEach(() => env.setNow('2026-10-12T09:00:00.000Z'));

  it('opens today for Any day and for Every day, keeping the two selections distinct', async () => {
    await session.setMeetingDays([]);
    await reopen();
    expect(session.openDate).toBe('2026-10-12');
    expect(session.workspace.meetingDays).toEqual([]);

    await session.setMeetingDays([0, 1, 2, 3, 4, 5, 6]);
    await reopen();
    expect(session.openDate).toBe('2026-10-12');
    expect(session.workspace.meetingDays).toHaveLength(7);
  });

  it('opens the next matching day of a subset', async () => {
    await session.setMeetingDays([3, 5]);
    await reopen();
    expect(session.openDate).toBe('2026-10-14');
  });

  it('uses the workspace timezone rather than the computer one', async () => {
    driver.close();
    ({ driver, env, store } = await createTestStore(
      undefined,
      createTestEnv('2026-10-10T20:00:00.000Z'),
    ));
    ({ session } = await Session.open(store, { now: () => env.date() }, 'Asia/Shanghai'));
    // Saturday evening UTC is already Sunday in Shanghai.
    expect(session.today()).toBe(SUNDAY);
    expect(session.openDate).toBe(SUNDAY);
    // A later launch elsewhere does not change the workspace timezone.
    ({ session } = await Session.open(store, { now: () => env.date() }, 'America/Los_Angeles'));
    expect(session.today()).toBe(SUNDAY);
  });
});

describe('copying between dates (criterion 20)', () => {
  let a: Awaited<ReturnType<typeof song>>;
  let b: Awaited<ReturnType<typeof song>>;
  const titles = async (date: string) =>
    (await session.viewDate(date)).entries.map((e) => e.song.title);

  beforeEach(async () => {
    a = await song('A', 'a1');
    b = await song('B', 'b1');
    await plan(LAST_SUNDAY, [a.id, b.id]);
    await session.editRunSheet(NEXT_SUNDAY);
  });

  it('copies straight into an empty run sheet', async () => {
    expect(await session.copyFrom(LAST_SUNDAY)).toEqual({ status: 'copied', count: 2 });
    expect(await titles(NEXT_SUNDAY)).toEqual(['A', 'B']);
  });

  it('asks for Append or Replace when the target has items', async () => {
    await session.addSong(NEXT_SUNDAY, b.id);
    expect(await session.copyFrom(LAST_SUNDAY)).toEqual({ status: 'choose' });
    expect(await titles(NEXT_SUNDAY)).toEqual(['B']);
  });

  it('appends', async () => {
    await session.addSong(NEXT_SUNDAY, b.id);
    await session.copyFrom(LAST_SUNDAY, 'append');
    expect(await titles(NEXT_SUNDAY)).toEqual(['B', 'A', 'B']);
  });

  it('replaces', async () => {
    await session.addSong(NEXT_SUNDAY, b.id);
    await session.addSong(NEXT_SUNDAY, b.id);
    await session.copyFrom(LAST_SUNDAY, 'replace');
    expect(await titles(NEXT_SUNDAY)).toEqual(['A', 'B']);
  });

  it('never changes the source date or duplicates songs', async () => {
    const source = await session.viewDate(LAST_SUNDAY);
    await session.copyFrom(LAST_SUNDAY);
    const copied = await session.viewDate(NEXT_SUNDAY);
    await session.removeItem(copied.entries[0]!.item.id);
    await session.saveSong(a.id, { title: 'A renamed' });

    const after = await session.viewDate(LAST_SUNDAY);
    expect(after.runSheet).toEqual(source.runSheet);
    expect(after.entries.map((e) => e.item)).toEqual(source.entries.map((e) => e.item));
    expect(await store.listSongs(session.workspace.id)).toHaveLength(2);
    // Both dates point at the same song record.
    expect(after.entries[0]!.song.title).toBe('A renamed');
  });

  it('copies into the live run sheet without changing the screen', async () => {
    await session.goLive(SUNDAY);
    await session.addSong(SUNDAY, b.id);
    await session.next();
    await session.copyFrom(LAST_SUNDAY, 'replace');
    expect(await titles(SUNDAY)).toEqual(['A', 'B']);
    expect(await shown()).toEqual(['b1']);
  });

  it('has nothing to copy from an empty date or from the open date itself', async () => {
    expect(await session.copyFrom('2026-01-01')).toEqual({ status: 'nothing-to-copy' });
    expect(await session.copyFrom(NEXT_SUNDAY)).toEqual({ status: 'nothing-to-copy' });
  });
});

describe('live lyrics editing (criterion 7)', () => {
  let a: Awaited<ReturnType<typeof song>>;
  beforeEach(async () => {
    a = await song('A', 'a1\na2\n\na3\na4\n\na5\na6');
    await plan(SUNDAY, [a.id]);
    await reopen();
    await playAt(0, 1); // a3 + a4
  });

  it('shows a fix to the presented piece as soon as it is saved', async () => {
    await session.saveSong(a.id, { lyrics: 'a1\na2\n\na3\na4 fixed\n\na5\na6' });
    expect(await shown()).toEqual(['a3', 'a4 fixed']);
  });

  it('does not move when a later piece is edited', async () => {
    const before = session.live;
    await session.saveSong(a.id, { lyrics: 'a1\na2\n\na3\na4\n\na5 changed\na6\na7' });
    expect(session.live).toBe(before);
    expect(await shown()).toEqual(['a3', 'a4']);
  });

  it('stays on the same lyrics when a line is added above the presented piece', async () => {
    await session.saveSong(a.id, { lyrics: 'a1\na2\nadded\n\na3\na4\n\na5\na6' });
    expect(await shown()).toEqual(['a3', 'a4']);
    await session.previous();
    expect(await shown()).toEqual(['added']);
  });

  it('stays on the same lyrics when a whole block is added above', async () => {
    await session.saveSong(a.id, { lyrics: 'new1\nnew2\n\na1\na2\n\na3\na4\n\na5\na6' });
    expect(await shown()).toEqual(['a3', 'a4']);
    expect(session.live?.presented?.index).toBe(1); // only a hint; next still works
    await session.next();
    expect(await shown()).toEqual(['a5', 'a6']);
  });

  it('clears the output when the presented piece is deleted, without leaving live mode', async () => {
    await session.saveSong(a.id, { lyrics: 'a1\na2\n\na5\na6' });
    expect(await shown()).toBeNull();
    expect(session.isLive).toBe(true);
    await playAt(0, 1);
    expect(await shown()).toEqual(['a5', 'a6']);
  });

  it('saves the edit as a song revision', async () => {
    await session.saveSong(a.id, { lyrics: 'a1' });
    expect(await store.listSongRevisions(a.id)).toHaveLength(2);
  });

  it('survives a restart after an edit', async () => {
    await session.saveSong(a.id, { lyrics: 'intro\n\na1\na2\n\na3\na4!' });
    await reopen();
    expect(await shown()).toEqual(['a3', 'a4!']);
  });

  it('follows the first presented line when lines per piece changes', async () => {
    await session.updatePresentationSettings({ linesPerPiece: 1 });
    expect(await shown()).toEqual(['a3']);
    await session.updatePresentationSettings({ linesPerPiece: 4 });
    expect(await shown()).toEqual(['a3', 'a4']);
    await session.updatePresentationSettings({ linesPerPiece: 2 });
    expect(await shown()).toEqual(['a3', 'a4']);
  });
});

describe('removing a song', () => {
  it('keeps run-sheet items presentable from the last saved lyrics', async () => {
    const a = await song('A', 'a1');
    await plan(SUNDAY, [a.id]);
    await reopen();
    await session.next();
    await session.removeSong(a.id);

    expect(await store.listSongs(session.workspace.id)).toEqual([]);
    const view = (await session.viewLive())!;
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]!.song.removedAt).not.toBeNull();
    expect(await shown()).toEqual(['a1']);
  });
});

describe('output frame', () => {
  let frame: OutputFrame;
  beforeEach(async () => {
    const a = await song('A', 'a1\na2\n\na3');
    await plan(SUNDAY, [a.id]);
    await reopen();
    await session.next();
  });

  it('carries the whole song so one size can be fitted for it', async () => {
    frame = await session.frame(mediaUrl);
    expect(frame.song?.pieces.map((p) => p.lines)).toEqual([['a1', 'a2'], ['a3']]);
    expect(frame.pieceId).toBe(frame.song?.pieces[0]!.id);
  });

  it('reflects setting changes immediately', async () => {
    await session.updatePresentationSettings({ wrapLongLines: false });
    await session.updateOutputProfile({
      fontFamily: 'Georgia',
      scale: 0.75,
      backgroundColor: '#123456',
    });
    frame = await session.frame(mediaUrl);
    expect(frame).toMatchObject({
      wrap: false,
      fontFamily: 'Georgia',
      scale: 0.75,
      background: { color: '#123456', media: null },
    });
  });

  it('uses the selected background and falls back to the color when it is removed', async () => {
    await session.addBackground({
      id: 'bg',
      kind: 'video',
      fileName: 'bg.mp4',
      originalName: 'Loop.mp4',
    });
    await session.updateOutputProfile({ backgroundAssetId: 'bg', backgroundColor: '#222222' });
    frame = await session.frame(mediaUrl);
    expect(frame.background).toEqual({
      color: '#222222',
      media: { kind: 'video', url: 'media://bg.mp4' },
    });

    await session.removeBackground('bg');
    frame = await session.frame(mediaUrl);
    expect(frame.background).toEqual({ color: '#222222', media: null });
  });

  it('falls back to the color when the selected background no longer exists', async () => {
    await session.updateOutputProfile({ backgroundAssetId: 'never-imported' });
    expect((await session.frame(mediaUrl)).background.media).toBeNull();
  });

  it("uses the presented song's own background in place of the slideshow's", async () => {
    await session.addBackground({
      id: 'bg',
      kind: 'image',
      fileName: 'bg.png',
      originalName: 'Sky.png',
    });
    await session.updateOutputProfile({ backgroundAssetId: 'bg', backgroundColor: '#222222' });
    const songId = session.live!.presented!.songId;
    await session.saveSong(songId, { background: { color: '#336699', assetId: null } });
    frame = await session.frame(mediaUrl);
    expect(frame.background).toEqual({ color: '#336699', media: null });

    // Blanking keeps the song's background on screen.
    await session.setBlank(true);
    expect((await session.frame(mediaUrl)).background.color).toBe('#336699');

    await session.saveSong(songId, { background: null });
    frame = await session.frame(mediaUrl);
    expect(frame.background).toEqual({
      color: '#222222',
      media: { kind: 'image', url: 'media://bg.png' },
    });
  });

  it("shows the workspace's chosen song background over the one the song carries", async () => {
    await session.updateOutputProfile({ backgroundColor: '#222222' });
    const songId = session.live!.presented!.songId;
    await session.saveSong(songId, { background: { color: '#336699', assetId: null } });
    const revision = (await session.store.getSong(songId))!.revision;

    await session.setSongBackground(songId, { color: '#aa0000', assetId: null });
    expect((await session.frame(mediaUrl)).background.color).toBe('#aa0000');
    expect((await session.buildSnapshot('A'))?.presented?.background).toEqual({
      color: '#aa0000',
      assetId: null,
    });
    // A setting, not an edit of the song.
    expect((await session.store.getSong(songId))!.revision).toBe(revision);

    await session.setSongBackground(songId, null);
    expect((await session.frame(mediaUrl)).background.color).toBe('#222222');
    expect((await session.buildSnapshot('A'))?.presented?.background).toBeNull();
  });
});

describe('imported slide decks', () => {
  const deck = {
    source: 'Sermon.pptx',
    width: 1440,
    height: 1080,
    pages: [
      { image: 'deck-a-001.jpg', slide: 1, step: 0, text: ['Title'] },
      { image: 'deck-a-002.jpg', slide: 2, step: 0, text: ['Point one'] },
      { image: 'deck-a-003.jpg', slide: 2, step: 1, text: ['Point one', 'Point two'] },
      { image: 'deck-a-004.jpg', slide: 4, step: 0, text: [] },
    ],
  };

  it('has one piece per image, each slide counting as a block', async () => {
    const pieces = songPieces({ lyrics: '', lineIds: [], deck, website: null }, 2);
    expect(pieces.map((p) => [p.id, p.blockIndex, p.indexInBlock, p.image])).toEqual([
      ['deck-a-001.jpg', 0, 0, 'deck-a-001.jpg'],
      ['deck-a-002.jpg', 1, 0, 'deck-a-002.jpg'],
      ['deck-a-003.jpg', 1, 1, 'deck-a-003.jpg'],
      // Slide 3 was hidden; slide 4 still takes the next block.
      ['deck-a-004.jpg', 2, 0, 'deck-a-004.jpg'],
    ]);
    expect(pieces[2]!.lines.map((l) => l.text)).toEqual(['Point one', 'Point two']);
  });

  it('presents each image whole on black, with nothing in the subtitle overlay', async () => {
    const created = await session.createSong({ title: 'Sermon', lyrics: 'Title', deck });
    await session.addSong(session.openDate, created.id);
    await session.goLive(session.openDate);
    await session.next();
    let frame = await session.frame(mediaUrl);
    expect(frame.picture).toEqual({ url: 'media://deck-a-001.jpg' });
    expect(frame.song).toBeNull();
    expect(frame.background).toEqual({ color: '#000000', media: null });

    await session.next();
    await session.next();
    frame = await session.frame(mediaUrl);
    expect(frame.picture?.url).toBe('media://deck-a-003.jpg');
    expect(frame.pieceId).toBe('deck-a-003.jpg');
    expect((await session.frame(mediaUrl, 'subtitle')).picture).toBeNull();

    await session.setBlank(true);
    expect((await session.frame(mediaUrl)).picture).toBeNull();
  });

  it('clears the subtitles when a slide follows a song', async () => {
    const hymn = await song('Hymn', 'one\ntwo');
    const created = await session.createSong({ title: 'Sermon', lyrics: 'Title', deck });
    await session.addSong(session.openDate, hymn.id);
    await session.addSong(session.openDate, created.id);
    await session.goLive(session.openDate);
    await session.next();
    let subtitle = await session.frame(mediaUrl, 'subtitle');
    expect(subtitle.song?.pieces.find((p) => p.id === subtitle.pieceId)?.lines).toEqual([
      'one',
      'two',
    ]);
    await session.next();
    subtitle = await session.frame(mediaUrl, 'subtitle');
    expect(subtitle).toMatchObject({ song: null, picture: null });
    expect(subtitle.song?.pieces.find((p) => p.id === subtitle.pieceId)).toBeUndefined();
  });

  it('still presents a deck removed from the library from the run sheets that use it', async () => {
    const created = await session.createSong({ title: 'Sermon', lyrics: 'Title', deck });
    await session.addSong(session.openDate, created.id);
    await session.removeSong(created.id);
    expect(await store.listSongs(session.workspace.id)).toEqual([]);
    const view = await session.viewDate(session.openDate);
    expect(view.entries[0]!.song.removedAt).not.toBeNull();
    expect(view.entries[0]!.pieces).toHaveLength(4);
    await session.goLive(session.openDate);
    await session.next();
    expect((await session.frame(mediaUrl)).picture?.url).toBe('media://deck-a-001.jpg');
  });

  it('keeps the deck through edits and in the song’s history', async () => {
    const created = await session.createSong({ title: 'Sermon', lyrics: 'Title', deck });
    const saved = await session.saveSong(created.id, { title: 'Sunday sermon' });
    expect(saved.deck).toEqual(deck);
    expect((await store.getSong(created.id))!.deck).toEqual(deck);
    const history = await store.listSongRevisions(created.id);
    expect(history.map((r) => r.deck?.pages.length)).toEqual([4, 4]);
  });
});

describe('websites', () => {
  const website = { url: 'https://example.org/live' };

  it('has one piece, named by its address', () => {
    const pieces = songPieces({ lyrics: '', lineIds: [], deck: null, website }, 2);
    expect(pieces).toEqual([
      {
        id: WEBSITE_PIECE_ID,
        blockIndex: 0,
        indexInBlock: 0,
        lines: [{ id: `${WEBSITE_PIECE_ID}:0`, text: 'https://example.org/live' }],
      },
    ]);
  });

  it('shows the page on the slideshow only, and not while blank', async () => {
    const created = await session.createSong({ title: 'Live stream', website });
    await session.addSong(session.openDate, created.id);
    await session.goLive(session.openDate);
    await session.next();
    let frame = await session.frame(mediaUrl);
    expect(frame).toMatchObject({
      website,
      song: null,
      picture: null,
      pieceId: WEBSITE_PIECE_ID,
      background: { color: '#000000', media: null },
    });
    expect((await session.frame(mediaUrl, 'subtitle')).website).toBeNull();

    await session.setBlank(true);
    expect((await session.frame(mediaUrl)).website).toBeNull();
    await session.setBlank(false);
    await session.clear();
    frame = await session.frame(mediaUrl);
    expect(frame.website).toBeNull();
  });

  it('keeps the website through edits and in the song’s history', async () => {
    const created = await session.createSong({ title: 'Live stream', website });
    const moved = { url: 'https://example.org/stream' };
    const saved = await session.saveSong(created.id, { website: moved });
    expect(saved.website).toEqual(moved);
    expect((await store.getSong(created.id))!.website).toEqual(moved);
    const history = await store.listSongRevisions(created.id);
    expect(history.map((r) => r.website?.url)).toEqual([website.url, moved.url]);
  });
});

describe('video items (media uploads M5.4, M6.1)', () => {
  const video = {
    file: 'video-0f8fad5b-d9cb-469f-a165-70867728950e.mp4',
    source: 'Welcome.mp4',
    width: 1920,
    height: 1080,
    durationSeconds: 90,
    bytes: 1000,
    autoplay: false,
  };

  async function presentVideo(fields: Partial<typeof video> = {}) {
    const created = await session.createSong({ title: 'Welcome', video: { ...video, ...fields } });
    const hymn = await song('Hymn', 'h1');
    await session.addSong(session.openDate, created.id);
    await session.addSong(session.openDate, hymn.id);
    await session.goLive(session.openDate);
    await session.next();
    return created;
  }

  it('has one piece, and is a video in the snapshot with its title and duration', async () => {
    expect(songPieces({ lyrics: '', lineIds: [], deck: null, website: null, video }, 2)).toEqual([
      { id: VIDEO_PIECE_ID, blockIndex: 0, indexInBlock: 0, lines: [] },
    ]);
    await presentVideo();
    const [item] = await session.snapshotItems();
    expect(item).toMatchObject({
      kind: 'video',
      title: 'Welcome',
      pieces: [{ id: VIDEO_PIECE_ID, lines: ['1:30'], video: { file: video.file } }],
    });
  });

  it('plays on the slideshow on black, never on the subtitle overlay, hidden while blank', async () => {
    await presentVideo();
    const frame = await session.frame(mediaUrl);
    expect(frame).toMatchObject({
      song: null,
      picture: null,
      pieceId: VIDEO_PIECE_ID,
      background: { color: '#000000', media: null },
      video: { url: `media://${video.file}`, playing: false, position: 0, durationSeconds: 90 },
    });
    const subtitle = await session.frame(mediaUrl, 'subtitle');
    expect(subtitle.video ?? null).toBeNull();
    expect(subtitle.song).toBeNull();
    await session.setBlank(true);
    expect((await session.frame(mediaUrl)).blank).toBe(true);
  });

  it('plays, pauses and moves through the presented video', async () => {
    await presentVideo();
    await session.videoPlay(true);
    expect(session.video).toMatchObject({ playing: true, position: 0 });
    env.advance(20_000);
    await session.videoSeek({ by: 10 });
    expect(session.video!.position).toBe(30);
    await session.videoPlay(false);
    expect(session.video).toMatchObject({ playing: false });
    await session.videoSeek({ seconds: 5 });
    expect(session.video!.position).toBe(5);
  });

  it('starts playing on entry with Autoplay', async () => {
    await presentVideo({ autoplay: true });
    expect(session.video).toMatchObject({ playing: true });
  });

  it('remembers where it was left, and forgets it when the item is removed', async () => {
    await presentVideo();
    await session.videoSeek({ seconds: 42 });
    await session.next();
    expect(session.live!.videoPositions).toEqual({
      [(await session.viewLive())!.entries[0]!.item.id]: 42,
    });
    const item = (await session.viewLive())!.entries[0]!.item;
    await session.removeItem(item.id);
    expect(session.live!.videoPositions).toEqual({});
  });

  it.each([
    ['ahead', 5000],
    ['behind', -5000],
  ])(
    'puts a follower whose clock is 5 s %s on the coordinator’s video clock',
    async (_name, skew) => {
      await presentVideo();
      const snapshotOf = async (revision: number) => ({
        ...(await session.buildSnapshot('A'))!,
        revision,
      });
      const first = await snapshotOf(1);
      const follower = (
        await Session.open(store, { now: () => new Date(env.date().getTime() + skew) }, 'UTC')
      ).session;
      follower.follow({ send: () => undefined });
      await follower.applySnapshot(first);
      env.advance(1000);
      await session.videoPlay(true);
      const playing = await snapshotOf(2);
      // Delivered 40 ms later.
      env.advance(40);
      await follower.applySnapshot(playing);
      env.advance(10_000);
      const now = new Date(env.date().getTime() + skew).toISOString();
      const frame = await follower.frame(mediaUrl);
      const position =
        frame.video!.position + (Date.parse(now) - Date.parse(frame.video!.at)) / 1000;
      // The coordinator's video is 10.04 s in; the follower is within half a second of it.
      expect(Math.abs(position - 10.04)).toBeLessThan(0.5);
    },
  );

  it('forgets where a video was left when a new version replaces its file (U26)', async () => {
    const created = await presentVideo();
    await session.videoSeek({ seconds: 42 });
    await session.next();
    expect(Object.values(session.live!.videoPositions)).toEqual([42]);
    await session.saveSong(created.id, {
      video: { ...video, file: 'video-1f8fad5b-d9cb-469f-a165-70867728950e.mp4' },
    });
    expect(session.live!.videoPositions).toEqual({});
  });

  it('sends video commands to the coordinator from a follower', async () => {
    await presentVideo();
    const sent: unknown[] = [];
    session.follow({ send: (command) => sent.push(command) });
    await session.videoPlay(true);
    expect(sent).toEqual([{ type: 'videoPlay', itemId: session.live!.presented!.itemId }]);
  });
});

describe('Bible passages (P5.1, P6.1, P6.2, P6.5, P7.2)', () => {
  const text = (
    version: string,
    credit: string,
    verses: [number, string][],
    token: string | null = null,
  ) => ({
    version,
    credit,
    provider: (token ? 'apibible' : 'youversion') as 'apibible' | 'youversion',
    copyright: '©',
    units: verses.map(([verse, words]) => ({
      chapter: 15,
      verses: [verse],
      label: String(verse),
      lines: [{ text: words, indent: 0 }],
    })),
    fumsToken: token,
  });
  const mark: Passage = {
    reference: 'MRK.15.5-MRK.15.6',
    texts: [
      text('NIVUK', 'NIVUK', [
        [5, 'But Jesus still made no reply.'],
        [6, 'Now it was the custom at the festival.'],
      ]),
      text('CCB', '当代译本', [
        [5, '耶稣仍不回答。'],
        [6, '每逢这节期，巡抚释放一个囚犯。'],
      ]),
    ],
  };
  let a: Awaited<ReturnType<typeof song>>;
  let b: Awaited<ReturnType<typeof song>>;
  beforeEach(async () => {
    a = await song('A', 'a1\na2');
    b = await song('B', 'b1');
    await plan(SUNDAY, [a.id, b.id]);
    await reopen();
  });
  const titles = async () => (await session.viewDate(SUNDAY)).entries.map((e) => e.song.title);

  it('makes the passage a run sheet item titled by its reference', async () => {
    const item = await session.addPassage(SUNDAY, mark);
    const entry = (await session.viewDate(SUNDAY)).entries.find((e) => e.item.id === item!.id)!;
    expect(entry.song.title).toBe('Mark 15:5–6');
    expect(entry.song.passage).toEqual(mark);
    expect(entry.song.lyrics).toBe(
      '5 But Jesus still made no reply.\n\n6 Now it was the custom at the festival.',
    );
    expect(songKind(entry.song)).toBe('passage');
    // Kept out of the library (B7).
    expect((await store.listSongs(session.workspace.id)).map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('titles a passage in its first version’s language', () => {
    expect(passageSongFields({ ...mark, texts: [mark.texts[1]!, mark.texts[0]!] }).title).toBe(
      '马可福音 15:5-6',
    );
  });

  it('goes right after the item being presented, and Add leaves the screen as it is', async () => {
    await playAt(0, 0);
    const before = session.live!.presented;
    await session.addPassage(SUNDAY, mark);
    expect(await titles()).toEqual(['A', 'Mark 15:5–6', 'B']);
    expect(session.live!.presented).toEqual(before);
    expect(await shown()).toEqual(['a1', 'a2']);
  });

  it('goes at the end when nothing is presented', async () => {
    await session.addPassage(SUNDAY, mark);
    expect(await titles()).toEqual(['A', 'B', 'Mark 15:5–6']);
    await playAt(0, 0);
    await session.clear();
    await session.addPassage(SUNDAY, mark);
    expect(await titles()).toEqual(['A', 'B', 'Mark 15:5–6', 'Mark 15:5–6']);
  });

  it('goes at the end when the presented item has been removed', async () => {
    await playAt(0, 0);
    await session.removeItem((await session.viewDate(SUNDAY)).entries[0]!.item.id);
    await session.addPassage(SUNDAY, mark);
    expect(await titles()).toEqual(['B', 'Mark 15:5–6']);
  });

  it('presents its first slide with Present', async () => {
    await playAt(1, 0);
    const item = await session.addPassage(SUNDAY, mark, { present: true });
    expect(session.live!.presented).toMatchObject({ itemId: item!.id, pieceId: 'v15:5' });
    expect(await titles()).toEqual(['A', 'B', 'Mark 15:5–6']);
  });

  it('adds at the end in the calendar, presenting nothing', async () => {
    await session.editRunSheet(NEXT_SUNDAY);
    await playAt(0, 0);
    const before = session.live!.presented;
    await session.addPassage(NEXT_SUNDAY, mark, { present: true });
    expect((await session.viewDate(NEXT_SUNDAY)).entries.map((e) => e.song.title)).toEqual([
      'Mark 15:5–6',
    ]);
    expect(session.live!.presented).toEqual(before);
  });

  it('is sent to the coordinator from a follower', async () => {
    const sent: unknown[] = [];
    session.follow({ send: (command) => sent.push(command) });
    expect(await session.addPassage(SUNDAY, mark, { present: true })).toBeNull();
    await session.addPassage(SUNDAY, mark, { afterItemId: null });
    expect(sent).toEqual([
      { type: 'addPassage', passage: mark, present: true },
      { type: 'addPassage', passage: mark, afterItemId: null },
    ]);
  });

  it('from a phone or a follower, lands after the presented item on the coordinator (B15)', async () => {
    await playAt(0, 0);
    const change = await session.remotePassage('c1', { type: 'addPassage', passage: mark });
    expect(change).toMatchObject({ kind: 'added', title: 'Mark 15:5–6' });
    expect(await titles()).toEqual(['A', 'Mark 15:5–6', 'B']);
    // The same command again is applied once.
    expect(await session.remotePassage('c1', { type: 'addPassage', passage: mark })).toBeNull();
    const outcome = await session.applyOperatorCommand(
      'c2',
      { type: 'addPassage', passage: mark, present: true },
      { kind: 'phone', grantId: 'g', name: 'Phone' },
    );
    expect(outcome.result).toBe('applied');
    expect(session.live!.presented!.pieceId).toBe('v15:5');
    expect(await titles()).toEqual(['A', 'Mark 15:5–6', 'Mark 15:5–6', 'B']);
  });

  it('is refused from a phone while nothing is live', async () => {
    await session.endPresentation();
    expect(await session.remotePassage('c1', { type: 'addPassage', passage: mark })).toBeNull();
  });

  it('puts a long passage’s slides in one block, never shaded in turn', async () => {
    const long: Passage = {
      reference: 'MRK.15.1-MRK.15.12',
      texts: [
        text(
          'NIVUK',
          'NIVUK',
          Array.from({ length: 12 }, (_, i) => [i + 1, 'x'.repeat(50)] as [number, string]),
        ),
      ],
    };
    const item = await session.addPassage(SUNDAY, long);
    const entry = (await session.viewDate(SUNDAY)).entries.find((e) => e.item.id === item!.id)!;
    expect(entry.pieces.length).toBeGreaterThan(1);
    expect(entry.pieces.map((p) => p.blockIndex)).toEqual(entry.pieces.map(() => 0));
    expect(entry.pieces.map((p) => p.indexInBlock)).toEqual(entry.pieces.map((_, i) => i));
  });

  it('gives the same slides from the database and from a snapshot, ids kept when saved again', async () => {
    const item = await session.addPassage(SUNDAY, mark, { present: true });
    const entry = (await session.viewLive())!.entries.find((e) => e.item.id === item!.id)!;
    expect(entry.pieces.map((p) => p.id)).toEqual(['v15:5']);
    const snapshot = (await session.buildSnapshot('A'))!;
    const carried = snapshot.items.find((i) => i.itemId === item!.id)!;
    expect(carried.kind).toBe('passage');
    expect(carried.badge).toBe('bible');
    expect(carried.pieces.map((p) => p.id)).toEqual(entry.pieces.map((p) => p.id));
    expect(carried.pieces[0]!.passage!.columns.map((c) => c.credit)).toEqual(['NIVUK', '当代译本']);
    // Every slide in one block, so none is shaded as a song's second verse would be.
    expect(carried.pieces.every((piece) => piece.block === 0)).toBe(true);
    expect(carried.pieces[0]!.lines).toEqual([
      '5 But Jesus still made no reply.',
      '6 Now it was the custom at the festival.',
    ]);
    // Saved again unchanged: the same slide stays live.
    await session.savePassage(entry.song.id, JSON.parse(JSON.stringify(mark)) as Passage);
    expect(session.live!.presented!.pieceId).toBe('v15:5');
    expect(
      songPieces({ ...entry.song, passage: JSON.parse(JSON.stringify(mark)) }, 2).map((p) => p.id),
    ).toEqual(['v15:5']);
  });

  it('draws the slide side by side on the slideshow, and nothing on the subtitle overlay (B12)', async () => {
    await session.addPassage(SUNDAY, mark, { present: true });
    const slideshow = await session.frame(mediaUrl);
    expect(slideshow.passage!.columns.map((c) => c.version)).toEqual(['NIVUK', 'CCB']);
    // The whole passage's reference, not the slide's verses.
    expect(slideshow.passage!.headers).toEqual(['Mark 15:5–6', '马可福音 15:5-6']);
    expect(slideshow.pieceId).toBe('v15:5');
    expect(slideshow.song).toBeNull();
    const subtitle = await session.frame(mediaUrl, 'subtitle');
    expect(subtitle.passage ?? null).toBeNull();
    expect(subtitle.song).toBeNull();
    await session.setBlank(true);
    expect((await session.frame(mediaUrl)).passage ?? null).toBeNull();
  });

  it('is shown on black until a Bible background is chosen', async () => {
    await session.updateOutputProfile({ backgroundColor: '#336699' });
    await session.addPassage(SUNDAY, mark, { present: true });
    expect((await session.frame(mediaUrl)).background.color).toBe('#000000');
    await session.setBibleBackground(null);
    expect((await session.frame(mediaUrl)).background.color).toBe('#336699');
  });

  it('is shown on the workspace’s Bible background, apart from songs’ backgrounds', async () => {
    await session.setSongBackground(a.id, { color: '#ff0000', assetId: null });
    await session.setBibleBackground({ color: '#102040', assetId: null });
    await session.addPassage(SUNDAY, mark, { present: true });
    expect((await session.frame(mediaUrl)).background.color).toBe('#102040');
    // Followers and browser outputs get it with the snapshot.
    expect((await session.buildSnapshot('A'))!.presented!.background).toEqual({
      color: '#102040',
      assetId: null,
    });
    await playAt(0, 0);
    expect((await session.frame(mediaUrl)).background.color).toBe('#ff0000');
  });

  it('draws a passage a follower does not have yet from the snapshot', async () => {
    await session.addPassage(SUNDAY, mark, { present: true });
    const snapshot = { ...(await session.buildSnapshot('A'))!, revision: 1 };
    const other = await createTestStore(undefined, createTestEnv('2026-10-11T09:00:00.000Z'));
    const follower = (await Session.open(other.store, { now: () => env.date() }, 'UTC')).session;
    follower.follow({ send: () => undefined });
    await follower.applySnapshot(snapshot);
    const frame = await follower.frame(mediaUrl);
    expect(frame.passage!.columns[1]!.units[0]!.lines[0]!.text).toBe('耶稣仍不回答。');
    expect((await follower.frame(mediaUrl, 'subtitle')).song).toBeNull();
    other.driver.close();
  });

  it('follows an edit to the passage in place, keeping the item’s position (B11)', async () => {
    const item = await session.addPassage(SUNDAY, mark);
    const songId = (await session.viewDate(SUNDAY)).entries.find((e) => e.item.id === item!.id)!
      .song.id;
    const changed: Passage = {
      reference: 'MRK.15.5',
      texts: [text('ESV', 'ESV', [[5, 'But Jesus made no further answer.']])],
    };
    const saved = await session.savePassage(songId, changed);
    expect(saved.title).toBe('Mark 15:5');
    expect(saved.revision).toBe(2);
    expect(await titles()).toEqual(['A', 'B', 'Mark 15:5']);
  });

  describe('usage reporting (B25)', () => {
    const tokened: Passage = {
      ...mark,
      texts: [
        text(
          'NIVUK',
          'NIVUK',
          [
            [5, 'But Jesus'],
            [6, 'Now'],
          ],
          'TOKEN-1',
        ),
        mark.texts[1]!,
      ],
    };
    let reports: [string[], string][];
    beforeEach(async () => {
      reports = [];
      ({ session } = await Session.open(store, { now: () => env.date() }, 'UTC', {
        reportUsage: (tokens, live) => reports.push([tokens, live]),
      }));
    });

    it('reports a passage’s tokens once per item per live session', async () => {
      const item = await session.addPassage(SUNDAY, tokened, { present: true });
      await playAt(0, 0);
      await session.play(item!.id, 'v15:5');
      expect(reports).toEqual([[['TOKEN-1'], `live-${Date.parse(session.live!.startedAt)}`]]);
    });

    it('reports nothing for a passage from other providers, or a song', async () => {
      await session.addPassage(SUNDAY, mark, { present: true });
      await playAt(0, 0);
      expect(reports).toEqual([]);
    });

    it('never reports from a follower', async () => {
      const item = await session.addPassage(SUNDAY, tokened);
      session.follow({ send: () => undefined });
      await session.play(item!.id, 'v15:5');
      expect(reports).toEqual([]);
    });
  });
});
