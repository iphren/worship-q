import { describe, expect, it } from 'vitest';
import {
  breakCandidates,
  contrastTextColor,
  fitPassage,
  fitSong,
  wrapText,
  PASSAGE_FLOOR_RATIO,
  PASSAGE_TARGET_RATIO,
  outputGeometry,
  type FitOptions,
  type Measure,
} from './layout';

/** A predictable font: Latin characters are half an em wide, CJK a full em. */
const measure: Measure = (text) =>
  Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0)! > 0x2e7f ? 1 : 0.5), 0);

const base: FitOptions = {
  width: 1000,
  height: 500,
  lineHeight: 1.25,
  wrap: true,
  minSize: 20,
  maxSize: 100,
  scale: 1,
};

const widest = (lines: string[], size: number) => Math.max(...lines.map((l) => measure(l) * size));

describe('breakCandidates', () => {
  it('breaks Latin text at spaces only', () => {
    expect(breakCandidates('one two three')).toEqual([
      ['one', 'two three'],
      ['one two', 'three'],
    ]);
    expect(breakCandidates('unbreakable')).toEqual([]);
  });

  it('breaks Chinese text only at spaces or punctuation', () => {
    expect(breakCandidates('中文字')).toEqual([]);
    expect(breakCandidates('你好，世界')).toEqual([['你好，', '世界']]);
    expect(breakCandidates('奇异恩典 何等甘甜')).toEqual([['奇异恩典', '何等甘甜']]);
    expect(breakCandidates('他说“来吧”')).toEqual([['他说', '“来吧”']]);
  });

  it('does not break Latin words at punctuation', () => {
    expect(breakCandidates('don’t (stop)')).toEqual([['don’t', '(stop)']]);
  });

  it('does not start a line with closing punctuation or end one with opening punctuation', () => {
    const candidates = breakCandidates('你好，「世界」');
    expect(candidates.some(([, second]) => second.startsWith('，'))).toBe(false);
    expect(candidates.some(([first]) => first.endsWith('「'))).toBe(false);
    expect(candidates.some(([, second]) => second.startsWith('」'))).toBe(false);
    expect(candidates).toContainEqual(['你好，', '「世界」']);
  });

  it('drops the spaces around a break', () => {
    expect(breakCandidates('a  b')).toEqual([['a', 'b']]);
  });
});

