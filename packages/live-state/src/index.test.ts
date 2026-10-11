import { assignLineIds, buildPieces } from '@worship-q/lyrics';
import { LiveStateSchema } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  COMMAND_MEMORY,
  createLiveState,
  DEFAULT_EXPIRY_MS,
  isExpired,
  isKeptTooLong,
  isPresentingPreviousContent,
  relocatePresented,
  resolveStart,
  touch,
  type Command,
  type CommandInput,
  type LiveState,
  type PlayablePiece,
} from './index';

const T0 = '2026-10-11T09:00:00.000Z';
const later = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

const SEQUENCE: PlayablePiece[] = [
  { itemId: 'i1', songId: 's1', pieceId: 'a' },
  { itemId: 'i1', songId: 's1', pieceId: 'b' },
  { itemId: 'i2', songId: 's2', pieceId: 'c' },
  // The same song again, as its own item.
  { itemId: 'i3', songId: 's1', pieceId: 'a' },
];

let commandCount = 0;
function run(
  state: LiveState,
  command: CommandInput & { id?: string },
  sequence: readonly PlayablePiece[] = SEQUENCE,
  now = T0,
) {
  const full = { id: `c${++commandCount}`, ...command } as Command;
  return applyCommand(state, full, { now, sequence });
}
const apply = (...args: Parameters<typeof run>) => run(...args).state;

describe('createLiveState', () => {
  it('starts live with nothing presented', () => {
    const state = createLiveState('rs1', T0);
    expect(state).toMatchObject({
      status: 'live',
      runSheetId: 'rs1',
      presented: null,
      blank: false,
    });
    expect(() => LiveStateSchema.parse(state)).not.toThrow();
  });
});

describe('playing pieces', () => {
  it('presents any piece of the live run sheet', () => {
    const state = apply(createLiveState('rs1', T0), {
      type: 'playPiece',
      itemId: 'i2',
      pieceId: 'c',
    });
    expect(state.presented).toEqual({
      runSheetId: 'rs1',
      itemId: 'i2',
      songId: 's2',
      pieceId: 'c',
      index: 2,
    });
  });

  it('tells a repeated song apart by its run-sheet item', () => {
    const state = apply(createLiveState('rs1', T0), {
      type: 'playPiece',
      itemId: 'i3',
      pieceId: 'a',
    });
    expect(state.presented?.index).toBe(3);
  });

  it('rejects a piece that is not in the live run sheet', () => {
    const start = createLiveState('rs1', T0);
    const outcome = run(start, { type: 'playPiece', itemId: 'nope', pieceId: 'a' });
    expect(outcome).toMatchObject({ result: 'rejected', reason: 'unknown-piece' });
    expect(outcome.state).toBe(start);
  });

  it('moves next and previous through the run sheet and stops at both ends', () => {
    let state = createLiveState('rs1', T0);
    state = apply(state, { type: 'previous' });
    expect(state.presented).toBeNull();

    const visited: number[] = [];
    for (let i = 0; i < 6; i++) {
      state = apply(state, { type: 'next' });
      visited.push(state.presented!.index);
    }
    expect(visited).toEqual([0, 1, 2, 3, 3, 3]);

    for (let i = 0; i < 5; i++) state = apply(state, { type: 'previous' });
    expect(state.presented!.index).toBe(0);
  });

  it('does nothing on next when the run sheet is empty', () => {
    const state = apply(createLiveState('rs1', T0), { type: 'next' }, []);
    expect(state.presented).toBeNull();
  });

  it('continues from the same place after the presented item is removed', () => {
    let state = apply(createLiveState('rs1', T0), {
      type: 'playPiece',
      itemId: 'i2',
      pieceId: 'c',
    });
    const withoutItem = SEQUENCE.filter((piece) => piece.itemId !== 'i2');

    const next = apply(state, { type: 'next' }, withoutItem);
    expect(next.presented).toMatchObject({ itemId: 'i3', pieceId: 'a' });

    state = apply(state, { type: 'previous' }, withoutItem);
    expect(state.presented).toMatchObject({ itemId: 'i1', pieceId: 'b' });
  });
});

