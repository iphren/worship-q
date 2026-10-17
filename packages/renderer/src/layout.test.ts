import { describe, expect, it } from 'vitest';
import {
  breakCandidates,
  contrastTextColor,
  fitSong,
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
