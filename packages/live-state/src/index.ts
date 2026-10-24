/**
 * Live state: the one authoritative record of what a workspace is presenting.
 *
 * Everything here is a pure function of state, command and context, so the same logic can
 * later run on a coordinator serving several devices. Each command carries an identifier
 * and is applied once.
 */
import { locatePiece, type Piece } from '@worship-q/lyrics';
import type { Command, LiveState, Presented } from '@worship-q/protocol';

export type { Command, LiveState, Presented };

type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;
/** A command before it is given its identifier. */
export type CommandInput = OmitId<Command>;

/** One piece of the live run sheet, in presentation order. */
export interface PlayablePiece {
  itemId: string;
  songId: string;
  pieceId: string;
}

export interface CommandContext {
  /** ISO timestamp of when the command is applied. */
  now: string;
  /** Every piece of the live run sheet, in order. */
  sequence: readonly PlayablePiece[];
}

export type CommandOutcome =
  | { state: LiveState; result: 'applied' }
  | { state: LiveState; result: 'duplicate' }
  | { state: LiveState; result: 'rejected'; reason: RejectionReason };

export type RejectionReason = 'ended' | 'unknown-piece';

/** How many applied command identifiers are remembered for de-duplication. */
export const COMMAND_MEMORY = 256;

/** Decision D6: a live state expires this long after the last operator device closes. */
export const DEFAULT_EXPIRY_MS = 4 * 60 * 60 * 1000;

export function createLiveState(runSheetId: string, now: string): LiveState {
  return {
    status: 'live',
    runSheetId,
    presented: null,
    blank: false,
    revision: 0,
    appliedCommandIds: [],
    startedAt: now,
    updatedAt: now,
    lastActiveAt: now,
  };
}

function indexOfPresented(presented: Presented, sequence: readonly PlayablePiece[]): number {
  return sequence.findIndex(
    (piece) => piece.itemId === presented.itemId && piece.pieceId === presented.pieceId,
  );
}

function play(
  state: LiveState,
  sequence: readonly PlayablePiece[],
  index: number,
): Partial<LiveState> {
  const piece = sequence[index]!;
  return {
    presented: {
      runSheetId: state.runSheetId,
      itemId: piece.itemId,
      songId: piece.songId,
      pieceId: piece.pieceId,
      index,
    },
    blank: false,
  };
}

/**
 * Where next/previous lands.
 *
 * - Nothing presented, or content from a previous run sheet: next starts at the first
 *   piece; previous does nothing.
 * - Presented item since removed from the run sheet: next plays whatever now sits at its
 *   old position; previous plays the piece before that position.
 * - At either end of the run sheet: stay put.
 */
function step(state: LiveState, sequence: readonly PlayablePiece[], by: 1 | -1): number | null {
  if (sequence.length === 0) return null;
  const presented = state.presented;
  if (!presented || presented.runSheetId !== state.runSheetId) return by === 1 ? 0 : null;

  const current = indexOfPresented(presented, sequence);
  if (current >= 0) {
    const target = current + by;
    return target >= 0 && target < sequence.length ? target : null;
  }
  const target = by === 1 ? presented.index : presented.index - 1;
  if (target < 0) return null;
  return Math.min(target, sequence.length - 1);
}

/** Index of the first piece of the item that the piece at `index` belongs to. */
function itemStart(sequence: readonly PlayablePiece[], index: number): number {
  const itemId = sequence[index]!.itemId;
  let start = index;
  while (start > 0 && sequence[start - 1]!.itemId === itemId) start--;
  return start;
}

/** Index of the last piece of the item that the piece at `index` belongs to. */
function itemEnd(sequence: readonly PlayablePiece[], index: number): number {
  const itemId = sequence[index]!.itemId;
  let end = index;
  while (end < sequence.length - 1 && sequence[end + 1]!.itemId === itemId) end++;
  return end;
}

/**
 * Where stepping within the presented item lands; it never leaves the item.
 *
 * - While blank: either direction shows the same piece again, without moving.
 * - Nothing presented from this run sheet: next shows the first item's first piece and
 *   previous its last.
 * - At either end of the item: stay put.
 * - Presented item since removed from the run sheet: stay put.
 */
function stepInItem(
  state: LiveState,
  sequence: readonly PlayablePiece[],
  by: 1 | -1,
): number | null {
  if (sequence.length === 0) return null;
  const presented = state.presented;
  const fresh = !presented || presented.runSheetId !== state.runSheetId;
  const current = fresh ? 0 : indexOfPresented(presented, sequence);
  if (current < 0) return null;
  if (fresh) return by === 1 ? itemStart(sequence, current) : itemEnd(sequence, current);
  if (state.blank) return current;
  const target = current + by;
  return sequence[target]?.itemId === sequence[current]!.itemId ? target : null;
}

/**
 * Where moving to the next or previous item lands: always on that item's first piece.
 *
 * - Nothing presented, or content from a previous run sheet: next starts at the first
 *   item; previous does nothing.
 * - Presented item since removed from the run sheet: next goes to the item now at its old
 *   position; previous to the item before that position.
 * - At either end of the run sheet: stay put.
 */
function stepItem(state: LiveState, sequence: readonly PlayablePiece[], by: 1 | -1): number | null {
  if (sequence.length === 0) return null;
  const presented = state.presented;
  if (!presented || presented.runSheetId !== state.runSheetId) return by === 1 ? 0 : null;

  const current = indexOfPresented(presented, sequence);
  let target: number;
  if (current >= 0) {
    target = by === 1 ? itemEnd(sequence, current) + 1 : itemStart(sequence, current) - 1;
  } else {
    target = Math.min(by === 1 ? presented.index : presented.index - 1, sequence.length - 1);
  }
  if (target < 0 || target >= sequence.length) return null;
  return itemStart(sequence, target);
}