describe('stepping within an item', () => {
  const at = (itemId: string, pieceId: string) =>
    apply(createLiveState('rs1', T0), { type: 'playPiece', itemId, pieceId });

  it('moves between the pieces of the presented item', () => {
    const second = apply(at('i1', 'a'), { type: 'nextInItem' });
    expect(second.presented).toMatchObject({ itemId: 'i1', pieceId: 'b' });
    expect(apply(second, { type: 'previousInItem' }).presented).toMatchObject({
      itemId: 'i1',
      pieceId: 'a',
    });
  });

  it('never leaves the item', () => {
    expect(apply(at('i1', 'b'), { type: 'nextInItem' }).presented).toMatchObject({
      itemId: 'i1',
      pieceId: 'b',
    });
    expect(apply(at('i2', 'c'), { type: 'previousInItem' }).presented).toMatchObject({
      itemId: 'i2',
      pieceId: 'c',
    });
  });

  it('shows the same piece again when blank, in either direction', () => {
    const down = apply(apply(at('i1', 'b'), { type: 'blank' }), { type: 'nextInItem' });
    expect(down).toMatchObject({ blank: false, presented: { itemId: 'i1', pieceId: 'b' } });
    const up = apply(apply(at('i1', 'b'), { type: 'blank' }), { type: 'previousInItem' });
    expect(up).toMatchObject({ blank: false, presented: { itemId: 'i1', pieceId: 'b' } });
    // The next press moves on as usual.
    expect(apply(up, { type: 'previousInItem' }).presented).toMatchObject({ pieceId: 'a' });
  });

  it('starts in the first item when nothing is presented', () => {
    const start = createLiveState('rs1', T0);
    expect(apply(start, { type: 'nextInItem' }).presented).toMatchObject({ pieceId: 'a' });
    expect(apply(start, { type: 'previousInItem' }).presented).toMatchObject({
      itemId: 'i1',
      pieceId: 'b',
    });
  });

  it('stays put when the presented item was removed', () => {
    const state = at('i2', 'c');
    const without = SEQUENCE.filter((piece) => piece.itemId !== 'i2');
    expect(apply(state, { type: 'nextInItem' }, without).presented).toEqual(state.presented);
  });
});

describe('moving between items', () => {
  const at = (itemId: string, pieceId: string) =>
    apply(createLiveState('rs1', T0), { type: 'playPiece', itemId, pieceId });

  it('presents the first piece of the next item', () => {
    expect(apply(at('i1', 'a'), { type: 'nextItem' }).presented).toMatchObject({
      itemId: 'i2',
      pieceId: 'c',
    });
  });

  it('presents the first piece of the previous item', () => {
    expect(apply(at('i2', 'c'), { type: 'previousItem' }).presented).toMatchObject({
      itemId: 'i1',
      pieceId: 'a',
    });
  });

  it('stays put at either end of the run sheet', () => {
    expect(apply(at('i3', 'a'), { type: 'nextItem' }).presented).toMatchObject({ itemId: 'i3' });
    expect(apply(at('i1', 'b'), { type: 'previousItem' }).presented).toMatchObject({
      itemId: 'i1',
      pieceId: 'b',
    });
  });

  it('shows the lyrics again', () => {
    const blank = apply(at('i1', 'a'), { type: 'blank' });
    expect(apply(blank, { type: 'nextItem' })).toMatchObject({
      blank: false,
      presented: { itemId: 'i2' },
    });
  });

  it('starts at the first item when nothing is presented', () => {
    const start = createLiveState('rs1', T0);
    expect(apply(start, { type: 'nextItem' }).presented).toMatchObject({ itemId: 'i1' });
    expect(apply(start, { type: 'previousItem' }).presented).toBeNull();
  });

  it('carries on from the old position when the presented item was removed', () => {
    const state = at('i2', 'c');
    const without = SEQUENCE.filter((piece) => piece.itemId !== 'i2');
    expect(apply(state, { type: 'nextItem' }, without).presented).toMatchObject({ itemId: 'i3' });
    expect(apply(state, { type: 'previousItem' }, without).presented).toMatchObject({
      itemId: 'i1',
      pieceId: 'a',
    });
  });
});

