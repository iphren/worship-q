/**
 * The desktop's Bible (P4.1, B17, B20): the church's versions, their tables of contents kept
 * on this computer so the grids and typing need no network, and passages fetched through the
 * church server, which holds the keys.
 */
import {
  MAX_WORKSPACE_VERSIONS,
  TocSchema,
  effectiveVersions,
  toUsfm,
  type BibleErrorCode,
  type BibleSearchResponse,
  type BibleTocResponse,
  type BibleVersionInfo,
  type Passage,
  type PassageText,
  type Reference,
  type Toc,
} from '@worship-q/protocol';
import type { SettingsStorage } from './deviceSettings';
import { bibleWindow } from '@worship-q/protocol';

const { referenceInVersion } = bibleWindow;

/** The church server's Bible routes, as this computer calls them. */
export interface BibleServer {
  versions(): Promise<BibleVersionInfo[]>;
  toc(version: string, chapter?: { book: string; chapter: number }): Promise<BibleTocResponse>;
  passage(version: string, usfm: string, device: string, session: string): Promise<PassageText>;
  search(version: string, query: string): Promise<BibleSearchResponse>;
  reportUsage(tokens: string[], device: string, session: string): Promise<void>;
}

/** Why a passage could not be had. */
export class BibleRequestError extends Error {
  constructor(
    readonly code: BibleErrorCode | 'offline',
    message?: string,
  ) {
    super(message ?? code);
  }
}

interface SavedToc {
  hash: string;
  toc: Toc;
}

const TOC_KEY = 'wq.bible.toc.';
const VERSIONS_KEY = 'wq.bible.versions';
const DEVICE_KEY = 'wq.bible.device';