function reduce(
  state: LiveState,
  command: Command,
  context: CommandContext,
): Partial<LiveState> | RejectionReason {
  if (command.type === 'goLive') {
    if (state.status === 'live' && state.runSheetId === command.runSheetId) return {};
    // The presented piece is deliberately kept: Go live alone never changes the screen.
    return { status: 'live', runSheetId: command.runSheetId };
  }
  if (state.status === 'ended') return 'ended';

  switch (command.type) {
    case 'playPiece': {
      const index = context.sequence.findIndex(
        (piece) => piece.itemId === command.itemId && piece.pieceId === command.pieceId,
      );
      return index < 0 ? 'unknown-piece' : play(state, context.sequence, index);
    }
    case 'next':
    case 'previous': {
      const index = step(state, context.sequence, command.type === 'next' ? 1 : -1);
      return index === null ? {} : play(state, context.sequence, index);
    }
    case 'nextInItem':
    case 'previousInItem': {
      const index = stepInItem(state, context.sequence, command.type === 'nextInItem' ? 1 : -1);
      return index === null ? {} : play(state, context.sequence, index);
    }
    case 'nextItem':
    case 'previousItem': {
      const index = stepItem(state, context.sequence, command.type === 'nextItem' ? 1 : -1);
      return index === null ? {} : play(state, context.sequence, index);
    }
    case 'blank':
      return { blank: true };
    case 'unblank':
      return { blank: false };
    case 'clear':
      return { presented: null, blank: false };
    case 'end':
      return { status: 'ended', presented: null, blank: false };
  }
}

/** Applies a command once. A repeated identifier leaves the state untouched. */
export function applyCommand(
  state: LiveState,
  command: Command,
  context: CommandContext,
): CommandOutcome {
  if (state.appliedCommandIds.includes(command.id)) return { state, result: 'duplicate' };

  const change = reduce(state, command, context);
  if (typeof change === 'string') return { state, result: 'rejected', reason: change };

  return {
    result: 'applied',
    state: {
      ...state,
      ...change,
      revision: state.revision + 1,
      appliedCommandIds: [...state.appliedCommandIds, command.id].slice(-COMMAND_MEMORY),
      updatedAt: context.now,
      lastActiveAt: context.now,
    },
  };
}

/** Records that an operator device is still connected. */
export function touch(state: LiveState, now: string): LiveState {
  return { ...state, lastActiveAt: now };
}

export function isExpired(state: LiveState, now: string, expiryMs = DEFAULT_EXPIRY_MS): boolean {
  return Date.parse(now) - Date.parse(state.lastActiveAt) > expiryMs;
}

export type StartDecision =
  /** An unexpired live state exists: carry on with its run sheet, piece and blank flag. */
  | { kind: 'resume'; state: LiveState }
  /** An unexpired but ended state: the caller goes live with the next meeting date. */
  | { kind: 'ended'; state: LiveState }
  /** Nothing to resume and today has a run sheet: go live with it, nothing presented. */
  | { kind: 'start'; state: LiveState }
  /** Nothing to resume and nothing planned today: the caller goes live with the next meeting date. */
  | { kind: 'none' };

/** The start rules applied when the first operator device connects. */
export function resolveStart(input: {
  saved: LiveState | null;
  now: string;
  /** Identifier of today's run sheet, or null when today has nothing planned. */
  todayRunSheetId: string | null;
  expiryMs?: number;
}): StartDecision {
  const { saved, now, todayRunSheetId, expiryMs } = input;
  if (saved && !isExpired(saved, now, expiryMs)) {
    const state = touch(saved, now);
    return { kind: saved.status === 'live' ? 'resume' : 'ended', state };
  }
  if (todayRunSheetId) return { kind: 'start', state: createLiveState(todayRunSheetId, now) };
  return { kind: 'none' };
}

/** After Go live on another date, the screen may still show the earlier run sheet. */
export function isPresentingPreviousContent(state: LiveState): boolean {
  return state.presented !== null && state.presented.runSheetId !== state.runSheetId;
}

/**
 * Decision D6: offer to end once the live run sheet's date has passed. Nothing ends
 * automatically.
 */
export function isKeptTooLong(state: LiveState, liveDate: string, today: string): boolean {
  return state.status === 'live' && liveDate < today;
}

/**
 * Keeps the presented position when a song's pieces are rebuilt, after a lyrics edit or a
 * change to the lines-per-piece setting.
 *
 * The presentation follows the piece that now holds the first surviving line of the
 * presented piece. If every line of the presented piece was deleted, the output is cleared
 * rather than jumping to other lyrics.
 */
export function relocatePresented(
  state: LiveState,
  songId: string,
  before: readonly Piece[],
  after: readonly Piece[],
  now: string,
): LiveState {
  const presented = state.presented;
  if (!presented || presented.songId !== songId) return state;
  const old = before.find((piece) => piece.id === presented.pieceId);
  // A slide without text has no lines to follow, so it stays while it still exists.
  const pieceId =
    (old && locatePiece(old, [...after])) ??
    after.find((piece) => piece.id === presented.pieceId)?.id ??
    null;
  if (pieceId === presented.pieceId) return state;
  return {
    ...state,
    presented: pieceId ? { ...presented, pieceId } : null,
    revision: state.revision + 1,
    updatedAt: now,
  };
}
