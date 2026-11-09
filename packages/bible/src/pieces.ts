/**
 * Splits a passage into slides by a fixed text budget (B10, B24), so every screen and phone
 * has the same slides: whole rows are packed while each column's estimated lines stay within
 * the budget. The renderer then sizes the text to fit.
 */
import type { Aligned, AlignedRow } from './align';
import type { PassageLine } from './passage';

export interface PassageBudget {
  /** Estimated lines per column. */
  lines: number;
  /** Characters per line, for Latin text and for wide (Chinese) characters. */
  latin: number;
  wide: number;
}

/** Spike P0.3: text at 5 % of the height, 11 lines fit, one kept spare. */
export const SIDE_BY_SIDE_BUDGET: PassageBudget = { lines: 10, latin: 30, wide: 12 };
export const SINGLE_BUDGET: PassageBudget = { lines: 10, latin: 55, wide: 25 };

export function budgetFor(versions: number): PassageBudget {
  return versions > 1 ? SIDE_BY_SIDE_BUDGET : SINGLE_BUDGET;
}

/** Whether a character takes about two Latin characters' width: CJK, kana, Hangul, full-width. */
export function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** How many lines a line of text is estimated to wrap to: each character by its width. */
export function estimateLines(text: string, budget: PassageBudget): number {
  let width = 0;
  for (const char of text)
    width += isWide(char.codePointAt(0)!) ? 1 / budget.wide : 1 / budget.latin;
  return Math.max(1, Math.ceil(width - 1e-9));
}

/** A column's lines for one row, the verse label counted on the first. */
function cellLines(row: AlignedRow, column: number, budget: PassageBudget): number {
  let total = 0;
  for (const unit of row.cells[column] ?? []) {
    unit.lines.forEach((line, i) => {
      total += estimateLines(
        i === 0 && unit.label ? `${unit.label} ${line.text}` : line.text,
        budget,
      );
    });
  }
  return total;
}

/** One column of a slide: a version's units for the slide's verses, and its credit. */
export interface PassageColumn {
  version: string;
  credit: string;
  units: { label: string; title?: boolean; lines: PassageLine[] }[];
}

export interface PassagePiece {
  /** Stable from the verse numbers of its first row (`v16:12`, or `title`). */
  id: string;
  rows: AlignedRow[];
  columns: PassageColumn[];
}

function piece(aligned: Aligned, rows: AlignedRow[]): PassagePiece {
  return {
    id: rows[0]!.key === 'title' ? 'title' : `v${rows[0]!.key}`,
    rows,
    columns: aligned.versions.map((version, index) => ({
      version,
      credit: aligned.credits[index]!,
      units: rows.flatMap((row) =>
        (row.cells[index] ?? []).map((unit) => ({
          label: unit.label,
          ...(unit.title ? { title: true } : {}),
          lines: unit.lines,
        })),
      ),
    })),
  };
}

/**
 * The passage's slides: whole rows, never a joined unit split, the longer column deciding
 * where a slide ends; a row over the budget by itself is a slide of its own.
 */
export function passagePieces(
  aligned: Aligned,
  budget: PassageBudget = budgetFor(aligned.versions.length),
): PassagePiece[] {
  const pieces: PassagePiece[] = [];
  let rows: AlignedRow[] = [];
  let used = aligned.versions.map(() => 0);
  for (const row of aligned.rows) {
    const sizes = aligned.versions.map((_, column) => cellLines(row, column, budget));
    const fits = sizes.every((size, column) => used[column]! + size <= budget.lines);
    if (rows.length > 0 && !fits) {
      pieces.push(piece(aligned, rows));
      rows = [];
      used = used.map(() => 0);
    }
    rows.push(row);
    used = used.map((total, column) => total + sizes[column]!);
  }
  if (rows.length > 0) pieces.push(piece(aligned, rows));
  return pieces;
}
