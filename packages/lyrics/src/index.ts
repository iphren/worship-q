/**
 * Lyrics engine: turns raw lyric text into blocks, source lines and logical pieces.
 *
 * The stored text is never modified. Rules for edge cases (decision D4):
 * - line endings are normalized before parsing;
 * - a line holding only whitespace counts as blank;
 * - any run of blank lines is one block separator;
 * - leftover lines at the end of a block form a shorter final piece;
 * - all other spacing inside a line is kept.
 *
 * Identity: every source line has a stable identifier that survives edits elsewhere in the
 * song. A piece is identified by its first source line, so fixing a typo keeps the piece's
 * identity and editing a later line never disturbs earlier pieces.
 */

export interface PieceLine {
  id: string;
  text: string;
}

export interface Piece {
  /** Identifier of the piece's first source line. */
  id: string;
  blockIndex: number;
  indexInBlock: number;
  lines: PieceLine[];
  /** An imported slide's image, shown instead of the lines; see `Deck`. */
  image?: string;
}

export interface PieceDiff {
  /** Same identity and same content. */
  kept: string[];
  /** Same identity, different lines or text. */
  changed: string[];
  added: string[];
  removed: string[];
}

const LINE_ENDINGS = new RegExp(
  `\\r\\n?|${String.fromCharCode(0x2028)}|${String.fromCharCode(0x2029)}`,
  'g',
);

export function normalizeLineEndings(raw: string): string {
  return raw.replace(LINE_ENDINGS, '\n');
}

function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

/** Blocks of source lines, in order. Blank lines separate blocks and are not included. */
export function parseBlocks(raw: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of normalizeLineEndings(raw).split('\n')) {
    if (isBlank(line)) {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** Every source line in order, ignoring block boundaries. */
export function sourceLines(raw: string): string[] {
  return parseBlocks(raw).flat();
}

/**
 * Gives each source line of `nextLyrics` an identifier, reusing the previous ones where a
 * line is unchanged or was edited in place.
 *
 * Unchanged lines are matched first (longest common subsequence). Between two matches, old
 * and new lines are paired in order and treated as edits of each other; anything left over
 * is a removed or a new line.
 */
export function assignLineIds(
  previous: { lyrics: string; lineIds: string[] } | null,
  nextLyrics: string,
  newId: () => string,
): string[] {
  const next = sourceLines(nextLyrics);
  const old = previous ? sourceLines(previous.lyrics) : [];
  const oldIds = previous?.lineIds ?? [];
  if (old.length !== oldIds.length) return next.map(() => newId());

  const result: (string | undefined)[] = new Array(next.length).fill(undefined);
  const matches = longestCommonSubsequence(old, next);
  let oldStart = 0;
  let nextStart = 0;
  for (const [oldIndex, nextIndex] of [...matches, [old.length, next.length] as const]) {
    const paired = Math.min(oldIndex - oldStart, nextIndex - nextStart);
    for (let k = 0; k < paired; k++) result[nextStart + k] = oldIds[oldStart + k];
    if (nextIndex < next.length) result[nextIndex] = oldIds[oldIndex];
    oldStart = oldIndex + 1;
    nextStart = nextIndex + 1;
  }
  return result.map((id) => id ?? newId());
}

function longestCommonSubsequence(a: string[], b: string[]): (readonly [number, number])[] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const pairs: (readonly [number, number])[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Groups source lines into logical pieces of `linesPerPiece` lines, never across a block
 * boundary. `lineIds` holds one identifier per source line, as produced by `assignLineIds`.
 */
export function buildPieces(lyrics: string, lineIds: string[], linesPerPiece: number): Piece[] {
  const size = Math.max(1, Math.floor(linesPerPiece));
  const pieces: Piece[] = [];
  let ordinal = 0;
  parseBlocks(lyrics).forEach((block, blockIndex) => {
    for (let start = 0; start < block.length; start += size) {
      const lines = block.slice(start, start + size).map((text) => {
        const id = lineIds[ordinal] ?? `line-${ordinal}`;
        ordinal++;
        return { id, text };
      });
      pieces.push({ id: lines[0]!.id, blockIndex, indexInBlock: start / size, lines });
    }
  });
  return pieces;
}

function sameContent(a: Piece, b: Piece): boolean {
  return (
    a.lines.length === b.lines.length &&
    a.lines.every((line, i) => line.id === b.lines[i]!.id && line.text === b.lines[i]!.text)
  );
}

/** Reports which pieces an edit kept, changed, added or removed, by piece identity. */
export function diffPieces(before: Piece[], after: Piece[]): PieceDiff {
  const old = new Map(before.map((piece) => [piece.id, piece]));
  const diff: PieceDiff = { kept: [], changed: [], added: [], removed: [] };
  const seen = new Set<string>();
  for (const piece of after) {
    seen.add(piece.id);
    const previous = old.get(piece.id);
    if (!previous) diff.added.push(piece.id);
    else if (sameContent(previous, piece)) diff.kept.push(piece.id);
    else diff.changed.push(piece.id);
  }
  for (const piece of before) if (!seen.has(piece.id)) diff.removed.push(piece.id);
  return diff;
}

/**
 * Finds where a piece ended up after an edit or a change to the lines-per-piece setting:
 * the new piece holding the first of its lines that still exists. Returns null when every
 * line of the piece is gone.
 */
export function locatePiece(piece: Piece, after: Piece[]): string | null {
  for (const line of piece.lines) {
    const holder = after.find((candidate) => candidate.lines.some((l) => l.id === line.id));
    if (holder) return holder.id;
  }
  return null;
}
