/**
 * The Free Use Bible API (technical discovery §3): static JSON with no key; books with their
 * chapter counts, and whole chapters, sliced here.
 */
import type { Reference, TocBook } from '@worship-q/bible';
import { fromFreeUse, type FreeUseContent } from './normalise';
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

const BASE = 'https://bible.helloao.org/api';

interface FreeUseChapter {
  translation?: {
    name?: string;
    shortName?: string;
    licenseUrl?: string;
    license?: { publicDomain?: boolean };
  };
  chapter?: { number?: number; content?: FreeUseContent[] };
  numberOfVerses?: number;
}

/** The copyright line: the translation's licence notice, as the API gives it. */
function copyrightOf(chapter: FreeUseChapter): string {
  const t = chapter.translation ?? {};
  const name = t.name ?? t.shortName ?? '';
  if (t.license?.publicDomain) return `${name}: public domain`;
  return t.licenseUrl ? `${name}: ${t.licenseUrl}` : name;
}

export class FreeUse implements ProviderAdapter {
  readonly name = 'freeuse' as const;
  readonly configured = true;

  constructor(private readonly fetch: Fetch) {}

  private get<T>(path: string, timeout = PASSAGE_TIMEOUT_MS): Promise<T> {
    return readJson<T>(this.fetch, `${BASE}${path}`, {}, timeout);
  }

  private chapterFile(id: string, book: string, chapter: number): Promise<FreeUseChapter> {
    return this.get<FreeUseChapter>(`/${encodeURIComponent(id)}/${book}/${chapter}.json`);
  }

  async check(id: string): Promise<boolean> {
    try {
      await this.get(`/${encodeURIComponent(id)}/books.json`);
      return true;
    } catch (error) {
      if (error instanceof ProviderError && error.kind !== 'failed') return false;
      throw error;
    }
  }

  async toc(id: string): Promise<ProviderToc> {
    const answer = await this.get<{
      books?: { id: string; name?: string; commonName?: string; numberOfChapters?: number }[];
    }>(`/${encodeURIComponent(id)}/books.json`, CONTENTS_TIMEOUT_MS);
    const books: TocBook[] = (answer.books ?? []).map((book) => ({
      book: book.id,
      name: book.commonName ?? book.name ?? book.id,
      chapters: Array.from({ length: book.numberOfChapters ?? 0 }, () => null),
    }));
    return { books, complete: false };
  }

  async chapter(id: string, book: string, chapter: number): Promise<ProviderChapter> {
    const file = await this.chapterFile(id, book, chapter);
    const numbers = (file.chapter?.content ?? [])
      .filter((entry) => entry.type === 'verse' && entry.number !== undefined)
      .map((entry) => entry.number!);
    const count = Math.max(file.numberOfVerses ?? 0, ...numbers, 0);
    // A gap in the numbering is a verse joined into the one before (spike P0.2).
    const joined: [number, number][] = [];
    numbers.forEach((n, i) => {
      const next = numbers[i + 1] ?? (n < count ? count + 1 : n + 1);
      if (next > n + 1) joined.push([n, next - 1]);
    });
    return { count, joined, missing: [] };
  }

  async passage(id: string, reference: Reference): Promise<ProviderPassage> {
    const units = [];
    let copyright = '';
    for (let c = reference.chapter; c <= reference.endChapter; c++) {
      const file = await this.chapterFile(id, reference.book, c);
      copyright = copyrightOf(file);
      const from = c === reference.chapter ? (reference.verse ?? 1) : 1;
      const to = c === reference.endChapter ? (reference.endVerse ?? Infinity) : Infinity;
      const count = Math.max(
        file.numberOfVerses ?? 0,
        ...(file.chapter?.content ?? []).map((entry) => entry.number ?? 0),
      );
      // Never clamped: a verse past the chapter's end is refused.
      if (from > count || (to !== Infinity && to > count)) {
        throw new ProviderError('not-found', `${reference.book} ${c} has ${count} verses`);
      }
      units.push(...fromFreeUse(c, file.chapter?.content ?? [], from, to));
    }
    if (units.filter((unit) => !unit.title).length === 0) {
      throw new ProviderError('not-found', 'No verses in the chapter for this range');
    }
    return { units, copyright, fumsToken: null };
  }
}
