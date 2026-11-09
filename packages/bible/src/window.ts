/**
 * The Bible window's state (P4.2, B2, B3), on the desktop and on phones: one selection that
 * the search box, the breadcrumb and the grids all show. Typing moves the grids on; clicking writes the reference into the
 * box. Pure, so every rule is tested without the window.
 */
import { bookName, type BibleLanguage } from './books';
import { parseReference } from './parse';
import { chapterReference, formatReference, verseReference, type Reference } from './reference';
import { chapterVerses, nextChapter, tocBook, tocNames, validate, type Toc } from './toc';

export type GridLevel = 'books' | 'chapters' | 'verses';

export interface VersePoint {
  chapter: number;
  verse: number;
}

export interface BibleWindowState {
  input: string;
  level: GridLevel;
  book: string | null;
  /** The chapter whose verses the grid shows. */
  chapter: number | null;
  /** The first verse chosen, and the last once chosen; null with nothing chosen. */
  first: VersePoint | null;
  last: VersePoint | null;
  /** Books a typed prefix shares, shown in place of the whole list. */
  candidates: string[] | null;
  /** The typed text is not a reference: searched for as words, after a pause. */
  searchText: string | null;
}

export const INITIAL: BibleWindowState = {
  input: '',
  level: 'books',
  book: null,
  chapter: null,
  first: null,
  last: null,
  candidates: null,
  searchText: null,
};

/** Where the window opens: empty, or on a reference such as an item being edited. */
export function openAt(
  reference: Reference | null,
  toc: Toc | null,
  language: BibleLanguage,
): BibleWindowState {
  if (!reference) return INITIAL;
  return fromReference(reference, toc, language);
}

function fromReference(
  reference: Reference,
  _toc: Toc | null,
  language: BibleLanguage,
  input = formatReference(reference, language),
): BibleWindowState {
  const verses = reference.verse !== null;
  return {
    input,
    level: 'verses',
    book: reference.book,
    chapter: verses ? reference.endChapter : reference.chapter,
    first: verses ? { chapter: reference.chapter, verse: reference.verse! } : null,
    last: verses ? { chapter: reference.endChapter, verse: reference.endVerse! } : null,
    candidates: null,
    searchText: null,
  };
}

/** Typing: the grids follow what the text says, and a text that is no reference is searched. */
export function typed(input: string, toc: Toc | null): BibleWindowState {
  const result = parseReference(input, toc ? tocNames(toc) : []);
  const base = { ...INITIAL, input };
  switch (result.kind) {
    case 'none':
      return { ...base, searchText: input.trim() ? input.trim() : null };
    case 'books':
      return { ...base, candidates: result.books };
    case 'book':
      return { ...base, level: 'chapters', book: result.book };
    case 'reference': {
      const { reference } = result;
      if (reference.verse === null) {
        // A chapter: its verses, with nothing chosen yet.
        return { ...base, level: 'verses', book: reference.book, chapter: reference.chapter };
      }
      return {
        ...base,
        level: 'verses',
        book: reference.book,
        chapter: reference.endChapter,
        first: { chapter: reference.chapter, verse: reference.verse },
        last: { chapter: reference.endChapter, verse: reference.endVerse! },
      };
    }
  }
}

/** The box's text for a selection, in the first version's language. */
function inputFor(state: BibleWindowState, language: BibleLanguage): string {
  const reference = selectedReference(state);
  if (reference) return formatReference(reference, language);
  if (state.book && state.chapter) return `${bookName(state.book, language)} ${state.chapter}`;
  if (state.book) return bookName(state.book, language);
  return '';
}

export function pickBook(
  _state: BibleWindowState,
  book: string,
  language: BibleLanguage,
): BibleWindowState {
  const next = { ...INITIAL, level: 'chapters' as const, book };
  return { ...next, input: inputFor(next, language) };
}

export function pickChapter(
  state: BibleWindowState,
  chapter: number,
  language: BibleLanguage,
): BibleWindowState {
  if (!state.book) return state;
  const next = { ...INITIAL, level: 'verses' as const, book: state.book, chapter };
  return { ...next, input: inputFor(next, language) };
}

const before = (a: VersePoint, b: VersePoint) =>
  a.chapter < b.chapter || (a.chapter === b.chapter && a.verse < b.verse);

/**
 * Choosing a verse, as in a date-range picker (B3): the first click chooses the first verse,
 * the second the last, in either order; the same verse twice is that verse alone; a click
 * after a range starts again. `verse` is the first verse of a joined cell.
 */
export function pickVerse(
  state: BibleWindowState,
  verse: number,
  language: BibleLanguage,
): BibleWindowState {
  if (!state.book || !state.chapter) return state;
  const point = { chapter: state.chapter, verse };
  let next: BibleWindowState;
  if (!state.first || state.last) {
    next = { ...state, first: point, last: null };
  } else {
    const [a, b] = before(point, state.first) ? [point, state.first] : [state.first, point];
    next = { ...state, first: a, last: b };
  }
  next = { ...next, candidates: null, searchText: null };
  return { ...next, input: inputFor(next, language) };
}

/**
 * Carries on into the next chapter, for a range across chapters (B3): the verses chosen so
 * far stay, and the next verse chosen there ends the range.
 */
