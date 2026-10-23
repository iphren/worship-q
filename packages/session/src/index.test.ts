import { DEFAULT_EXPIRY_MS } from '@worship-q/live-state';
import type { BackgroundAsset, OutputFrame } from '@worship-q/protocol';
import { Store } from '@worship-q/store';
import {
  createTestEnv,
  createTestStore,
  type NodeDriver,
  type TestEnv,
} from '@worship-q/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReadOnlyDateError, Session, type StartKind } from './index';

// The clock starts on Sunday 11 October 2026, 09:00 in the workspace timezone (UTC).
const SUNDAY = '2026-10-11';
const NEXT_SUNDAY = '2026-10-18';
const LAST_SUNDAY = '2026-10-04';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const mediaUrl = (asset: BackgroundAsset) => `media://${asset.fileName}`;

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
});