describe('blank', () => {
  it('blanks and unblanks without losing the presented piece', () => {
    let state = apply(createLiveState('rs1', T0), { type: 'next' });
    state = apply(state, { type: 'blank' });
    expect(state.blank).toBe(true);
    expect(state.presented?.pieceId).toBe('a');
    state = apply(state, { type: 'unblank' });
    expect(state.blank).toBe(false);
    expect(state.presented?.pieceId).toBe('a');
  });

  it('shows lyrics again when a piece is played while blank', () => {
    let state = apply(createLiveState('rs1', T0), { type: 'blank' });
    state = apply(state, { type: 'next' });
    expect(state.blank).toBe(false);
  });
});

describe('commands are applied once', () => {
  it('ignores a repeated command identifier', () => {
    const first = run(createLiveState('rs1', T0), { type: 'next', id: 'same' });
    const second = run(first.state, { type: 'next', id: 'same' });
    expect(first.result).toBe('applied');
    expect(second.result).toBe('duplicate');
    expect(second.state).toBe(first.state);
    expect(second.state.presented?.index).toBe(0);
  });

  it('increments the revision once per applied command', () => {
    let state = createLiveState('rs1', T0);
    state = apply(state, { type: 'next' });
    state = apply(state, { type: 'blank' });
    expect(state.revision).toBe(2);
  });

  it('bounds the remembered identifiers', () => {
    let state = createLiveState('rs1', T0);
    for (let i = 0; i < COMMAND_MEMORY + 10; i++) state = apply(state, { type: 'blank' });
    expect(state.appliedCommandIds).toHaveLength(COMMAND_MEMORY);
  });
});

describe('go live', () => {
  it('links to the new run sheet and keeps the presented piece', () => {
    let state = apply(createLiveState('rs1', T0), {
      type: 'playPiece',
      itemId: 'i1',
      pieceId: 'b',
    });
    state = apply(state, { type: 'blank' });
    const before = state.presented;
    state = apply(state, { type: 'goLive', runSheetId: 'rs2' });

    expect(state.runSheetId).toBe('rs2');
    expect(state.presented).toEqual(before);
    expect(state.blank).toBe(true);
    expect(isPresentingPreviousContent(state)).toBe(true);
  });

  it('starts from the first piece of the new run sheet on next', () => {
    let state = apply(createLiveState('rs1', T0), {
      type: 'playPiece',
      itemId: 'i2',
      pieceId: 'c',
    });
    state = apply(state, { type: 'goLive', runSheetId: 'rs2' });
    const newSheet: PlayablePiece[] = [
      { itemId: 'n1', songId: 's9', pieceId: 'x' },
      { itemId: 'n1', songId: 's9', pieceId: 'y' },
    ];
    const afterPrevious = apply(state, { type: 'previous' }, newSheet);
    expect(afterPrevious.presented?.runSheetId).toBe('rs1');

    state = apply(state, { type: 'next' }, newSheet);
    expect(state.presented).toMatchObject({ runSheetId: 'rs2', itemId: 'n1', pieceId: 'x' });
    expect(isPresentingPreviousContent(state)).toBe(false);
  });

  it('is not presenting previous content when nothing is presented', () => {
    const state = apply(createLiveState('rs1', T0), { type: 'goLive', runSheetId: 'rs2' });
    expect(isPresentingPreviousContent(state)).toBe(false);
  });

  it('revives an ended state', () => {
    let state = apply(createLiveState('rs1', T0), { type: 'end' });
    state = apply(state, { type: 'goLive', runSheetId: 'rs1' });
    expect(state).toMatchObject({ status: 'live', runSheetId: 'rs1', presented: null });
  });
});

