/**
 * Text search for the Bible window, used only when the input is not a reference (P2.7):
 * through the first provider that searches the version (YouVersion, then API.Bible, then
 * the ESV). References only, up to 20; the window fetches the text it shows.
 */
import { fromUsfm, toUsfm } from '@worship-q/bible';
import type { Availability } from './availability';
import type { Adapters } from './config';
import { ProviderError } from './providers/types';

export const MAX_SEARCH_RESULTS = 20;

export interface SearchAnswer {
  /** USFM references, best first. */
  references: string[];
  /** False when no provider of the version searches, so the window can say so. */
  searched: boolean;
}

export async function searchVersion(
  adapters: Adapters,
  availability: Availability,
  version: string,
  query: string,
): Promise<SearchAnswer> {
  const q = query.trim();
  if (!q) return { references: [], searched: true };
  let searched = false;
  for (const entry of availability.usable(version)) {
    const adapter = adapters[entry.provider];
    if (!adapter.search) continue;
    searched = true;
    try {
      const found = await adapter.search(entry.id, q);
      const references: string[] = [];
      for (const hit of found) {
        const reference = fromUsfm(hit);
        const usfm = reference && toUsfm(reference);
        if (usfm && !references.includes(usfm)) references.push(usfm);
        if (references.length >= MAX_SEARCH_RESULTS) break;
      }
      return { references, searched: true };
    } catch (error) {
      if (error instanceof ProviderError && error.kind === 'unauthorized') {
        availability.markRefused(version, entry.provider);
      }
    }
  }
  return { references: [], searched };
}
