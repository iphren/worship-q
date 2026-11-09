/**
 * The church server's Bible (B17–B25): the providers behind the church's keys, which versions
 * are available, their contents, text with fallback, search and usage reporting.
 */
import { CATALOGUE, type CatalogueVersion } from '@worship-q/bible';
import type { AdminBible, BibleVersionInfo, ChurchSettings } from '@worship-q/protocol';
import { Availability, CHECK_EVERY_MS } from './availability';
import { keysSet, makeAdapters, type Adapters, type BibleKeys } from './config';
import { Fums } from './fums';
import { Passages } from './passages';
import type { Fetch } from './providers/types';
import { searchVersion, type SearchAnswer } from './search';
import { TocStore } from './toc';

export { BibleError } from './passages';
export { bibleKeysFromEnv } from './config';

export interface BibleOptions {
  dataDir: string;
  keys: BibleKeys;
  fetch?: Fetch;
  now?: () => number;
  catalogue?: readonly CatalogueVersion[];
}

export function versionInfo(version: CatalogueVersion): BibleVersionInfo {
  return { id: version.id, name: version.name, credit: version.credit, language: version.language };
}

export class Bible {
  readonly adapters: Adapters;
  readonly availability: Availability;
  readonly tocs: TocStore;
  readonly passages: Passages;
  readonly fums: Fums;
  private readonly keys: ReturnType<typeof keysSet>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: BibleOptions) {
    const fetch = options.fetch ?? globalThis.fetch;
    this.keys = keysSet(options.keys);
    this.adapters = makeAdapters(options.keys, fetch);
    this.availability = new Availability(this.adapters, options.catalogue ?? CATALOGUE);
    this.tocs = new TocStore(options.dataDir, this.adapters, this.availability, options.now);
    this.passages = new Passages(this.adapters, this.availability, this.tocs, options.now);
    this.fums = new Fums(fetch);
  }

  /** Checks availability now and daily, and reports usage in the background. */
  start(log: (message: string) => void = () => undefined): void {
    const check = () =>
      this.availability
        .refresh()
        .then(() => {
          const available = this.availability.statuses().filter((s) => s.available);
          log(
            `Bible versions available: ${available.map((s) => `${s.id} (${s.providers.join(', ')})`).join('; ') || 'none'}`,
          );
        })
        .catch(() => undefined);
    void check();
    this.timer = setInterval(check, CHECK_EVERY_MS);
    this.timer.unref?.();
    this.fums.start();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.fums.stop();
  }

  /** The versions the church offers that a provider serves, in the catalogue's order. */
  offered(church: ChurchSettings): CatalogueVersion[] {
    const chosen = new Set(church.bibleVersions ?? []);
    return this.availability.catalogue.filter(
      (version) => chosen.has(version.id) && this.availability.available(version.id),
    );
  }

  isOffered(version: string, church: ChurchSettings): boolean {
    return this.offered(church).some((v) => v.id === version);
  }

  search(version: string, query: string): Promise<SearchAnswer> {
    return searchVersion(this.adapters, this.availability, version, query);
  }

  /** What the admin app is told: which keys are set, never the keys themselves. */
  admin(church: ChurchSettings): AdminBible {
    const chosen = new Set(church.bibleVersions ?? []);
    const statuses = new Map(this.availability.statuses().map((s) => [s.id, s]));
    return {
      keys: this.keys,
      checked: this.availability.hasChecked,
      versions: this.availability.catalogue.map((version) => ({
        ...versionInfo(version),
        available: statuses.get(version.id)?.available ?? false,
        providers: statuses.get(version.id)?.providers ?? [],
        offered: chosen.has(version.id),
      })),
    };
  }
}
