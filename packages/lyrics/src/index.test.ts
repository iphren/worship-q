import { describe, expect, it } from 'vitest';
import {
  assignLineIds,
  buildPieces,
  diffPieces,
  locatePiece,
  normalizeLineEndings,
  parseBlocks,
  sourceLines,
} from './index';

function counter(prefix = 'L') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function pieces(lyrics: string, linesPerPiece = 2, ids = assignLineIds(null, lyrics, counter())) {
  return buildPieces(lyrics, ids, linesPerPiece);
}

const texts = (list: ReturnType<typeof buildPieces>) =>
  list.map((piece) => piece.lines.map((line) => line.text));

const SPEC_EXAMPLE = [
  'English line one',
  '中文第一行',
  'English line two',
  '中文第二行',
  '',
  'English line three',
  '中文第三行',
].join('\n');

describe('parseBlocks (D4)', () => {
  it('separates blocks on blank lines', () => {
    expect(parseBlocks('a\nb\n\nc')).toEqual([['a', 'b'], ['c']]);
  });

  it('treats whitespace-only lines as blank', () => {
    expect(parseBlocks('a\n \t \nb\n　\nc')).toEqual([['a'], ['b'], ['c']]);
  });

  it('treats several blank lines as one separator', () => {
    expect(parseBlocks('a\n\n\n\n\nb')).toEqual([['a'], ['b']]);
  });

  it('ignores leading and trailing blank lines', () => {
    expect(parseBlocks('\n\na\n\n')).toEqual([['a']]);
  });

  it('normalizes Windows and old Mac line endings', () => {
    expect(normalizeLineEndings('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(parseBlocks('a\r\nb\r\n\r\nc')).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps other spacing inside a line', () => {
    expect(parseBlocks('  indented  line \nnext')).toEqual([['  indented  line ', 'next']]);
  });

  it('returns no blocks for empty or blank text', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks(' \n\n\t')).toEqual([]);
  });

  it('does not change the text it is given', () => {
    const raw = 'a\r\n\r\n\r\n b ';
    parseBlocks(raw);
    expect(raw).toBe('a\r\n\r\n\r\n b ');
  });
});

describe('buildPieces', () => {
  it('produces the three pieces of the spec example', () => {
    const result = pieces(SPEC_EXAMPLE);
    expect(texts(result)).toEqual([
      ['English line one', '中文第一行'],
      ['English line two', '中文第二行'],
      ['English line three', '中文第三行'],
    ]);
    expect(result.map((p) => [p.blockIndex, p.indexInBlock])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it('never groups across a block boundary', () => {
    expect(texts(pieces('a\n\nb\nc\n\nd', 2))).toEqual([['a'], ['b', 'c'], ['d']]);
  });

  it('puts leftover lines of a block into a shorter final piece', () => {
    expect(texts(pieces('a\nb\nc', 2))).toEqual([['a', 'b'], ['c']]);
    expect(texts(pieces('a\nb\nc\nd\ne', 4))).toEqual([['a', 'b', 'c', 'd'], ['e']]);
  });

  it('honours the configured line count', () => {
    expect(texts(pieces('a\nb\nc\nd', 1))).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(texts(pieces('a\nb\nc\nd', 4))).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('identifies each piece by its first line', () => {
    const result = pieces('a\nb\nc\nd', 2);
    expect(result.map((p) => p.id)).toEqual(['L1', 'L3']);
    expect(new Set(result.map((p) => p.id)).size).toBe(result.length);
  });

  it('gives repeated text distinct identities', () => {
    const result = pieces('chorus\nline\n\nchorus\nline');
    expect(result[0]!.id).not.toBe(result[1]!.id);
  });

  it('returns nothing for empty lyrics', () => {
    expect(pieces('')).toEqual([]);
  });
});

describe('assignLineIds', () => {
  it('creates one identifier per source line', () => {
    expect(assignLineIds(null, 'a\nb\n\nc', counter())).toEqual(['L1', 'L2', 'L3']);
  });

  it('keeps identifiers of unchanged lines when a later line is edited', () => {
    const before = assignLineIds(null, 'a\nb\nc\nd', counter());
    const after = assignLineIds(
      { lyrics: 'a\nb\nc\nd', lineIds: before },
      'a\nb\nc\nD!',
      counter('N'),
    );
    expect(after).toEqual(before);
  });

  it('treats an in-place edit as the same line', () => {
    const before = assignLineIds(null, 'a\ntypo\nc', counter());
    const after = assignLineIds(
      { lyrics: 'a\ntypo\nc', lineIds: before },
      'a\nfixed\nc',
      counter('N'),
    );
    expect(after).toEqual(before);
  });

  it('gives an inserted line a new identifier and keeps the rest', () => {
    const before = assignLineIds(null, 'a\nb\nc', counter());
    const after = assignLineIds(
      { lyrics: 'a\nb\nc', lineIds: before },
      'a\nnew\nb\nc',
      counter('N'),
    );
    expect(after).toEqual(['L1', 'N1', 'L2', 'L3']);
  });

  it('drops the identifier of a deleted line', () => {
    const before = assignLineIds(null, 'a\nb\nc', counter());
    const after = assignLineIds({ lyrics: 'a\nb\nc', lineIds: before }, 'a\nc', counter('N'));
    expect(after).toEqual(['L1', 'L3']);
  });

  it('ignores changes that only move block boundaries', () => {
    const before = assignLineIds(null, 'a\nb\nc', counter());
    const after = assignLineIds(
      { lyrics: 'a\nb\nc', lineIds: before },
      'a\n\nb\n\n\nc',
      counter('N'),
    );
    expect(after).toEqual(before);
  });

  it('handles repeated lines', () => {
    const lyrics = 'x\ny\n\nx\ny';
    const before = assignLineIds(null, lyrics, counter());
    const after = assignLineIds({ lyrics, lineIds: before }, 'x\ny\n\nx\ny\n\nx\ny', counter('N'));
    expect(after).toEqual(['L1', 'L2', 'L3', 'L4', 'N1', 'N2']);
  });

  it('starts afresh when the stored identifiers do not match the stored lyrics', () => {
    const after = assignLineIds({ lyrics: 'a\nb', lineIds: ['only-one'] }, 'a\nb', counter('N'));
    expect(after).toEqual(['N1', 'N2']);
  });

  it('never hands out the same identifier twice', () => {
    const before = assignLineIds(null, 'a\nb\nc\nd', counter());
    const after = assignLineIds(
      { lyrics: 'a\nb\nc\nd', lineIds: before },
      'd\nc\nb\na\nz',
      counter('N'),
    );
    expect(new Set(after).size).toBe(after.length);
    expect(after).toHaveLength(sourceLines('d\nc\nb\na\nz').length);
  });
});

describe('piece identity across edits', () => {
  function edit(before: string, after: string, linesPerPiece = 2) {
    const beforeIds = assignLineIds(null, before, counter());
    const afterIds = assignLineIds({ lyrics: before, lineIds: beforeIds }, after, counter('N'));
    return {
      before: buildPieces(before, beforeIds, linesPerPiece),
      after: buildPieces(after, afterIds, linesPerPiece),
    };
  }

  it('leaves earlier piece identities unchanged when a later line is edited', () => {
    const { before, after } = edit(
      SPEC_EXAMPLE,
      SPEC_EXAMPLE.replace('中文第三行', '中文第三行（改）'),
    );
    expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
    expect(diffPieces(before, after)).toEqual({
      kept: [before[0]!.id, before[1]!.id],
      changed: [before[2]!.id],
      added: [],
      removed: [],
    });
  });

  it('reports added and removed pieces', () => {
    const { before, after } = edit('a\nb\n\nc\nd', 'a\nb\n\ne\nf\n\nc\nd');
    const diff = diffPieces(before, after);
    expect(diff.kept).toEqual([before[0]!.id, before[1]!.id]);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toEqual([]);

    const back = diffPieces(after, before);
    expect(back.removed).toEqual(diff.added);
  });

  it('keeps a piece in place when a block is added above it', () => {
    const { before, after } = edit('a\nb\n\nc\nd', 'new\nblock\n\na\nb\n\nc\nd');
    const presented = before[1]!;
    expect(locatePiece(presented, after)).toBe(presented.id);
    expect(after.find((p) => p.id === presented.id)!.lines.map((l) => l.text)).toEqual(['c', 'd']);
  });

  it('follows the first line of a piece when a line is added above it in the same block', () => {
    const { before, after } = edit('a\nb\nc\nd', 'a\nnew\nb\nc\nd');
    const presented = before[1]!; // c + d
    const located = locatePiece(presented, after);
    const holder = after.find((p) => p.id === located)!;
    expect(holder.lines.map((l) => l.text)).toContain('c');
  });

  it('falls back to a later line of the piece when its first line is deleted', () => {
    const { before, after } = edit('a\nb\n\nc\nd', 'a\nb\n\nd');
    const located = locatePiece(before[1]!, after);
    expect(after.find((p) => p.id === located)!.lines.map((l) => l.text)).toEqual(['d']);
  });

  it('reports a piece as gone when all of its lines are deleted', () => {
    const { before, after } = edit('a\nb\n\nc\nd', 'a\nb');
    expect(locatePiece(before[1]!, after)).toBeNull();
    expect(diffPieces(before, after).removed).toEqual([before[1]!.id]);
  });

  it('locates the presented piece after the lines-per-piece setting changes', () => {
    const lyrics = 'a\nb\nc\nd\ne\nf';
    const ids = assignLineIds(null, lyrics, counter());
    const two = buildPieces(lyrics, ids, 2);
    const four = buildPieces(lyrics, ids, 4);
    const one = buildPieces(lyrics, ids, 1);

    // c + d becomes part of a + b + c + d
    expect(locatePiece(two[1]!, four)).toBe(four[0]!.id);
    // e + f stays the piece starting at e
    expect(locatePiece(two[2]!, four)).toBe(four[1]!.id);
    // c + d becomes the single line c
    expect(locatePiece(two[1]!, one)).toBe(one[2]!.id);
  });
});
