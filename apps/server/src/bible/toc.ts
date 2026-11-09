/**
 * Tables of contents (B20), kept in the compact form in the server's data folder: from
 * YouVersion's index where it serves the version (refreshed weekly, kept when unchanged),
 * otherwise from the provider's book list, with a chapter's verses fetched the first time the
 * chapter is opened and kept for good.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TocSchema, tocBook, type Provider, type Toc } from '@worship-q/bible';
import type { Availability } from './availability';
import type { Adapters } from './config';
import { ProviderError } from './providers/types';

export const REFRESH_INDEX_MS = 7 * 24 * 60 * 60 * 1000;

interface Saved {
  toc: Toc;
  /** The provider it was built from. */
  provider: Provider;
  /** Whether every chapter's verses are known (an index). */
  complete: boolean;
  builtAt: number;
  hash: string;
}

export function tocHash(toc: Toc): string {
  return createHash('sha256').update(JSON.stringify(toc)).digest('hex').slice(0, 16);
}

export class TocStore {
  private readonly saved = new Map<string, Saved>();
  private readonly building = new Map<string, Promise<Saved>>();
  private readonly dir: string;

  constructor(
    dataDir: string,
    private readonly adapters: Adapters,
    private readonly availability: Availability,
    private readonly now: () => number = Date.now,
  ) {
    this.dir = join(dataDir, 'bible', 'toc');
  }

  private file(version: string): string {
    return join(this.dir, `${version.replace(/[^A-Za-z0-9-]/g, '_')}.json`);
  }

  private read(version: string): Saved | null {
    const known = this.saved.get(version);
    if (known) return known;
    const file = this.file(version);
    if (!existsSync(file)) return null;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Saved;
      const toc = TocSchema.parse(raw.toc);
      const saved = { ...raw, toc, hash: tocHash(toc) };
      this.saved.set(version, saved);
      return saved;
    } catch {
      return null;
    }
  }

  private write(version: string, saved: Saved): void {
    mkdirSync(this.dir, { recursive: true });
    const file = this.file(version);
    writeFileSync(`${file}.tmp`, JSON.stringify(saved));
    renameSync(`${file}.tmp`, file);
    this.saved.set(version, saved);
  }

  /** Builds from the version's providers in order, an index first where one serves it. */
  private async build(version: string): Promise<Saved> {
    const entries = this.availability.usable(version);
    const ordered = [
      ...entries.filter((e) => e.provider === 'youversion'),
      ...entries.filter((e) => e.provider !== 'youversion'),
    ];
    let lastError: unknown = new ProviderError('failed', `No provider for ${version}`);
    for (const entry of ordered) {
      try {
        const result = await this.adapters[entry.provider].toc(entry.id);
        const toc: Toc = { version, books: result.books };
        return {
          toc,
          provider: entry.provider,
          complete: result.complete,
          builtAt: this.now(),
          hash: tocHash(toc),
        };
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'unauthorized') {
          this.availability.markRefused(version, entry.provider);
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  private once(version: string): Promise<Saved> {
    const running = this.building.get(version);
    if (running) return running;
    const promise = this.build(version).finally(() => this.building.delete(version));
    this.building.set(version, promise);
    return promise;
  }

  /** The version's contents with their hash, built the first time it is asked for. */
  async get(version: string): Promise<{ toc: Toc; hash: string }> {
    let saved = this.read(version);
    if (!saved) {
      saved = await this.once(version);
      this.write(version, saved);
    } else if (saved.complete && this.now() - saved.builtAt >= REFRESH_INDEX_MS) {
      // A weekly refresh of an index, in the background; kept when nothing changed.
      void this.once(version)
        .then((fresh) => {
          const current = this.read(version)!;
          this.write(
            version,
            fresh.hash === current.hash ? { ...current, builtAt: fresh.builtAt } : fresh,
          );
        })
        .catch(() => undefined);
    }
    return { toc: saved.toc, hash: saved.hash };
  }

  /**
   * Makes sure a chapter's verses are known, fetching them once from the version's
   * providers. False when the chapter does not exist.
   */
  async ensureChapter(version: string, book: string, chapter: number): Promise<boolean> {
    await this.get(version);
    const saved = this.read(version)!;
    const entry = tocBook(saved.toc, book);
    if (!entry || chapter < 1 || chapter > entry.chapters.length) return false;
    if (entry.chapters[chapter - 1] !== null) return true;
    const providers = this.availability.usable(version);
    const ordered = [
      ...providers.filter((p) => p.provider === saved.provider),
      ...providers.filter((p) => p.provider !== saved.provider),
    ];
    let lastError: unknown = new ProviderError('failed', `No provider for ${version}`);
    for (const p of ordered) {
      try {
        const info = await this.adapters[p.provider].chapter(p.id, book, chapter);
        const current = this.read(version)!;
        const books = current.toc.books.map((b) => {
          if (b.book !== book) return b;
          const chapters = [...b.chapters];
          chapters[chapter - 1] = info.count;
          const next = { ...b, chapters };
          const joined = [
            ...(b.joined ?? []).filter(([c]) => c !== chapter),
            ...info.joined.map(
              ([first, last]) => [chapter, first, last] as [number, number, number],
            ),
          ];
          const missing = [
            ...(b.missing ?? []).filter(([c]) => c !== chapter),
            ...info.missing.map((verse) => [chapter, verse] as [number, number]),
          ];
          if (joined.length) next.joined = joined;
          else delete next.joined;
          if (missing.length) next.missing = missing;
          else delete next.missing;
          return next;
        });
        const toc = { ...current.toc, books };
        this.write(version, { ...current, toc, hash: tocHash(toc) });
        return true;
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'not-found') return false;
        if (error instanceof ProviderError && error.kind === 'unauthorized') {
          this.availability.markRefused(version, p.provider);
        }
        lastError = error;
      }
    }
    throw lastError;
  }
}
