/**
 * A Bible reference as Worship Q stores it (P1.2, B23): a USFM book, a chapter, and either
 * the whole chapter or a verse range, which may run into a later chapter.
 */
import { z } from 'zod';
import { bookById, bookName, type BibleLanguage } from './books';

const Positive = z.number().int().min(1);

export interface Reference {
  /** USFM book code. */
  book: string;
  chapter: number;
  /** Null for the whole chapter. */
  verse: number | null;
  /** The last chapter; the same as `chapter` unless the range runs on. */
  endChapter: number;
  /** The last verse; null for the whole chapter. */
  endVerse: number | null;
}

/** Whether a reference's parts make sense together: in order, and whole chapters whole. */
export function isWellFormed(reference: Reference): boolean {
  const { book, chapter, verse, endChapter, endVerse } = reference;
  if (!bookById(book)) return false;
  if (verse === null || endVerse === null) {
    return verse === null && endVerse === null && endChapter === chapter;
  }
  if (endChapter < chapter) return false;
  return endChapter > chapter || endVerse >= verse;
}

export const ReferenceSchema = z
  .object({
    book: z.string().min(1),
    chapter: Positive,
    verse: Positive.nullable(),
    endChapter: Positive,
    endVerse: Positive.nullable(),
  })
  .refine(isWellFormed, 'Not a well-formed reference');

/** The whole of a chapter. */
export function chapterReference(book: string, chapter: number): Reference {
  return { book, chapter, verse: null, endChapter: chapter, endVerse: null };
}

/** A range of verses; one verse when `end` is left out. */
export function verseReference(
  book: string,
  chapter: number,
  verse: number,
  end: { chapter?: number; verse: number } = { verse },
): Reference {
  return { book, chapter, verse, endChapter: end.chapter ?? chapter, endVerse: end.verse };
}

export function isWholeChapter(reference: Reference): boolean {
  return reference.verse === null;
}

export function sameReference(a: Reference, b: Reference): boolean {
  return toUsfm(a) === toUsfm(b);
}

/**
 * The reference as USFM: `MRK.15` for a chapter, `MRK.15.5` for a verse, and
 * `MRK.15.5-MRK.15.6` for a range, the form every provider that takes ranges accepts.
 */
export function toUsfm(reference: Reference): string {
  const { book, chapter, verse, endChapter, endVerse } = reference;
  if (verse === null) return `${book}.${chapter}`;
  const start = `${book}.${chapter}.${verse}`;
  if (endChapter === chapter && endVerse === verse) return start;
  return `${start}-${book}.${endChapter}.${endVerse}`;
}

/**
 * Reads a USFM reference: `MRK.15`, `MRK.15.5`, `MRK.15.5-6`, `MRK.15.5-MRK.15.6`,
 * `GEN.1.31-2.3`. Null when it is not one, or names an unknown book, or runs backwards.
 */
export function fromUsfm(usfm: string): Reference | null {
  const m =
    /^([1-3A-Z][A-Z0-9]{2})\.(\d+)(?:\.(\d+)(?:-(?:(?:([1-3A-Z][A-Z0-9]{2})\.)?(\d+)\.)?(\d+))?)?$/.exec(
      usfm.trim(),
    );
  if (!m) return null;
  const [, book, chapterText, verseText, endBook, endChapterText, endVerseText] = m;
  if (endBook && endBook !== book) return null;
  const chapter = Number(chapterText);
  const reference: Reference =
    verseText === undefined
      ? chapterReference(book!, chapter)
      : verseReference(book!, chapter, Number(verseText), {
          chapter: endChapterText ? Number(endChapterText) : chapter,
          verse: Number(endVerseText ?? verseText),
        });
  if (chapter < 1 || (reference.verse !== null && reference.verse < 1)) return null;
  return isWellFormed(reference) ? reference : null;
}

/**
 * The reference as a slide or run sheet shows it: `Mark 15:5–6`, `Genesis 1:31–2:3`,
 * `Psalms 23`, or in Chinese `马可福音 15:5-6`.
 */
export function formatReference(reference: Reference, language: BibleLanguage = 'en'): string {
  const name = bookName(reference.book, language);
  const dash = language === 'en' ? '–' : '-';
  const { chapter, verse, endChapter, endVerse } = reference;
  let numbers: string;
  if (verse === null) numbers = String(chapter);
  else if (endChapter !== chapter) numbers = `${chapter}:${verse}${dash}${endChapter}:${endVerse}`;
  else if (endVerse !== verse) numbers = `${chapter}:${verse}${dash}${endVerse}`;
  else numbers = `${chapter}:${verse}`;
  // A single psalm reads "Psalm 23" in English.
  const shown =
    language === 'en' && reference.book === 'PSA' && endChapter === chapter ? 'Psalm' : name;
  return `${shown} ${numbers}`;
}

/** Whether a verse lies within a reference. A whole chapter holds every verse of it. */
export function inReference(reference: Reference, chapter: number, verse: number): boolean {
  if (reference.verse === null) return chapter === reference.chapter;
  const at = chapter * 10_000 + verse;
  return (
    at >= reference.chapter * 10_000 + reference.verse &&
    at <= reference.endChapter * 10_000 + reference.endVerse!
  );
}
