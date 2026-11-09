/**
 * Reads what a volunteer types as a Bible reference (P1.3, B21), on the computer, with no
 * call to any provider: `Mark 15:5-6`, `mk15.5-6`, `马可福音15章5-6节`, `可１５：５`.
 */
import { BOOKS, BUILT_IN_NAMES, nameKey } from './books';
import { chapterReference, isWellFormed, verseReference, type Reference } from './reference';

export type ParseResult =
  /** A chapter or a range of verses. */
  | { kind: 'reference'; reference: Reference }
  /** A book alone, so the chapter grid can open. */
  | { kind: 'book'; book: string }
  /** A prefix several books share, in Bible order. */
  | { kind: 'books'; books: string[] }
  | { kind: 'none' };

/** Extra names for books, such as those of a version's table of contents. */
export interface BookNameEntry {
  book: string;
  name: string;
}

const NONE: ParseResult = { kind: 'none' };

/** Folds the separators volunteers use into `:` and `-`. */
function numbersOf(rest: string): string {
  return rest
    .replace(/^第/, '')
    .replace(/[章篇]/g, ':')
    .replace(/[节節]/g, '')
    .replace(/[–—~～至到]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*:\s*/g, ':')
    .trim()
    .replace(/[\s.,，:]+/g, ':')
    .replace(/[:-]+$/, '');
}

/** A name lookup with the built-in names and the extra ones, the built-in ones first. */
function lookup(names: readonly BookNameEntry[]): Map<string, string> {
  if (names.length === 0) return BUILT_IN_NAMES as Map<string, string>;
  const all = new Map(BUILT_IN_NAMES);
  for (const { book, name } of names) {
    const key = nameKey(name);
    if (key && !all.has(key)) all.set(key, book);
  }
  return all;
}

/** Books one of whose names begins with `key`, in Bible order. */
function booksStartingWith(key: string, names: Map<string, string>): string[] {
  const found = new Set<string>();
  for (const [name, book] of names) if (name.startsWith(key)) found.add(book);
  return BOOKS.map((book) => book.id).filter((id) => found.has(id));
}

export function parseReference(input: string, names: readonly BookNameEntry[] = []): ParseResult {
  const text = input.normalize('NFKC').trim().toLowerCase();
  if (!text) return NONE;
  // An optional book number, the name up to the first digit, then the numbers.
  const m = /^([1-3]\s*)?([^\d]+?)\s*(\d.*)?$/u.exec(text);
  if (!m) return NONE;
  const [, number = '', name = '', rest] = m;
  const key = nameKey(number + name);
  // A book's name has at least one letter: a number alone, or punctuation, is nothing.
  if (!/\p{L}/u.test(key)) return NONE;
  const all = lookup(names);

  let book = all.get(key);
  if (!book) {
    const candidates = booksStartingWith(key, all);
    if (candidates.length === 0) return NONE;
    if (candidates.length > 1) return { kind: 'books', books: candidates };
    book = candidates[0]!;
  }
  if (rest === undefined) return { kind: 'book', book };

  const numbers = numbersOf(rest);
  const n = /^(\d+)(?::(\d+)(?:-(?:(\d+):)?(\d+))?)?$/.exec(numbers);
  if (!n) return NONE;
  const [, chapterText, verseText, endChapterText, endVerseText] = n;
  const chapter = Number(chapterText);
  if (chapter < 1) return NONE;
  if (verseText === undefined)
    return { kind: 'reference', reference: chapterReference(book, chapter) };
  const verse = Number(verseText);
  if (verse < 1) return NONE;
  const reference = verseReference(book, chapter, verse, {
    chapter: endChapterText === undefined ? chapter : Number(endChapterText),
    verse: endVerseText === undefined ? verse : Number(endVerseText),
  });
  // A range written backwards is refused, never turned round.
  if (!isWellFormed(reference) || (reference.endVerse ?? 1) < 1) return NONE;
  return { kind: 'reference', reference };
}

/**
 * A reference the song search may offer (B9): a chapter or verses of a book named in full or
 * by a known abbreviation, never a guess from a prefix, so a song title is not taken for one.
 */
export function songSearchReference(
  input: string,
  names: readonly BookNameEntry[] = [],
): Reference | null {
  const result = parseReference(input, names);
  if (result.kind !== 'reference') return null;
  const text = input.normalize('NFKC').trim().toLowerCase();
  const m = /^([1-3]\s*)?([^\d]+?)\s*\d/u.exec(text);
  if (!m || !lookup(names).has(nameKey((m[1] ?? '') + m[2]))) return null;
  return result.reference;
}