describe('fitSong', () => {
  it('uses the maximum size when everything is short', () => {
    const song = fitSong([['Hi', '你好']], base, measure);
    expect(song.fontSize).toBe(100);
    expect(song.pieces[0]).toEqual({ fontSize: 100, lines: ['Hi', '你好'] });
  });

  it('gives every piece of the song the same size, set by the hardest piece', () => {
    const long = 'x'.repeat(50); // 25 em, cannot be broken → fits at 40px
    const song = fitSong([['short'], [long], ['短']], { ...base, wrap: false }, measure);
    expect(song.fontSize).toBeCloseTo(40, 1);
    expect(new Set(song.pieces.map((piece) => piece.fontSize)).size).toBe(1);
  });

  it('wraps a long line once instead of shrinking the song', () => {
    const line = 'word '.repeat(8).trim(); // 39 chars = 19.5 em
    const wrapped = fitSong([[line, '中文']], base, measure);
    const unwrapped = fitSong([[line, '中文']], { ...base, wrap: false }, measure);

    expect(wrapped.pieces[0]!.lines).toHaveLength(3);
    expect(wrapped.pieces[0]!.lines.slice(0, 2).join(' ')).toBe(line);
    expect(unwrapped.pieces[0]!.lines).toEqual([line, '中文']);
    expect(wrapped.fontSize).toBeGreaterThan(unwrapped.fontSize);
  });

  it('breaks a wrapped line as evenly as possible', () => {
    const song = fitSong([['aaaa bbbb cccc dddd eeee ffff gggg hhhh']], base, measure);
    expect(song.pieces[0]!.lines).toEqual(['aaaa bbbb cccc dddd', 'eeee ffff gggg hhhh']);
  });

  it('never shows a source line as more than two visual lines', () => {
    const line = 'word '.repeat(60).trim();
    const song = fitSong([[line]], base, measure);
    expect(song.pieces[0]!.lines).toHaveLength(2);
    expect(widest(song.pieces[0]!.lines, song.pieces[0]!.fontSize)).toBeLessThanOrEqual(1000.01);
  });

  it('leaves lines that already fit unwrapped', () => {
    const song = fitSong([['short line', 'another']], base, measure);
    expect(song.pieces[0]!.lines).toEqual(['short line', 'another']);
  });

  it('fits the height: four lines wrapped to eight still fit', () => {
    const line = ('字'.repeat(14) + '，').repeat(2);
    const song = fitSong([[line, line, line, line]], base, measure);
    const piece = song.pieces[0]!;
    expect(piece.lines).toHaveLength(8);
    expect(piece.lines.length * piece.fontSize * base.lineHeight).toBeLessThanOrEqual(500.01);
    expect(widest(piece.lines, piece.fontSize)).toBeLessThanOrEqual(1000.01);
  });

  it('keeps the song at the minimum size and shrinks only the offending piece', () => {
    const huge = 'x'.repeat(200); // 100 em, unbreakable → fits only at 10px
    const song = fitSong([['normal'], [huge]], base, measure);
    expect(song.fontSize).toBe(20);
    expect(song.pieces[0]!.fontSize).toBe(20);
    expect(song.pieces[1]!.fontSize).toBeCloseTo(10, 1);
    expect(measure(huge) * song.pieces[1]!.fontSize).toBeLessThanOrEqual(1000.01);
  });

  it('applies the scale slider to the automatic size', () => {
    const long = 'x'.repeat(50); // automatic size 40
    const smaller = fitSong([[long], ['a']], { ...base, wrap: false, scale: 0.5 }, measure);
    expect(smaller.fontSize).toBeCloseTo(20, 1);
    expect(smaller.pieces.every((piece) => Math.abs(piece.fontSize - 20) < 0.1)).toBe(true);
  });

  it('does not let a scaled-up piece overflow', () => {
    const long = 'x'.repeat(50); // fits at 40 at most
    const song = fitSong([[long], ['a']], { ...base, wrap: false, scale: 1.5 }, measure);
    expect(song.fontSize).toBeCloseTo(60, 1);
    expect(song.pieces[0]!.fontSize).toBeCloseTo(40, 1);
    expect(song.pieces[1]!.fontSize).toBeCloseTo(60, 1);
  });

  it('ignores trailing spaces when measuring and showing a line', () => {
    const song = fitSong([['text      ']], base, measure);
    expect(song.pieces[0]!.lines).toEqual(['text']);
  });

  it('keeps leading spaces', () => {
    const song = fitSong([['  indented']], base, measure);
    expect(song.pieces[0]!.lines).toEqual(['  indented']);
  });

  it('handles a song with no pieces', () => {
    expect(fitSong([], base, measure)).toEqual({ fontSize: 100, pieces: [] });
  });

  it('recalculates for a different output size', () => {
    const pieces = [['x'.repeat(50)]];
    const small = fitSong(pieces, { ...base, wrap: false }, measure);
    const large = fitSong(pieces, { ...base, wrap: false, width: 2000, maxSize: 200 }, measure);
    expect(large.fontSize).toBeCloseTo(small.fontSize * 2, 1);
  });
});

describe('outputGeometry', () => {
  it('derives the safe area and size limits from the output size', () => {
    const geometry = outputGeometry(1920, 1080, { wrap: true, scale: 1 });
    expect(geometry.width).toBeCloseTo(1920 * 0.88);
    expect(geometry.height).toBeCloseTo(1080 * 0.88);
    expect(geometry.minSize).toBeLessThan(geometry.maxSize);
    expect(geometry.marginX * 2 + geometry.width).toBeCloseTo(1920);
  });
});

describe('contrastTextColor', () => {
  it('picks white on dark and black on light backgrounds', () => {
    expect(contrastTextColor('#000000')).toBe('#ffffff');
    expect(contrastTextColor('#1e3a5f')).toBe('#ffffff');
    expect(contrastTextColor('#ffffff')).toBe('#000000');
    expect(contrastTextColor('#ffe680')).toBe('#000000');
    expect(contrastTextColor('nonsense')).toBe('#ffffff');
  });
});

