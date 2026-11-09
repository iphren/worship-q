/**
 * Text for a passage (B22): the version's providers tried in order, an error, a timeout or a
 * refused key moving on to the next, never to another edition. Text is kept in memory only,
 * briefly and within every provider's rules (the ESV's 500 verses), and never on disk.
 */
import {
  toUsfm,
  tocBook,
  validate,
  type PassageText,
  type Reference,
  type Toc,
} from '@worship-q/bible';
import type { Availability } from './availability';
import type { Adapters } from './config';
import { ProviderError } from './providers/types';
import type { TocStore } from './toc';

/** The most verses one request may hold; the ESV allows no more to be kept. */
export const MAX_PASSAGE_VERSES = 500;
export const CACHE_MS = 10 * 60 * 1000;
export const CACHE_ENTRIES = 200;
/** The ESV's rule: at most 500 verses kept at once. */
export const ESV_CACHE_VERSES = 500;

export type BibleErrorKind = 'not-offered' | 'not-found' | 'too-large' | 'unavailable';

export class BibleError extends Error {
  constructor(
    readonly kind: BibleErrorKind,
    message: string,
  ) {
    super(message);
  }
}

interface Cached {
  text: PassageText;
  verses: number;
  at: number;
}

/** How many verses a reference holds, from the contents; 50 per chapter where unknown. */
export function verseCount(reference: Reference, toc: Toc | null): number {
  const entry = toc ? tocBook(toc, reference.book) : undefined;
  const count = (chapter: number) => entry?.chapters[chapter - 1] ?? 50;
  if (reference.verse === null) return count(reference.chapter);
  if (reference.endChapter === reference.chapter) return reference.endVerse! - reference.verse + 1;
  let total = count(reference.chapter) - reference.verse + 1;
  for (let c = reference.chapter + 1; c < reference.endChapter; c++) total += count(c);
  return total + reference.endVerse!;
}

export class Passages {
  private readonly cache = new Map<string, Cached>();

  constructor(
    private readonly adapters: Adapters,
    private readonly availability: Availability,
    private readonly tocs: TocStore,
    private readonly now: () => number = Date.now,
  ) {}

  private cached(key: string): PassageText | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (this.now() - hit.at >= CACHE_MS) {
      this.cache.delete(key);
      return null;
    }
    return hit.text;
  }

  private remember(key: string, text: PassageText): void {
    const verses = text.units.reduce((sum, unit) => sum + unit.verses.length, 0);
    this.cache.delete(key);
    this.cache.set(key, { text, verses, at: this.now() });
    // Oldest first: past the entry limit, then past the ESV's verses.
    while (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    while (this.cacheSize().esvVerses > ESV_CACHE_VERSES) {
      const oldest = [...this.cache].find(([, entry]) => entry.text.provider === 'esv');
      if (!oldest) break;
      this.cache.delete(oldest[0]);
    }
  }

  /** What the memory cache holds, for tests: entries and the ESV's verses. */
  cacheSize(): { entries: number; esvVerses: number } {
    let esvVerses = 0;
    for (const entry of this.cache.values())
      if (entry.text.provider === 'esv') esvVerses += entry.verses;
    return { entries: this.cache.size, esvVerses };
  }

  /** Checks the reference against the version's contents; null when they cannot be read. */
  private async check(version: string, reference: Reference): Promise<Toc | null> {
    let toc: Toc;
    try {
      for (const chapter of new Set([reference.chapter, reference.endChapter])) {
        if (!(await this.tocs.ensureChapter(version, reference.book, chapter))) {
          throw new BibleError('not-found', `${reference.book} ${chapter} is not in ${version}`);
        }
      }
      toc = (await this.tocs.get(version)).toc;
    } catch (error) {
      if (error instanceof BibleError) throw error;
      return null;
    }
    const validation = validate(reference, toc);
    if (validation.ok === false) {
      throw new BibleError(
        'not-found',
        `${toUsfm(reference)} is not in ${version} (${validation.missing})`,
      );
    }
    return toc;
  }

  async get(version: string, reference: Reference): Promise<PassageText> {
    const catalogue = this.availability.catalogue.find((v) => v.id === version);
    if (!catalogue) throw new BibleError('not-offered', `Unknown version ${version}`);
    const key = `${version}|${toUsfm(reference)}`;
    const hit = this.cached(key);
    if (hit) return hit;

    const toc = await this.check(version, reference);
    if (verseCount(reference, toc) > MAX_PASSAGE_VERSES) {
      throw new BibleError('too-large', `At most ${MAX_PASSAGE_VERSES} verses at once`);
    }

    let notFound = 0;
    const entries = this.availability.usable(version);
    for (const entry of entries) {
      try {
        const answer = await this.adapters[entry.provider].passage(entry.id, reference);
        const text: PassageText = {
          version,
          credit: catalogue.credit,
          provider: entry.provider,
          copyright: answer.copyright,
          units: answer.units,
          fumsToken: answer.fumsToken,
        };
        this.remember(key, text);
        return text;
      } catch (error) {
        if (!(error instanceof ProviderError)) continue;
        if (error.kind === 'unauthorized') this.availability.markRefused(version, entry.provider);
        if (error.kind === 'not-found') notFound++;
        if (error.kind === 'too-large') throw new BibleError('too-large', error.message);
      }
    }
    if (notFound > 0 && notFound === entries.length) {
      throw new BibleError('not-found', `${toUsfm(reference)} is not in ${version}`);
    }
    throw new BibleError('unavailable', `No provider answered for ${version}`);
  }
}
