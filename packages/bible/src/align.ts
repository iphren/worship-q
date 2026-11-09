/**
 * Keeps two versions in step (B13, B14, B16): rows of verses, each holding every version's
 * units for those verses. A verse one version joins to the next makes one row of both, so a
 * slide never breaks inside it; a verse a version lacks leaves its cell empty, and the
 * operator is told (never the audience).
 */
import { bookName } from './books';
import { inReference, type Reference } from './reference';
import { passageReference, type Passage, type PassageUnit } from './passage';

export interface AlignedRow {
  /** Stable from the verse numbers: `16:12`, or `title`. */
  key: string;
  /** Every verse the row covers, as `[chapter, verse]`, in order; empty for a title row. */
  verses: [number, number][];
  /** Each version's units for the row, in the passage's version order; empty when it has none. */
  cells: PassageUnit[][];
}

export type AlignWarning =
  /** A version prints these verses as one. */
  | {
      kind: 'joined';
      version: string;
      credit: string;
      chapter: number;
      verses: number[];
      label: string;
    }
  /** A version has no such verse, where another has it. */
  | { kind: 'missing'; version: string; credit: string; chapter: number; verses: number[] };

export interface Aligned {
  reference: Reference;
  /** Version ids, in column order. */
  versions: string[];
  credits: string[];
  rows: AlignedRow[];
  warnings: AlignWarning[];
}

const at = (chapter: number, verse: number) => chapter * 10_000 + verse;

/** Whether a unit has any verse within the reference; a joined unit cut by it counts. */
function touches(reference: Reference, unit: PassageUnit): boolean {
  return unit.verses.some((verse) => inReference(reference, unit.chapter, verse));
}

/** Whether a psalm's title belongs: the range starts at verse 1 or is the whole chapter. */
function titleBelongs(reference: Reference, unit: PassageUnit): boolean {
  return unit.chapter === reference.chapter && (reference.verse === null || reference.verse === 1);
}

export function align(passage: Passage): Aligned {
  const reference = passageReference(passage);
  if (!reference) throw new Error(`Not a reference: ${passage.reference}`);
  const texts = passage.texts;
  const versions = texts.map((text) => text.version);
  const credits = texts.map((text) => text.credit);

  // Units within the reference. A joined unit the range cuts is kept whole (B13): the
  // provider sends the whole unit, and it is never trimmed here.
  const kept = texts.map((text) =>
    text.units.filter((unit) =>
      unit.title
        ? titleBelongs(reference, unit)
        : unit.verses.length > 0 && touches(reference, unit),
    ),
  );

  // Verses joined in any version fall in one row: union-find over verse positions.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const add = (x: number) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  for (const units of kept) {
    for (const unit of units) {
      if (unit.title) continue;
      const positions = unit.verses.map((verse) => at(unit.chapter, verse));
      positions.forEach(add);
      for (const p of positions.slice(1)) {
        const a = find(positions[0]!);
        const b = find(p);
        if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const position of [...parent.keys()].sort((a, b) => a - b)) {
    const root = find(position);
    groups.set(root, [...(groups.get(root) ?? []), position]);
  }

  const rows: AlignedRow[] = [];
  const titles = kept.map((units) => units.filter((unit) => unit.title));
  if (titles.some((cell) => cell.length > 0))
    rows.push({ key: 'title', verses: [], cells: titles });
  for (const [root, positions] of [...groups].sort(([a], [b]) => a - b)) {
    const cells = kept.map((units) =>
      units.filter((unit) => !unit.title && find(at(unit.chapter, unit.verses[0]!)) === root),
    );
    rows.push({
      key: `${Math.floor(root / 10_000)}:${root % 10_000}`,
      verses: positions.map((p) => [Math.floor(p / 10_000), p % 10_000]),
      cells,
    });
  }

  const warnings: AlignWarning[] = [];
  kept.forEach((units, index) => {
    for (const unit of units) {
      if (!unit.title && unit.verses.length > 1) {
        warnings.push({
          kind: 'joined',
          version: versions[index]!,
          credit: credits[index]!,
          chapter: unit.chapter,
          verses: unit.verses,
          label: unit.label,
        });
      }
    }
  });
  // With one version there is nothing to line up, and so nothing missing (§3.2).
  if (texts.length > 1) {
    kept.forEach((_, index) => {
      for (const row of rows) {
        if (row.key === 'title' || row.cells[index]!.length > 0) continue;
        if (!row.cells.some((cell) => cell.length > 0)) continue;
        const chapter = row.verses[0]![0];
        warnings.push({
          kind: 'missing',
          version: versions[index]!,
          credit: credits[index]!,
          chapter,
          verses: row.verses.filter(([c]) => c === chapter).map(([, verse]) => verse),
        });
      }
    });
  }
  return { reference, versions, credits, rows, warnings };
}

/**
 * A warning as the operator reads it (B16): `当代译本 joins verses 12–13`,
 * `NIVUK has no Revelation 12:18`.
 */
export function describeWarning(warning: AlignWarning, book: string): string {
  const first = warning.verses[0];
  const last = warning.verses[warning.verses.length - 1];
  const span = first === last ? `${first}` : `${first}–${last}`;
  if (warning.kind === 'joined') return `${warning.credit} joins verses ${warning.chapter}:${span}`;
  return `${warning.credit} has no ${bookName(book, 'en')} ${warning.chapter}:${span}`;
}
