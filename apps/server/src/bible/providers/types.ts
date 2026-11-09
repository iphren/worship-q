/** What every provider adapter offers, behind the one normalised shape (B22). */
import type { PassageUnit, Provider, Reference, TocBook } from '@worship-q/bible';

/** Why a provider could not answer. */
export type ProviderErrorKind =
  /** The key is refused for this version (401, 403): unusable until the daily check. */
  | 'unauthorized'
  /** The reference does not exist in the version, or the provider changed it. */
  | 'not-found'
  /** Too many verses for the provider's rules. */
  | 'too-large'
  /** Anything else: a timeout, a server error, an unreadable answer. */
  | 'failed';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface ProviderPassage {
  units: PassageUnit[];
  copyright: string;
  fumsToken: string | null;
}

/** A provider's contents: whole (an index), or books with chapters to fetch later. */
export interface ProviderToc {
  books: TocBook[];
  /** True when verse counts are all known (YouVersion's index). */
  complete: boolean;
}

/** A chapter's verses as a provider numbers them. */
export interface ProviderChapter {
  count: number;
  joined: [number, number][];
  missing: number[];
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ProviderAdapter {
  readonly name: Provider;
  /** Whether the church has set this provider's key; the Free Use Bible API needs none. */
  readonly configured: boolean;
  /** One small request: whether the version answers with the church's key. */
  check(id: string): Promise<boolean>;
  toc(id: string): Promise<ProviderToc>;
  chapter(id: string, book: string, chapter: number): Promise<ProviderChapter>;
  passage(id: string, reference: Reference): Promise<ProviderPassage>;
  /** References for free text; absent when the provider has no search. */
  search?(id: string, query: string): Promise<string[]>;
}

/** Reads a JSON answer, mapping HTTP errors to the provider's error kinds. */
export async function readJson<T>(
  fetch: Fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ProviderError('failed', `Request failed: ${(error as Error).message}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError('unauthorized', `Refused (${response.status})`);
  }
  if (response.status === 404 || response.status === 400) {
    throw new ProviderError('not-found', `Not found (${response.status})`);
  }
  if (!response.ok) throw new ProviderError('failed', `Answered ${response.status}`);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderError('failed', 'Unreadable answer');
  }
}

export const PASSAGE_TIMEOUT_MS = 3000;
export const CONTENTS_TIMEOUT_MS = 30_000;