export function continueToNextChapter(
  state: BibleWindowState,
  toc: Toc,
  language: BibleLanguage,
): BibleWindowState {
  if (!state.book || !state.chapter || !state.first) return state;
  const next = nextChapter(toc, state.book, state.chapter);
  if (next === null) return state;
  const moved = { ...state, chapter: next, last: null };
  return { ...moved, input: inputFor({ ...moved, last: state.first }, language) };
}

/** Whether a range can carry on into the next chapter from here. */
export function canContinue(state: BibleWindowState, toc: Toc | null): boolean {
  return (
    !!toc &&
    !!state.book &&
    !!state.chapter &&
    !!state.first &&
    state.level === 'verses' &&
    nextChapter(toc, state.book, state.chapter) !== null
  );
}

/** The breadcrumb: back to the book list, a book's chapters, or a chapter's verses. */
export function backTo(
  state: BibleWindowState,
  level: GridLevel,
  language: BibleLanguage,
): BibleWindowState {
  if (level === 'books') return INITIAL;
  if (level === 'chapters') return state.book ? pickBook(state, state.book, language) : INITIAL;
  return state.book && state.chapter ? pickChapter(state, state.chapter, language) : state;
}

/**
 * The reference the window would add or present: the verses chosen (one, while only the
 * first is), or the whole chapter when none is.
 */
export function selectedReference(state: BibleWindowState): Reference | null {
  if (!state.book) return null;
  if (state.first) {
    const last = state.last ?? state.first;
    return verseReference(state.book, state.first.chapter, state.first.verse, {
      chapter: last.chapter,
      verse: last.verse,
    });
  }
  if (state.chapter) return chapterReference(state.book, state.chapter);
  return null;
}

/** Whether a verse is in the chosen range, for the grid's highlight. */
export function isSelected(state: BibleWindowState, chapter: number, verse: number): boolean {
  if (!state.first) return false;
  const last = state.last ?? state.first;
  const at = { chapter, verse };
  return !before(at, state.first) && !before(last, at);
}

/** What the window says of the reference in the first version: fine, or why not (B20). */
export type ReferenceCheck =
  | { kind: 'ok'; reference: Reference }
  /** Its verses are not known on this computer yet; they are fetched. */
  | { kind: 'loading'; reference: Reference }
  | { kind: 'no-book'; book: string }
  /** Psalm 151: not in the version; the nearest chapter is offered. */
  | { kind: 'no-chapter'; book: string; chapter: number; nearest: number }
  | { kind: 'no-verse'; reference: Reference; chapter: number; verses: number }
  | { kind: 'none' };

export function checkReference(state: BibleWindowState, toc: Toc | null): ReferenceCheck {
  const reference =
    selectedReference(state) ??
    (state.book && state.chapter ? chapterReference(state.book, state.chapter) : null);
  if (!reference) {
    if (state.book && toc && !tocBook(toc, state.book))
      return { kind: 'no-book', book: state.book };
    return { kind: 'none' };
  }
  if (!toc) return { kind: 'loading', reference };
  const result = validate(reference, toc);
  if (result.ok === true) return { kind: 'ok', reference };
  if (result.ok === 'unknown') return { kind: 'loading', reference };
  switch (result.missing) {
    case 'book':
      return { kind: 'no-book', book: reference.book };
    case 'chapter':
      return {
        kind: 'no-chapter',
        book: reference.book,
        chapter: result.chapter,
        nearest: result.chapters,
      };
    case 'verse':
      return { kind: 'no-verse', reference, chapter: result.chapter, verses: result.verses };
  }
}

/** The verse grid's cells for the chapter shown, or null when they are not known yet. */
export function verseCells(state: BibleWindowState, toc: Toc | null) {
  if (!toc || !state.book || !state.chapter) return null;
  const cells = chapterVerses(toc, state.book, state.chapter);
  return cells && cells.length > 0 ? cells : null;
}

/**
 * A reference for a second version, trimmed to the verses that version has: a range past the
 * end of its chapter stops there, so its column shows what it has and the missing verse is
 * warned of rather than refused (B14). Null when the version has none of it.
 */
export function referenceInVersion(reference: Reference, toc: Toc | null): Reference | null {
  if (!toc) return reference;
  const entry = tocBook(toc, reference.book);
  if (!entry) return null;
  if (reference.chapter > entry.chapters.length) return null;
  if (reference.verse === null) return reference;
  const endChapter = Math.min(reference.endChapter, entry.chapters.length);
  const count = entry.chapters[endChapter - 1];
  let endVerse =
    endChapter < reference.endChapter ? (count ?? reference.endVerse!) : reference.endVerse!;
  if (count !== null && count !== undefined) endVerse = Math.min(endVerse, count);
  const startCount = entry.chapters[reference.chapter - 1];
  if (startCount !== null && startCount !== undefined && reference.verse > startCount) return null;
  const trimmed = verseReference(reference.book, reference.chapter, reference.verse, {
    chapter: endChapter,
    verse: endVerse,
  });
  return endChapter > reference.chapter || endVerse >= reference.verse ? trimmed : null;
}