describe('wrapping passage text', () => {
  it('breaks Latin text between words', () => {
    // Half an em per character: nine characters to a 4.5 em line.
    expect(wrapText('one two three four', 4.5, measure)).toEqual(['one two', 'three', 'four']);
  });

  it('breaks Chinese text between characters, never before closing punctuation', () => {
    expect(wrapText('耶稣仍不回答，以致彼拉多', 3, measure)).toEqual([
      '耶稣仍',
      '不回',
      '答，以',
      '致彼拉',
      '多',
    ]);
  });

  it('keeps room for a verse number on the first line', () => {
    expect(wrapText('one two', 3.5, measure, 1)).toEqual(['one', 'two']);
    expect(wrapText('one two', 3.5, measure)).toEqual(['one two']);
  });

  it('breaks a word wider than a line where it must', () => {
    expect(wrapText('abcdefgh', 2, measure)).toEqual(['abcd', 'efgh']);
  });
});

describe('fitting a passage (P6.3, B24)', () => {
  const column = (credit: string, verses: string[]) => ({
    credit,
    units: verses.map((text, i) => ({ label: String(i + 1), lines: [{ text, indent: 0 }] })),
  });

  it('draws a short passage at 5 % of the height', () => {
    const fitted = fitPassage(
      [column('NIVUK', ['Jesus wept.']), column('CCB', ['耶稣哭了。'])],
      1920,
      1080,
      measure,
    );
    expect(fitted.fontSize).toBeCloseTo(1080 * PASSAGE_TARGET_RATIO);
    expect(fitted.columns.map((c) => c.credit)).toEqual(['NIVUK', 'CCB']);
    expect(fitted.columns[0]!.lines[0]).toEqual({
      text: 'Jesus wept.',
      label: '1',
      indent: 0,
      title: false,
    });
  });

  it('uses one size for both columns, the longer column deciding it', () => {
    const long = column(
      'CCB',
      Array.from({ length: 12 }, () => '字'.repeat(30)),
    );
    const short = column('NIVUK', ['Short.']);
    const fitted = fitPassage([short, long], 1920, 1080, measure);
    expect(fitted.fontSize).toBeLessThan(1080 * PASSAGE_TARGET_RATIO);
    const alone = fitPassage([short, column('CCB', ['短。'])], 1920, 1080, measure);
    expect(alone.fontSize).toBeGreaterThan(fitted.fontSize);
    // The short column is drawn at the long column's size.
    expect(fitted.columns).toHaveLength(2);
  });

  it('never goes below 4 % for a slide that fits there', () => {
    // Thirteen lines fit at 4 % and not at 5 %.
    const lines = Array.from({ length: 13 }, () => 'Short.');
    const fitted = fitPassage([column('A', lines), column('B', lines)], 1920, 1080, measure);
    expect(fitted.fontSize).toBeGreaterThanOrEqual(1080 * PASSAGE_FLOOR_RATIO - 0.1);
    expect(fitted.fontSize).toBeLessThanOrEqual(1080 * PASSAGE_TARGET_RATIO);
  });

  it('shrinks further only a slide that cannot fit at 4 %, so nothing is cut off', () => {
    const huge = column('A', [Array.from({ length: 2000 }, () => 'word').join(' ')]);
    const fitted = fitPassage([huge], 1920, 1080, measure);
    expect(fitted.fontSize).toBeLessThan(1080 * PASSAGE_FLOOR_RATIO);
    const height = fitted.columns[0]!.lines.length * fitted.fontSize * 1.5;
    expect(height).toBeLessThanOrEqual(fitted.areaHeight);
  });

  it('draws a single version across the whole width', () => {
    const fitted = fitPassage([column('NIVUK', ['Jesus wept.'])], 1920, 1080, measure);
    expect(fitted.gap).toBe(0);
    expect(fitted.columnWidth).toBeCloseTo(fitted.areaWidth);
  });
});
