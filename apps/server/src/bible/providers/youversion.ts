/**
 * YouVersion Platform (technical discovery §3): passages by USFM within one chapter, as HTML
 * to keep poetry; the whole index in one call; verse search in English and Chinese.
 */
import { inReference, type Reference, type TocBook } from '@worship-q/bible';
import { fromYouVersion } from './normalise';
import {
  CONTENTS_TIMEOUT_MS,
  PASSAGE_TIMEOUT_MS,
  ProviderError,
  readJson,
  type Fetch,
  type ProviderAdapter,
  type ProviderChapter,
  type ProviderPassage,
  type ProviderToc,
} from './types';

const BASE = 'https://api.youversion.com/v1';

interface IndexVerse {
  id?: string;
  passage_id?: string;
  title?: string;
}
interface IndexChapter {
  id?: string;
  passage_id?: string;
  title?: string;
  verses?: IndexVerse[];
}
interface IndexBook {
  id: string;
  title?: string;
  abbreviation?: string;
  chapters?: IndexChapter[];
}

/** A verse of the index as numbers: `12`, or `12-13` for a joined one. */
function verseNumbers(verse: IndexVerse): [number, number] | null {
  const source = verse.passage_id ?? verse.id ?? verse.title ?? '';
  const m = /(?:^|\.)(\d+)(?:-(?:[1-3A-Z]{3}\.\d+\.)?(\d+))?$/.exec(source);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? m[1])];
}

/** The compact contents of one chapter of the index. */
export function indexChapter(chapter: IndexChapter): ProviderChapter {
  const numbers = (chapter.verses ?? [])
    .map(verseNumbers)
    .filter((n): n is [number, number] => n !== null);
  const count = Math.max(0, ...numbers.map(([, last]) => last));
  const present = new Set<number>();
  const joined: [number, number][] = [];
  for (const [first, last] of numbers) {
    for (let v = first; v <= last; v++) present.add(v);
    if (last > first) joined.push([first, last]);
  }
  const missing: number[] = [];
  for (let v = 1; v <= count; v++) if (!present.has(v)) missing.push(v);
  return { count, joined, missing };
}

/** The compact form of YouVersion's index (B20). */
export function tocFromIndex(books: IndexBook[]): TocBook[] {
  return books
    .filter((book) => /^[1-3A-Z][A-Z0-9]{2}$/.test(book.id))
    .map((book) => {
      const chapters = (book.chapters ?? []).filter((c) =>
        /^\d+$/.test(String(c.title ?? c.id ?? '').replace(/^.*\./, '')),
      );
      const entry: TocBook = { book: book.id, name: book.title ?? book.id, chapters: [] };
      if (book.abbreviation) entry.abbreviation = book.abbreviation;
      const joined: [number, number, number][] = [];
      const missing: [number, number][] = [];
      chapters.forEach((chapter, index) => {
        const info = indexChapter(chapter);
        entry.chapters.push(info.count);
        for (const [first, last] of info.joined) joined.push([index + 1, first, last]);
        for (const verse of info.missing) missing.push([index + 1, verse]);
      });
      if (joined.length) entry.joined = joined;
      if (missing.length) entry.missing = missing;
      return entry;
    });
}

/** The pieces of a reference YouVersion can fetch: it never crosses a chapter. */
export function youVersionPassages(reference: Reference): { usfm: string; chapter: number }[] {
  const { book, chapter, verse, endChapter, endVerse } = reference;
  if (verse === null) return [{ usfm: `${book}.${chapter}`, chapter }];
  if (endChapter === chapter) {
    return [
      {
        usfm:
          endVerse === verse
            ? `${book}.${chapter}.${verse}`
            : `${book}.${chapter}.${verse}-${endVerse}`,
        chapter,
      },
    ];
  }
  // Across chapters: each chapter whole, trimmed to the range afterwards.
  const parts = [];
  for (let c = chapter; c <= endChapter; c++) parts.push({ usfm: `${book}.${c}`, chapter: c });
  return parts;
}

export class YouVersion implements ProviderAdapter {
  readonly name = 'youversion' as const;
  private readonly copyrights = new Map<string, string>();

  constructor(
    private readonly key: string | undefined,
    private readonly fetch: Fetch,
  ) {}

  get configured(): boolean {
    return !!this.key;
  }

  private get<T>(path: string, timeout = PASSAGE_TIMEOUT_MS): Promise<T> {
    if (!this.key) return Promise.reject(new ProviderError('unauthorized', 'No YouVersion key'));
    return readJson<T>(this.fetch, `${BASE}${path}`, { 'X-YVP-App-Key': this.key }, timeout);
  }

  private async copyright(id: string): Promise<string> {
    const known = this.copyrights.get(id);
    if (known !== undefined) return known;
    const bible = await this.get<{ copyright?: string }>(`/bibles/${encodeURIComponent(id)}`);
    const copyright = (bible.copyright ?? '').trim();
    this.copyrights.set(id, copyright);
    return copyright;
  }

  async check(id: string): Promise<boolean> {
    try {
      // The Bible's details are allowed only once its licence is accepted; a passage proves it.
      await this.get(`/bibles/${encodeURIComponent(id)}/passages/JHN.11.35?format=text`);
      return true;
    } catch (error) {
      if (error instanceof ProviderError && error.kind !== 'failed') return false;
      throw error;
    }
  }

  async toc(id: string): Promise<ProviderToc> {
    const index = await this.get<{ books?: IndexBook[] }>(
      `/bibles/${encodeURIComponent(id)}/index`,
      CONTENTS_TIMEOUT_MS,
    );
    return { books: tocFromIndex(index.books ?? []), complete: true };
  }

  async chapter(id: string, book: string, chapter: number): Promise<ProviderChapter> {
    const toc = await this.toc(id);
    const entry = toc.books.find((b) => b.book === book);
    const count = entry?.chapters[chapter - 1];
    if (!entry || count === undefined || count === null) {
      throw new ProviderError('not-found', `${book} ${chapter} not in the index`);
    }
    return {
      count,
      joined: (entry.joined ?? []).filter(([c]) => c === chapter).map(([, a, b]) => [a, b]),
      missing: (entry.missing ?? []).filter(([c]) => c === chapter).map(([, v]) => v),
    };
  }

  async passage(id: string, reference: Reference): Promise<ProviderPassage> {
    const units = [];
    for (const part of youVersionPassages(reference)) {
      const answer = await this.get<{ content?: string }>(
        `/bibles/${encodeURIComponent(id)}/passages/${part.usfm}?format=html&include_headings=true&include_notes=true`,
      );
      units.push(...fromYouVersion(answer.content ?? '', part.chapter));
    }
    const kept = units.filter(
      (unit) =>
        unit.title || unit.verses.some((verse) => inReference(reference, unit.chapter, verse)),
    );
    if (kept.length === 0) throw new ProviderError('not-found', 'No verses in the answer');
    return { units: kept, copyright: await this.copyright(id), fumsToken: null };
  }

  async search(id: string, query: string): Promise<string[]> {
    const answer = await this.get<{ verses?: { reference?: string }[] }>(
      `/search-verses?query=${encodeURIComponent(query.slice(0, 100))}&bible_id=${encodeURIComponent(id)}&page_size=20`,
    );
    return (answer.verses ?? []).flatMap((verse) => (verse.reference ? [verse.reference] : []));
  }
}
