/**
 * Which versions the server can offer (B18): at start and daily, each catalogue version is
 * checked with its providers in order, one small request each (API.Bible's in one call for
 * all its versions), and the result says which providers answer for it.
 */
import {
  CATALOGUE,
  type CatalogueVersion,
  type Provider,
  type ProviderEntry,
} from '@worship-q/bible';
import type { Adapters } from './config';
import { ApiBible } from './providers/apibible';

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

type State = 'usable' | 'refused' | 'unknown';

export interface VersionStatus {
  id: string;
  /** The providers that answer for it, in fallback order. */
  providers: Provider[];
  available: boolean;
}

export class Availability {
  /** `version|provider` → state; a provider never checked is unknown. */
  private states = new Map<string, State>();
  private checked = false;

  constructor(
    private readonly adapters: Adapters,
    readonly catalogue: readonly CatalogueVersion[] = CATALOGUE,
  ) {}

  private key(version: string, provider: Provider): string {
    return `${version}|${provider}`;
  }

  /** Checks every version with every provider whose key is set. */
  async refresh(): Promise<void> {
    const states = new Map<string, State>();
    const apiBible = this.adapters.apibible;
    const abEntries = this.catalogue.flatMap((v) =>
      v.providers
        .filter((p) => p.provider === 'apibible')
        .map((p) => ({ version: v.id, entry: p })),
    );
    if (apiBible.configured && abEntries.length > 0) {
      try {
        const usable =
          apiBible instanceof ApiBible
            ? await apiBible.checkAll(abEntries.map((e) => e.entry.id))
            : new Set(
                (
                  await Promise.all(
                    abEntries.map(async (e) =>
                      (await apiBible.check(e.entry.id)) ? e.entry.id : null,
                    ),
                  )
                ).filter((id): id is string => id !== null),
              );
        for (const { version, entry } of abEntries) {
          states.set(this.key(version, 'apibible'), usable.has(entry.id) ? 'usable' : 'refused');
        }
      } catch {
        for (const { version } of abEntries) states.set(this.key(version, 'apibible'), 'unknown');
      }
    }
    for (const version of this.catalogue) {
      for (const entry of version.providers) {
        if (entry.provider === 'apibible') continue;
        const adapter = this.adapters[entry.provider];
        if (!adapter.configured) continue;
        let state: State;
        try {
          state = (await adapter.check(entry.id)) ? 'usable' : 'refused';
        } catch {
          // A network failure says nothing about the key: tried again when a passage is asked.
          state = 'unknown';
        }
        states.set(this.key(version.id, entry.provider), state);
      }
    }
    this.states = states;
    this.checked = true;
  }

  get hasChecked(): boolean {
    return this.checked;
  }

  /** The provider entries to try for a version, in order: answering, or not known to refuse. */
  usable(version: string): ProviderEntry[] {
    const entry = this.catalogue.find((v) => v.id === version);
    if (!entry) return [];
    return entry.providers.filter((p) => {
      if (!this.adapters[p.provider].configured) return false;
      // Not checked yet, as just after start: tried rather than left out, so the Bible is
      // offered at once; the first check settles it within seconds.
      const state = this.states.get(this.key(version, p.provider)) ?? 'unknown';
      return state === 'usable' || state === 'unknown';
    });
  }

  available(version: string): boolean {
    return this.usable(version).length > 0;
  }

  /** A provider refused the key for this version: skipped until the next daily check. */
  markRefused(version: string, provider: Provider): void {
    this.states.set(this.key(version, provider), 'refused');
  }

  statuses(): VersionStatus[] {
    return this.catalogue.map((version) => {
      const providers = this.usable(version.id).map((p) => p.provider);
      return { id: version.id, providers, available: providers.length > 0 };
    });
  }
}
