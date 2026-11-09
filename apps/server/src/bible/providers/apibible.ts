/**
 * API.Bible (technical discovery §3): passages across chapters as JSON, with the copyright
 * line and a FUMS token in every answer; books and chapters in one call, a chapter's verses
 * in another, fetched only when the chapter is first opened (5,000 calls a month, P0.4).
 */
import { BY_ABBREVIATION, toUsfm, type Reference, type TocBook } from '@worship-q/bible';
import { fromApiBible } from './normalise';
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

const BASE = 'https://rest.api.bible/v1';

interface ApiBibleSummary {
  id: string;
  abbreviation?: string;
  abbreviationLocal?: string;
}

/** A chapter's verse list, as `MRK.15.1` or `1CH.16.12-1CH.16.13` for a joined one. */
export function chapterFromVerseIds(ids: string[]): ProviderChapter {
  const numbers = ids
    .map((id) => /\.(\d+)(?:-[1-3A-Z]{3}\.\d+\.(\d+))?$/.exec(id))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2] ?? m[1])] as [number, number]);
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

export class ApiBible implements ProviderAdapter {
  readonly name = 'apibible' as const;
  /** Ids found by abbreviation in the key's list of Bibles. */
  private resolved = new Map<string, string>();

  constructor(
    private readonly key: string | undefined,
    private readonly fetch: Fetch,
  ) {}

  get configured(): boolean {
    return !!this.key;
  }

  private get<T>(path: string, timeout = PASSAGE_TIMEOUT_MS): Promise<T> {
    if (!this.key) return Promise.reject(new ProviderError('unauthorized', 'No API.Bible key'));
    return readJson<T>(this.fetch, `${BASE}${path}`, { 'api-key': this.key }, timeout);
  }

  /** Reads the Bibles the key may use, once, to check them and resolve abbreviations. */
  async listBibles(): Promise<ApiBibleSummary[]> {
    const answer = await this.get<{ data?: ApiBibleSummary[] }>('/bibles', CONTENTS_TIMEOUT_MS);
    return answer.data ?? [];
  }

  /** The id to call with: as given, or looked up by abbreviation. */
  private async idOf(id: string): Promise<string> {
    if (!id.startsWith(BY_ABBREVIATION)) return id;
    const known = this.resolved.get(id);
    if (known) return known;
    await this.checkAll([id]);
    const found = this.resolved.get(id);
    if (!found) throw new ProviderError('unauthorized', `No Bible ${id} for this key`);
    return found;
  }

  /** Checks several versions with one call: which of them the key may use. */
  async checkAll(ids: string[]): Promise<Set<string>> {
    let bibles: ApiBibleSummary[];
    try {
      bibles = await this.listBibles();
    } catch (error) {
      if (error instanceof ProviderError && error.kind === 'unauthorized') return new Set();
      throw error;
    }
    const usable = new Set<string>();
    for (const id of ids) {
      if (id.startsWith(BY_ABBREVIATION)) {
        const abbreviation = id.slice(BY_ABBREVIATION.length).toUpperCase();
        const match = bibles.find(
          (b) =>
            b.abbreviation?.toUpperCase() === abbreviation ||
            b.abbreviationLocal?.toUpperCase() === abbreviation,
        );
        if (match) {
          this.resolved.set(id, match.id);
          usable.add(id);
        }
      } else if (bibles.some((b) => b.id === id)) {
        usable.add(id);
      }
    }
    return usable;
  }

  async check(id: string): Promise<boolean> {
    return (await this.checkAll([id])).has(id);
  }

  async toc(id: string): Promise<ProviderToc> {
    const answer = await this.get<{
      data?: {
        id: string;
        name?: string;
        abbreviation?: string;
        chapters?: { number?: string }[];
      }[];
    }>(
      `/bibles/${encodeURIComponent(await this.idOf(id))}/books?include-chapters=true`,
      CONTENTS_TIMEOUT_MS,
    );
    const books: TocBook[] = (answer.data ?? []).map((book) => {
      // Psalms has a `PSA.intro` pseudo-chapter, skipped.
      const chapters = (book.chapters ?? []).filter((c) => /^\d+$/.test(c.number ?? ''));
      const entry: TocBook = {
        book: book.id,
        name: book.name ?? book.id,
        chapters: chapters.map(() => null),
      };
      if (book.abbreviation) entry.abbreviation = book.abbreviation;
      return entry;
    });
    return { books, complete: false };
  }

  async chapter(id: string, book: string, chapter: number): Promise<ProviderChapter> {
    const answer = await this.get<{ data?: { id: string }[] }>(
      `/bibles/${encodeURIComponent(await this.idOf(id))}/chapters/${book}.${chapter}/verses`,
    );
    const info = chapterFromVerseIds((answer.data ?? []).map((verse) => verse.id));
    if (info.count === 0) throw new ProviderError('not-found', `${book} ${chapter} has no verses`);
    return info;
  }

  async passage(id: string, reference: Reference): Promise<ProviderPassage> {
    const answer = await this.get<{
      data?: { content?: unknown[]; copyright?: string };
      meta?: { fumsToken?: string };
    }>(
      `/bibles/${encodeURIComponent(await this.idOf(id))}/passages/${toUsfm(reference)}?content-type=json&include-notes=false&include-titles=true&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=true&fums-version=3`,
    );
    const units = fromApiBible(
      (answer.data?.content ?? []) as Parameters<typeof fromApiBible>[0],
      reference.chapter,
    );
    if (units.length === 0) throw new ProviderError('not-found', 'No verses in the answer');
    return {
      units,
      copyright: (answer.data?.copyright ?? '').trim(),
      fumsToken: answer.meta?.fumsToken ?? null,
    };
  }

  async search(id: string, query: string): Promise<string[]> {
    const answer = await this.get<{
      data?: { verses?: { id?: string }[]; passages?: { id?: string }[] };
    }>(
      `/bibles/${encodeURIComponent(await this.idOf(id))}/search?query=${encodeURIComponent(query)}&limit=20`,
    );
    const hits = [...(answer.data?.passages ?? []), ...(answer.data?.verses ?? [])];
    return hits.flatMap((hit) => (hit.id ? [hit.id] : []));
  }
}
