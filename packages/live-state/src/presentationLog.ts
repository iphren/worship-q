/**
 * The presentation log's events (service records R13, R15; task M4.1): what is on screen,
 * read from the coordinator's snapshot, and whether a change of snapshot closes the entry
 * open and opens another. Pure, so every command that changes the screen is tested here.
 *
 * An entry is one unbroken showing of one piece on the outputs. Blank and clear make no
 * entry of their own; they are the gaps between entries. A change that leaves the same piece
 * of the same revision on screen makes no event, whatever else changed: the devices, a
 * video's position, the run sheet's other items, or the background.
 */
import type { LiveSnapshot, LogPart, SnapshotPiece } from '@worship-q/protocol';

/** What is on screen, as far as the snapshot says; the caller adds the song's revision. */
export interface Showing {
  /** The run sheet the piece was played from, which after Go live may not be the live one. */
  runSheetId: string;
  /** That run sheet's date; null when it is the previous one, which the snapshot does not date. */
  date: string | null;
  itemId: string;
  songId: string;
  pieceId: string;
  previous: boolean;
  part: LogPart;
}

/** A showing with the revision of the song then shown, which an edit on screen changes. */
export interface RevisedShowing extends Showing {
  revision: number | null;
}

/** Which part of the item the piece is, by position, never as text (R15). */
export function partOf(
  kind: NonNullable<LiveSnapshot['presented']>['kind'],
  pieces: readonly SnapshotPiece[],
  pieceId: string,
): LogPart | null {
  const index = pieces.findIndex((piece) => piece.id === pieceId);
  if (index < 0) return null;
  const before = pieces.slice(0, index);
  const piece = pieces[index]!;
  switch (kind) {
    case 'lyrics':
      return {
        kind: 'lyrics',
        line: before.reduce((total, p) => total + p.lines.length, 0),
        count: piece.lines.length,
      };
    case 'deck':
      return { kind: 'deck', page: index };
    case 'passage': {
      const columns = piece.passage?.columns ?? [];
      return {
        kind: 'passage',
        slide: index,
        units: columns.map((column, c) => ({
          start: before.reduce((total, p) => total + (p.passage?.columns[c]?.units.length ?? 0), 0),
          count: column.units.length,
        })),
      };
    }
    case 'video':
      return { kind: 'video' };
    case 'website':
      return { kind: 'website' };
  }
}

/** What the outputs show, or null for nothing: not live, blank, cleared or ended. */
export function showingOf(snapshot: LiveSnapshot | null): Showing | null {
  if (!snapshot || snapshot.state.status !== 'live' || snapshot.state.blank) return null;
  const state = snapshot.state.presented;
  const presented = snapshot.presented;
  if (!state || !presented || presented.pieceId !== state.pieceId) return null;
  const part = partOf(presented.kind, presented.pieces, presented.pieceId);
  if (!part) return null;
  return {
    runSheetId: state.runSheetId,
    date: presented.previous ? null : snapshot.date,
    itemId: presented.itemId,
    songId: presented.songId,
    pieceId: presented.pieceId,
    previous: presented.previous,
    part,
  };
}

/** Whether two showings are the same unbroken showing. */
export function sameShowing(a: RevisedShowing | null, b: RevisedShowing | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.runSheetId === b.runSheetId &&
    a.itemId === b.itemId &&
    a.songId === b.songId &&
    a.pieceId === b.pieceId &&
    a.revision === b.revision &&
    JSON.stringify(a.part) === JSON.stringify(b.part)
  );
}

/**
 * The events a change of showing makes: whether the open entry closes, and what opens. Piece
 * to piece closes one and opens one at the same instant.
 */
export function logEvents(
  previous: RevisedShowing | null,
  next: RevisedShowing | null,
): { close: boolean; open: RevisedShowing | null } {
  if (sameShowing(previous, next)) return { close: false, open: null };
  return { close: previous !== null, open: next };
}
