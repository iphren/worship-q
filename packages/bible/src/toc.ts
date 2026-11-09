/**
 * A version's table of contents in the compact form of B20: its books with the version's own
 * names, a verse count per chapter, and joined and missing verses as exceptions. About 7 KB
 * for a whole Bible, so desktops keep a copy and the grids need no network (P1.4).
 */
import { z } from 'zod';
import { BOOKS } from './books';
import type { BookNameEntry } from './parse';
import type { Reference } from './reference';

export const TocBookSchema = z.object({
  /** USFM code. */
  book: z.string().min(1),
  /** The version's own name for the book, such as `马可福音`. */
  name: z.string(),
  /** The version's own abbreviation, when it has one. */
  abbreviation: z.string().optional(),
  /**
   * The last verse number of each chapter, from chapter 1. Null for a chapter whose verses
   * are not known yet: the server fetches them the first time the chapter is opened.
   */
  chapters: z.array(z.number().int().min(0).nullable()),
  /** Verses printed as one: `[chapter, first, last]`, such as `[16, 12, 13]`. */
  joined: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()])).optional(),
  /** Verse numbers the version leaves out, within its count: `[chapter, verse]`. */
  missing: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
});
export type TocBook = z.infer<typeof TocBookSchema>;

export const TocSchema = z.object({
  /** Worship Q's version id. */
  version: z.string().min(1),
  books: z.array(TocBookSchema),
});
export type Toc = z.infer<typeof TocSchema>;

export function tocBook(toc: Toc, book: string): TocBook | undefined {
  return toc.books.find((entry) => entry.book === book);
}

/** One cell of a verse grid: a verse, or a group the version prints as one. */
export interface VerseCell {
  /** The first verse of the cell. */
  verse: number;
  /** The last verse; the same as `verse` unless the version joins verses here. */
  last: number;
  label: string;
}

/**
 * The verses of a chapter as the version numbers them, joined ones as one cell and missing
 * ones left out. Null when the chapter does not exist; an empty list when its verses are not
 * known yet.
 */
export function chapterVerses(toc: Toc, book: string, chapter: number): VerseCell[] | null {
  const entry = tocBook(toc, book);
  if (!entry || chapter < 1 || chapter > entry.chapters.length) return null;
  const count = entry.chapters[chapter - 1];
  if (count === null || count === undefined) return [];
  const missing = new Set(
    (entry.missing ?? []).filter(([c]) => c === chapter).map(([, verse]) => verse),
  );
  const joins = (entry.joined ?? []).filter(([c]) => c === chapter);
  const cells: VerseCell[] = [];
  for (let verse = 1; verse <= count; verse++) {
    if (missing.has(verse)) continue;
    const join = joins.find(([, first, last]) => verse >= first && verse <= last);
    if (join) {
      const [, first, last] = join;
      if (verse === first) cells.push({ verse: first, last, label: `${first}-${last}` });
      continue;
    }
    cells.push({ verse, last: verse, label: String(verse) });
  }
  return cells;
}

/** The chapter after this one in the same book, or null at the book's end. */
export function nextChapter(toc: Toc, book: string, chapter: number): number | null {
  const entry = tocBook(toc, book);
  return entry && chapter >= 1 && chapter < entry.chapters.length ? chapter + 1 : null;
}

export type Validation =
  | { ok: true }
  /** A chapter's verses are not known here yet; the server checks it when it fetches. */
  | { ok: 'unknown'; chapter: number }
  | { ok: false; missing: 'book' }
  | { ok: false; missing: 'chapter'; chapter: number; chapters: number }
  | { ok: false; missing: 'verse'; chapter: number; verse: number; verses: number };

/**
 * Whether a reference exists in the version: its book, its chapters, and its first and last
 * verses. Nothing is ever clamped: Psalm 151 is refused, not turned into Psalm 150.
 */
export function validate(reference: Reference, toc: Toc): Validation {
  const entry = tocBook(toc, reference.book);
  if (!entry || entry.chapters.length === 0) return { ok: false, missing: 'book' };
  const chapters = entry.chapters.length;
  for (const chapter of [reference.chapter, reference.endChapter]) {
    if (chapter > chapters) return { ok: false, missing: 'chapter', chapter, chapters };
  }
  if (reference.verse === null) return { ok: true };
  const ends: [number, number][] = [
    [reference.chapter, reference.verse],
    [reference.endChapter, reference.endVerse!],
  ];
  for (const [chapter, verse] of ends) {
    const count = entry.chapters[chapter - 1];
    if (count === null || count === undefined) return { ok: 'unknown', chapter };
    if (verse > count) return { ok: false, missing: 'verse', chapter, verse, verses: count };
  }
  return { ok: true };
}

/** The version's own book names and abbreviations, for the parser (B21). */
export function tocNames(toc: Toc): BookNameEntry[] {
  return toc.books.flatMap((entry) =>
    [entry.name, entry.abbreviation]
      .filter((name): name is string => !!name)
      .map((name) => ({ book: entry.book, name })),
  );
}

/** The books of a table of contents in Bible order, unknown codes left out. */
export function tocInBibleOrder(toc: Toc): TocBook[] {
  return BOOKS.map((book) => tocBook(toc, book.id)).filter(
    (entry): entry is TocBook => entry !== undefined,
  );
}