/** A random identifier, letters and digits only, as API.Bible's usage reporting asks. */
function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class BibleClient {
  /** A new identifier for each Bible window opening (B25). */
  session = randomId();
  private readonly tocs = new Map<string, SavedToc>();
  private versions_: BibleVersionInfo[] | null = null;

  constructor(
    private readonly server: () => BibleServer | null,
    private readonly storage: () => SettingsStorage | null,
    /** Where the saved contents belong: one church server's versions are not another's. */
    private readonly scope: () => string,
  ) {}

  private key(name: string): string {
    return `${name}${this.scope()}`;
  }

  private read<T>(key: string): T | null {
    try {
      const raw = this.storage()?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.storage()?.setItem(key, JSON.stringify(value));
    } catch {
      // A full storage only costs a request next time.
    }
  }

  /**
   * A random, stable identifier for this computer, not its device id, for usage reporting
   * (B25).
   */
  get deviceId(): string {
    let id = this.read<string>(DEVICE_KEY);
    if (!id) {
      id = randomId();
      this.write(DEVICE_KEY, id);
    }
    return id;
  }

  /** Starts a new reporting session, as each Bible window opening is one. */
  newSession(): void {
    this.session = randomId();
  }

  /**
   * The versions the church offers. Asked of the server when it can be reached, else the
   * last list seen, so a computer that lost the internet still browses (B20).
   */
  async versions(): Promise<BibleVersionInfo[]> {
    const server = this.server();
    if (server) {
      try {
        this.versions_ = await server.versions();
        this.write(this.key(VERSIONS_KEY), this.versions_);
      } catch {
        this.versions_ ??= this.read(this.key(VERSIONS_KEY));
      }
    } else {
      this.versions_ ??= this.read(this.key(VERSIONS_KEY));
    }
    return this.versions_ ?? [];
  }

  private saved(version: string): SavedToc | null {
    const known = this.tocs.get(version);
    if (known) return known;
    const stored = this.read<SavedToc>(this.key(`${TOC_KEY}${version}.`));
    const parsed = stored ? TocSchema.safeParse(stored.toc) : null;
    if (!stored || !parsed?.success) return null;
    const saved = { hash: stored.hash, toc: parsed.data };
    this.tocs.set(version, saved);
    return saved;
  }

  private keep(version: string, answer: BibleTocResponse): Toc {
    const saved = { hash: answer.hash, toc: answer.toc };
    this.tocs.set(version, saved);
    this.write(this.key(`${TOC_KEY}${version}.`), saved);
    return answer.toc;
  }

  /**
   * A version's contents: the saved copy, without a request, unless the server's list says
   * they changed; fetched when there is none. Null when there is none and no server.
   */
  async toc(version: string): Promise<Toc | null> {
    const saved = this.saved(version);
    const listed = this.versions_?.find((v) => v.id === version)?.tocHash;
    if (saved && (!listed || listed === saved.hash)) return saved.toc;
    const server = this.server();
    if (!server) return saved?.toc ?? null;
    try {
      return this.keep(version, await server.toc(version));
    } catch {
      return saved?.toc ?? null;
    }
  }

  /** The contents with a chapter's verses known, fetching them the first time it is opened. */
  async tocWithChapter(version: string, book: string, chapter: number): Promise<Toc | null> {
    const toc = await this.toc(version);
    const entry = toc?.books.find((b) => b.book === book);
    if (!toc || !entry || chapter > entry.chapters.length || entry.chapters[chapter - 1] !== null) {
      return toc;
    }
    const server = this.server();
    if (!server) return toc;
    try {
      return this.keep(version, await server.toc(version, { book, chapter }));
    } catch {
      return toc;
    }
  }

  /** One version's text of a reference; a clear error when offline. */
  async text(version: string, reference: Reference): Promise<PassageText> {
    const server = this.server();
    if (!server) throw new BibleRequestError('offline');
    try {
      return await server.passage(version, toUsfm(reference), this.deviceId, this.session);
    } catch (error) {
      if (error instanceof BibleRequestError) throw error;
      throw new BibleRequestError('offline', (error as Error).message);
    }
  }

  /**
   * A passage in the workspace's versions, in chip order (B5). The first version decides
   * the reference; a second one shows what it has of it, a verse it lacks warned of rather
   * than refused (B14).
   */
  async passage(versions: readonly string[], reference: Reference): Promise<Passage> {
    const [first, ...others] = versions.slice(0, MAX_WORKSPACE_VERSIONS);
    if (!first) throw new BibleRequestError('not-offered');
    const texts: PassageText[] = [await this.text(first, reference)];
    for (const version of others) {
      const own = referenceInVersion(reference, await this.toc(version));
      if (!own) {
        texts.push(await this.emptyText(version));
        continue;
      }
      try {
        texts.push(await this.text(version, own));
      } catch (error) {
        if (error instanceof BibleRequestError && error.code === 'not-found') {
          texts.push(await this.emptyText(version));
        } else throw error;
      }
    }
    return { reference: toUsfm(reference), texts };
  }

  /** A column with none of the passage, so its verses show as missing. */
  private async emptyText(version: string): Promise<PassageText> {
    const info = (this.versions_ ?? []).find((v) => v.id === version);
    return {
      version,
      credit: info?.credit ?? version,
      provider: 'freeuse',
      copyright: '',
      units: [],
      fumsToken: null,
    };
  }

  async search(version: string, query: string): Promise<BibleSearchResponse> {
    const server = this.server();
    if (!server) throw new BibleRequestError('offline');
    return server.search(version, query);
  }

  /** Reports a saved item's tokens when it is first presented in a live session (B25). */
  reportUsage(tokens: string[], liveSession: string): void {
    const server = this.server();
    if (!server || tokens.length === 0) return;
    void server.reportUsage(tokens, this.deviceId, liveSession).catch(() => undefined);
  }
}

/** The workspace's versions that apply, from its setting and what the church offers (B4). */
export function workspaceVersions(
  chosen: readonly string[],
  offered: readonly BibleVersionInfo[],
): string[] {
  const ids = offered.map((v) => v.id);
  const applied = effectiveVersions(chosen, ids);
  // With nothing chosen, the church's first offered version is used, so the window works.
  return applied.length > 0 ? applied : ids.slice(0, 1);
}
