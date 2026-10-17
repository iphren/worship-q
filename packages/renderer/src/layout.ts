/**
 * Slideshow fitting and wrapping (decision D5).
 *
 * - One font size per song on an output: the largest at which every piece fits the safe
 *   area.
 * - With wrapping enabled, a source line too wide for the area is shown as two visual
 *   lines, never more. Wrapping never creates pieces or changes the lyrics.
 * - The song size never drops below a minimum; a piece that still does not fit at the
 *   minimum shrinks on its own.
 * - The scale slider multiplies the song size. A piece that no longer fits after scaling
 *   up shrinks on its own rather than overflowing.
 *
 * Text width is supplied by the caller as a function returning the width of a string in
 * em (its width at a font size of 1), so this module has no dependency on a browser.
 */

/** Width of `text` in em: its pixel width divided by the font size. */
export type Measure = (text: string) => number;

export interface FitArea {
  /** Safe-area width in pixels. */
  width: number;
  /** Safe-area height in pixels. */
  height: number;
}

export interface FitOptions extends FitArea {
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  /** Whether a long source line may be shown as two visual lines. */
  wrap: boolean;
  /** Smallest size used for the whole song. */
  minSize: number;
  /** Largest size, so that a short song is not shown absurdly large. */
  maxSize: number;
  /** Scale slider, 1 = automatic size. */
  scale: number;
}

export interface FittedPiece {
  fontSize: number;
  /** Visual lines, after any wrapping. */
  lines: string[];
}

export interface FittedSong {
  /** The size shared by every piece that fits at it. */
  fontSize: number;
  pieces: FittedPiece[];
}

const EPSILON = 1e-6;

const CLOSING = '，。、；：！？）】》」』’”…,.;:!?)]}%';
const OPENING = '（【《「『‘“([{';

function isWide(char: string): boolean {
  const code = char.codePointAt(0)!;
  return (
    (code >= 0x2e80 && code <= 0x9fff) || // CJK radicals, kana, ideographs
    (code >= 0xac00 && code <= 0xd7af) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xff00 && code <= 0xffef) || // full-width forms
    code >= 0x20000 // supplementary ideographs
  );
}

/**
 * Every way to show `text` as two visual lines. Lines break only at a space or at
 * punctuation, so Chinese text is never split in the middle of a phrase. A break at
 * punctuation needs a CJK character on one side, so Latin words such as "don’t" stay
 * whole; Latin text breaks at its spaces instead.
 */
export function breakCandidates(text: string): [string, string][] {
  const chars = Array.from(text);
  const candidates: [string, string][] = [];
  for (let i = 1; i < chars.length; i++) {
    const before = chars[i - 1]!;
    const after = chars[i]!;
    const atSpace = /\s/.test(before) && !/\s/.test(after);
    const atPunctuation =
      (isWide(before) || isWide(after)) &&
      !/\s/.test(before) &&
      !/\s/.test(after) &&
      (CLOSING.includes(before) || OPENING.includes(after)) &&
      !CLOSING.includes(after) &&
      !OPENING.includes(before);
    if (!atSpace && !atPunctuation) continue;
    const first = chars.slice(0, i).join('').trimEnd();
    const second = chars.slice(i).join('').trimStart();
    if (first && second) candidates.push([first, second]);
  }
  return candidates;
}

interface LineMetrics {
  text: string;
  /** Width of the whole line in em. */
  full: number;
  /** The most balanced two-line form, or null when the line cannot be broken. */
  split: { lines: [string, string]; width: number } | null;
}

function measureLine(raw: string, measure: Measure): LineMetrics {
  const text = raw.trimEnd();
  let split: LineMetrics['split'] = null;
  for (const lines of breakCandidates(text)) {
    const width = Math.max(measure(lines[0]), measure(lines[1]));
    if (!split || width < split.width - EPSILON) split = { lines, width };
  }
  return { text, full: measure(text), split };
}

/** Visual lines of a piece at `size`, or null when it does not fit the area. */
function layout(lines: LineMetrics[], size: number, options: FitOptions): string[] | null {
  const visual: string[] = [];
  for (const line of lines) {
    if (line.full * size <= options.width + EPSILON) {
      visual.push(line.text);
    } else if (options.wrap && line.split && line.split.width * size <= options.width + EPSILON) {
      visual.push(...line.split.lines);
    } else {
      return null;
    }
  }
  const height = visual.length * size * options.lineHeight;
  return height <= options.height + EPSILON ? visual : null;
}

/** The largest size, up to `ceiling`, at which the piece fits the area. */
function largestSize(lines: LineMetrics[], options: FitOptions, ceiling: number): number {
  if (layout(lines, ceiling, options)) return ceiling;
  let low = 0;
  let high = ceiling;
  for (let i = 0; i < 40 && high - low > 0.01; i++) {
    const middle = (low + high) / 2;
    if (layout(lines, middle, options)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * Lays out a single piece at the largest size no greater than `size` at which it fits.
 * If nothing fits (a degenerate area), the text is shown unwrapped at a tiny size.
 */
function fitPiece(lines: LineMetrics[], size: number, options: FitOptions): FittedPiece {
  const fontSize = largestSize(lines, options, size);
  const visual = fontSize > 0 ? layout(lines, fontSize, options) : null;
  return { fontSize, lines: visual ?? lines.map((line) => line.text) };
}

/**
 * Fits a whole song: `pieces` holds the source lines of each piece. Returns one layout per
 * piece, in the same order.
 */
export function fitSong(
  pieces: readonly string[][],
  options: FitOptions,
  measure: Measure,
): FittedSong {
  const metrics = pieces.map((piece) => piece.map((line) => measureLine(line, measure)));
  const ceilings = metrics.map((lines) => largestSize(lines, options, options.maxSize));
  const automatic = Math.max(options.minSize, Math.min(options.maxSize, ...ceilings));
  const fontSize = automatic * options.scale;
  return {
    fontSize,
    pieces: metrics.map((lines) => fitPiece(lines, fontSize, options)),
  };
}

export interface OutputGeometry extends FitOptions {
  /** Margin kept clear on the left and right, in pixels. */
  marginX: number;
  /** Margin kept clear on the top and bottom, in pixels. */
  marginY: number;
}

export const LINE_HEIGHT = 1.3;
/** Fraction of each dimension kept clear around the lyrics. */
export const SAFE_MARGIN = 0.06;
/** Minimum and maximum song sizes as fractions of the output height. */
export const MIN_SIZE_RATIO = 0.035;
export const MAX_SIZE_RATIO = 0.12;

/** The fitting options for an output of the given pixel size. */
export function outputGeometry(
  width: number,
  height: number,
  settings: { wrap: boolean; scale: number },
): OutputGeometry {
  const marginX = width * SAFE_MARGIN;
  const marginY = height * SAFE_MARGIN;
  return {
    width: width - marginX * 2,
    height: height - marginY * 2,
    marginX,
    marginY,
    lineHeight: LINE_HEIGHT,
    wrap: settings.wrap,
    minSize: height * MIN_SIZE_RATIO,
    maxSize: height * MAX_SIZE_RATIO,
    scale: settings.scale,
  };
}

/** Black or white, whichever reads better on a solid `#rrggbb` background. */
export function contrastTextColor(background: string): '#000000' | '#ffffff' {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background);
  if (!match) return '#ffffff';
  const [r, g, b] = match.slice(1).map((hex) => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#000000' : '#ffffff';
}
