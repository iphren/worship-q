/**
 * Words searched on the server, for versions only the Free Use Bible API serves (和合本, BSB,
 * KJV): their licences allow keeping the whole text, which no provider searches. The whole
 * version is fetched once, the first time it is searched, and kept in the data folder.
 *
 * A quote is matched with its punctuation, spaces and case set aside, so `神爱世人，甚至`
 * finds John 3:16, and may run across verses within a chapter. When the exact words are not
 * found, verses holding every word typed come after.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FreeUseContent } from './providers/normalise';

/** A chapter as kept: each verse's number and its text, notes left out. */
interface KeptChapter {
  book: string;
  chapter: number;
  verses: [number, string][];
}

export interface Kept {
  id: string;
  chapters: KeptChapter[];
}

/** The Free Use Bible API's `complete.json`, as much of it as is read. */
export interface FreeUseComplete {
  books?: {
    id?: string;
    chapters?: { chapter?: { number?: number; content?: FreeUseContent[] } }[];
  }[];
}

/** A chapter ready to search: its words run together, and where each verse starts. */
export interface Indexed {
  book: string;
  chapter: number;
  numbers: number[];
  starts: number[];
  /** Each verse alone, to find a verse holding every word typed. */
  verses: string[];
  joined: string;
}

const MAX_RESULTS = 20;

/** Letters and digits only, lower case: punctuation, spaces and notes never decide a match. */
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Reduces the API's whole version to verse numbers and plain text. */
export function keep(id: string, complete: FreeUseComplete): Kept {
  const chapters: KeptChapter[] = [];
  for (const book of complete.books ?? []) {
    if (!book.id) continue;
    for (const entry of book.chapters ?? []) {
      const chapter = entry.chapter?.number;
      if (!chapter) continue;
      const verses: [number, string][] = [];
      for (const part of entry.chapter?.content ?? []) {
        if (part.type !== 'verse' || part.number === undefined) continue;
        const text = (part.content ?? [])
          .map((piece) => (typeof piece === 'string' ? piece : (piece.text ?? '')))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        verses.push([part.number, text]);
      }
      if (verses.length > 0) chapters.push({ book: book.id, chapter, verses });
    }
  }
  return { id, chapters };
}

export function indexText(kept: Kept): Indexed[] {
  return kept.chapters.map(({ book, chapter, verses }) => {
    const numbers: number[] = [];
    const starts: number[] = [];
    const texts: string[] = [];
    let joined = '';
    for (const [number, text] of verses) {
      numbers.push(number);
      starts.push(joined.length);
      const words = normalise(text);
      texts.push(words);
      joined += words;
    }
    return { book, chapter, numbers, starts, verses: texts, joined };
  });
}

/** The index of the verse holding the character at `at`. */
function verseAt(chapter: Indexed, at: number): number {
  let i = 0;
  while (i + 1 < chapter.starts.length && chapter.starts[i + 1]! <= at) i++;
  return i;
}

/**
 * A quote running across verses counts only with at least this many characters in each, so
 * `爱世人` does not find the end of one verse (`…相爱`) and the start of the next (`世人…`).
 */
const MIN_ACROSS = 3;

/**
 * USFM references for the quote: the exact words within one verse first, then across verses,
 * then verses holding every word.
 */
export function searchText(chapters: Indexed[], query: string): string[] {
  const phrase = normalise(query);
  if (!phrase) return [];
  const found: string[] = [];
  const across: string[] = [];
  const add = (usfm: string) => {
    if (found.length < MAX_RESULTS && !found.includes(usfm)) found.push(usfm);
  };
  for (const chapter of chapters) {
    let at = chapter.joined.indexOf(phrase);
    while (at !== -1 && found.length < MAX_RESULTS) {
      const end = at + phrase.length;
      const first = verseAt(chapter, at);
      const last = verseAt(chapter, end - 1);
      const start = `${chapter.book}.${chapter.chapter}.${chapter.numbers[first]}`;
      if (first === last) add(start);
      else if (
        chapter.starts[first + 1]! - at >= MIN_ACROSS &&
        end - chapter.starts[last]! >= MIN_ACROSS
      ) {
        across.push(`${start}-${chapter.numbers[last]}`);
      }
      at = chapter.joined.indexOf(phrase, at + 1);
    }
    if (found.length >= MAX_RESULTS) return found;
  }
  across.forEach(add);
  const words = query
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalise)
    .filter(Boolean);
  if (words.length < 2) return found;
  for (const chapter of chapters) {
    chapter.verses.forEach((verse, i) => {
      if (found.length < MAX_RESULTS && words.every((word) => verse.includes(word))) {
        add(`${chapter.book}.${chapter.chapter}.${chapter.numbers[i]}`);
      }
    });
    if (found.length >= MAX_RESULTS) break;
  }
  return found;
}

export class LocalText {
  private readonly ready = new Map<string, Indexed[]>();
  private readonly loading = new Map<string, Promise<Indexed[]>>();

  /**
   * @param dir where whole versions are kept; none keeps them in memory only.
   * @param download fetches a version whole.
   */
  constructor(
    private readonly dir: string | null,
    private readonly download: (id: string) => Promise<FreeUseComplete>,
  ) {}

  private file(id: string): string | null {
    return this.dir && join(this.dir, `${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  private async load(id: string): Promise<Indexed[]> {
    const file = this.file(id);
    if (file && existsSync(file)) {
      try {
        const kept = JSON.parse(readFileSync(file, 'utf8')) as Kept;
        if (kept.id === id && Array.isArray(kept.chapters)) return indexText(kept);
      } catch {
        // Unreadable: fetched again below.
      }
    }
    const kept = keep(id, await this.download(id));
    if (kept.chapters.length === 0) throw new Error(`No text for ${id}`);
    if (file && this.dir) {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(kept));
      renameSync(`${file}.tmp`, file);
    }
    return indexText(kept);
  }

  /** The version's chapters, fetched once however many searches ask at the same time. */
  private chapters(id: string): Promise<Indexed[]> {
    const known = this.ready.get(id);
    if (known) return Promise.resolve(known);
    let pending = this.loading.get(id);
    if (!pending) {
      pending = this.load(id)
        .then((chapters) => {
          this.ready.set(id, chapters);
          return chapters;
        })
        .finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    return pending;
  }

  async search(id: string, query: string): Promise<string[]> {
    return searchText(await this.chapters(id), query);
  }
}