describe('end', () => {
  it('clears the output and marks the state ended', () => {
    let state = apply(createLiveState('rs1', T0), { type: 'next' });
    state = apply(state, { type: 'blank' });
    state = apply(state, { type: 'end' });
    expect(state).toMatchObject({ status: 'ended', presented: null, blank: false });
  });

  it('rejects presentation commands once ended', () => {
    const ended = apply(createLiveState('rs1', T0), { type: 'end' });
    for (const type of ['next', 'previous', 'blank', 'unblank', 'end'] as const) {
      expect(run(ended, { type })).toMatchObject({ result: 'rejected', reason: 'ended' });
    }
    expect(run(ended, { type: 'playPiece', itemId: 'i1', pieceId: 'a' }).result).toBe('rejected');
  });
});

describe('expiry and start rules', () => {
  it('expires only after the period with no operator device', () => {
    const state = createLiveState('rs1', T0);
    expect(isExpired(state, later(DEFAULT_EXPIRY_MS))).toBe(false);
    expect(isExpired(state, later(DEFAULT_EXPIRY_MS + 1))).toBe(true);
    expect(isExpired(touch(state, later(DEFAULT_EXPIRY_MS)), later(DEFAULT_EXPIRY_MS + 1))).toBe(
      false,
    );
  });

  it('resumes an unexpired live state with its piece and blank flag', () => {
    let saved = apply(createLiveState('rs1', T0), { type: 'next' });
    saved = apply(saved, { type: 'blank' });
    const now = later(60_000);
    const decision = resolveStart({ saved, now, todayRunSheetId: 'rs-today' });
    expect(decision.kind).toBe('resume');
    if (decision.kind !== 'resume') return;
    expect(decision.state.runSheetId).toBe('rs1');
    expect(decision.state.presented).toEqual(saved.presented);
    expect(decision.state.blank).toBe(true);
    expect(decision.state.lastActiveAt).toBe(now);
  });

  it('starts from today with nothing presented once the old state expired', () => {
    const saved = apply(createLiveState('rs-old', T0), { type: 'next' });
    const decision = resolveStart({
      saved,
      now: later(DEFAULT_EXPIRY_MS + 1),
      todayRunSheetId: 'rs-today',
    });
    expect(decision).toMatchObject({
      kind: 'start',
      state: { status: 'live', runSheetId: 'rs-today', presented: null, blank: false },
    });
  });

  it('starts from today when there was never a live state', () => {
    expect(resolveStart({ saved: null, now: T0, todayRunSheetId: 'rs-today' }).kind).toBe('start');
  });

  it('starts nothing when today has no run sheet', () => {
    expect(resolveStart({ saved: null, now: T0, todayRunSheetId: null })).toEqual({ kind: 'none' });
    const expired = createLiveState('rs-old', T0);
    expect(
      resolveStart({ saved: expired, now: later(DEFAULT_EXPIRY_MS + 1), todayRunSheetId: null }),
    ).toEqual({ kind: 'none' });
  });

  it('keeps an ended state ended until it expires', () => {
    const ended = apply(createLiveState('rs1', T0), { type: 'end' });
    expect(resolveStart({ saved: ended, now: later(1000), todayRunSheetId: 'rs1' }).kind).toBe(
      'ended',
    );
    expect(
      resolveStart({ saved: ended, now: later(DEFAULT_EXPIRY_MS + 1), todayRunSheetId: 'rs1' })
        .kind,
    ).toBe('start');
  });

  it('honours a custom expiry period', () => {
    const saved = createLiveState('rs1', T0);
    expect(
      resolveStart({ saved, now: later(2000), todayRunSheetId: null, expiryMs: 1000 }).kind,
    ).toBe('none');
  });
});

