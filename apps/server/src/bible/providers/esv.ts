/**
 * The ESV API (technical discovery §3): passages from an English reference, as HTML; no
 * contents, so chapters come from the usual English count and a chapter's verses from
 * `passage_meta`. It clamps references past the end (Psalm 151 gives Psalm 150), so the
 * numbers it answers with are checked against the request, and a change is refused.
 */
import {
  BOOKS,
  bookName,
  bookNumber,
  chapterCount,
  parseReference,
  toUsfm,
  type Reference,
} from '@worship-q/bible';
import { fromEsv } from './normalise';
import {
  PASSAGE_TIMEOUT_MS,
  ProviderError,
  readJson,
  type Fetch,
  type ProviderAdapter,
  type ProviderChapter,
  type ProviderPassage,
  type ProviderToc,
} from './types';

const BASE = 'https://api.esv.org/v3';
/** Crossway's copyright line, shown where Worship Q credits the ESV. */
export const ESV_COPYRIGHT =
  'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.';

/** The reference in English, as the ESV API reads it: `John 3:16-18`. */
export function esvQuery(reference: Reference): string {
  const name = reference.book === 'PSA' ? 'Psalm' : bookName(reference.book, 'en');
  const { chapter, verse, endChapter, endVerse } = reference;
  if (verse === null) return `${name} ${chapter}`;
  if (endChapter !== chapter) return `${name} ${chapter}:${verse}-${endChapter}:${endVerse}`;
  return endVerse === verse
    ? `${name} ${chapter}:${verse}`
    : `${name} ${chapter}:${verse}-${endVerse}`;
}

const code = (book: string, chapter: number, verse: number) =>
  bookNumber(book) * 1_000_000 + chapter * 1000 + verse;

interface EsvAnswer {
  parsed?: [number, number][];
  passages?: string[];
  passage_meta?: { chapter_start?: [number, number]; chapter_end?: [number, number] }[];
}

export class Esv implements ProviderAdapter {
  readonly name = 'esv' as const;

  constructor(
    private readonly key: string | undefined,
    private readonly fetch: Fetch,
  ) {}

  get configured(): boolean {
    return !!this.key;
  }

  private get<T>(path: string): Promise<T> {
    if (!this.key) return Promise.reject(new ProviderError('unauthorized', 'No ESV key'));
    return readJson<T>(
      this.fetch,
      `${BASE}${path}`,
      { Authorization: `Token ${this.key}` },
      PASSAGE_TIMEOUT_MS,
    );
  }

  async check(): Promise<boolean> {
    try {
      await this.get('/passage/text/?q=John+11:35&include-footnotes=false');
      return true;
    } catch (error) {
      if (error instanceof ProviderError && error.kind !== 'failed') return false;
      throw error;
    }
  }

  async toc(): Promise<ProviderToc> {
    return {
      books: BOOKS.map((book) => ({
        book: book.id,
        name: book.en,
        abbreviation: book.enShort,
        chapters: Array.from({ length: chapterCount(book.id) }, () => null),
      })),
      complete: false,
    };
  }

  async chapter(_id: string, book: string, chapter: number): Promise<ProviderChapter> {
    const answer = await this.get<EsvAnswer>(
      `/passage/text/?q=${encodeURIComponent(esvQuery({ book, chapter, verse: 1, endChapter: chapter, endVerse: 1 }))}&include-footnotes=false&include-headings=false`,
    );
    const end = answer.passage_meta?.[0]?.chapter_end?.[1];
    if (!end || Math.floor(end / 1000) !== code(book, chapter, 0) / 1000) {
      throw new ProviderError('not-found', `${book} ${chapter} is not in the ESV`);
    }
    return { count: end % 1000, joined: [], missing: [] };
  }

  async passage(_id: string, reference: Reference): Promise<ProviderPassage> {
    const answer = await this.get<EsvAnswer>(
      `/passage/html/?q=${encodeURIComponent(esvQuery(reference))}&include-footnotes=false&include-audio-link=false&include-headings=false&include-passage-references=false&include-short-copyright=false&include-copyright=false`,
    );
    const parsed = answer.parsed ?? [];
    const [start, end] = parsed[0] ?? [0, 0];
    const wantStart = code(reference.book, reference.chapter, reference.verse ?? 1);
    const matches =
      parsed.length === 1 &&
      start === wantStart &&
      (reference.verse === null
        ? Math.floor(end / 1000) === Math.floor(wantStart / 1000)
        : end === code(reference.book, reference.endChapter, reference.endVerse!));
    if (!matches) {
      throw new ProviderError(
        'not-found',
        `The ESV answered with another passage than ${toUsfm(reference)}`,
      );
    }
    const units = fromEsv(answer.passages?.[0] ?? '');
    if (units.length === 0) throw new ProviderError('not-found', 'No verses in the answer');
    return { units, copyright: ESV_COPYRIGHT, fumsToken: null };
  }

  async search(_id: string, query: string): Promise<string[]> {
    const answer = await this.get<{ results?: { reference?: string }[] }>(
      `/passage/search/?q=${encodeURIComponent(query)}&page-size=20`,
    );
    return (answer.results ?? []).flatMap((result) => {
      const parsed = parseReference(result.reference ?? '');
      return parsed.kind === 'reference' ? [toUsfm(parsed.reference)] : [];
    });
  }
}