describe('kept too long', () => {
  it('is offered once the live date is no longer today', () => {
    const state = createLiveState('rs1', T0);
    expect(isKeptTooLong(state, '2026-10-11', '2026-10-11')).toBe(false);
    expect(isKeptTooLong(state, '2026-10-11', '2026-10-12')).toBe(true);
    // Rehearsing a future date is not "too long".
    expect(isKeptTooLong(state, '2026-10-18', '2026-10-11')).toBe(false);
  });

  it('is not offered for an ended state', () => {
    const ended = apply(createLiveState('rs1', T0), { type: 'end' });
    expect(isKeptTooLong(ended, '2026-10-04', '2026-10-11')).toBe(false);
  });
});

describe('relocatePresented', () => {
  const ids = (prefix: string) => {
    let n = 0;
    return () => `${prefix}${++n}`;
  };

  function presenting(lyrics: string, pieceIndex: number, linesPerPiece = 2) {
    const lineIds = assignLineIds(null, lyrics, ids('L'));
    const pieces = buildPieces(lyrics, lineIds, linesPerPiece);
    const sequence = pieces.map((piece) => ({ itemId: 'i1', songId: 's1', pieceId: piece.id }));
    const state = apply(
      createLiveState('rs1', T0),
      { type: 'playPiece', itemId: 'i1', pieceId: pieces[pieceIndex]!.id },
      sequence,
    );
    return { state, lineIds, pieces, lyrics };
  }

  function edited(from: ReturnType<typeof presenting>, lyrics: string, linesPerPiece = 2) {
    const lineIds = assignLineIds({ lyrics: from.lyrics, lineIds: from.lineIds }, lyrics, ids('N'));
    return buildPieces(lyrics, lineIds, linesPerPiece);
  }

  const shownText = (state: LiveState, pieces: ReturnType<typeof buildPieces>) =>
    pieces.find((piece) => piece.id === state.presented?.pieceId)?.lines.map((line) => line.text);

  it('does not move when a later piece is edited', () => {
    const before = presenting('a\nb\n\nc\nd\n\ne\nf', 1);
    const after = edited(before, 'a\nb\n\nc\nd\n\ne\nF changed');
    const state = relocatePresented(before.state, 's1', before.pieces, after, T0);
    expect(state).toBe(before.state);
  });

  it('keeps showing the same piece when its own text is fixed', () => {
    const before = presenting('a\nb\n\nc\ntypo', 1);
    const after = edited(before, 'a\nb\n\nc\nfixed');
    const state = relocatePresented(before.state, 's1', before.pieces, after, T0);
    expect(state.presented?.pieceId).toBe(before.state.presented?.pieceId);
    expect(shownText(state, after)).toEqual(['c', 'fixed']);
  });

  it('stays on the same lyrics when a line is added above the presented piece', () => {
    const before = presenting('a\nb\n\nc\nd', 1);
    const after = edited(before, 'a\nb\nadded\n\nc\nd');
    const state = relocatePresented(before.state, 's1', before.pieces, after, T0);
    expect(shownText(state, after)).toEqual(['c', 'd']);
  });

  it('follows the first line when regrouping splits the presented piece', () => {
    const before = presenting('a\nb\nc\nd', 1);
    const after = edited(before, 'a\nadded\nb\nc\nd');
    const state = relocatePresented(before.state, 's1', before.pieces, after, T0);
    expect(shownText(state, after)).toContain('c');
    expect(state.revision).toBe(before.state.revision + 1);
  });

  it('clears the output when the presented piece is deleted', () => {
    const before = presenting('a\nb\n\nc\nd', 1);
    const after = edited(before, 'a\nb');
    const state = relocatePresented(before.state, 's1', before.pieces, after, T0);
    expect(state.presented).toBeNull();
    expect(state.status).toBe('live');
  });

  it('follows the first line when lines per piece changes', () => {
    const before = presenting('a\nb\nc\nd\ne\nf', 1);
    const four = buildPieces(before.lyrics, before.lineIds, 4);
    const state = relocatePresented(before.state, 's1', before.pieces, four, T0);
    expect(shownText(state, four)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores edits to other songs', () => {
    const before = presenting('a\nb', 0);
    expect(relocatePresented(before.state, 'other', before.pieces, [], T0)).toBe(before.state);
  });
});
