import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fromUsfm,
  type CatalogueVersion,
  type PassageUnit,
  type Provider,
  type Reference,
} from '@worship-q/bible';
import { Availability } from './availability';
import { bibleKeysFromEnv, keysSet, type Adapters } from './config';
import { Fums, FUMS_ATTEMPTS } from './fums';
import { BibleError, CACHE_MS, Passages, verseCount } from './passages';
import { ProviderError, type ProviderAdapter, type ProviderChapter } from './providers/types';
import { searchVersion } from './search';
import { REFRESH_INDEX_MS, TocStore } from './toc';

const r = (usfm: string): Reference => fromUsfm(usfm)!;
const unit = (chapter: number, verse: number, text = `v${verse}`): PassageUnit => ({
  chapter,
  verses: [verse],
  label: String(verse),
  lines: [{ text, indent: 0 }],
});

interface FakeOptions {
  configured?: boolean;
  check?: boolean | 'throw';
  passage?: (id: string, reference: Reference) => PassageUnit[] | ProviderError;
  complete?: boolean;
  chapters?: Record<string, number>;
  search?: string[] | null;
}

/** An adapter answering from memory and counting its calls. */
function fake(name: Provider, options: FakeOptions = {}) {
  const calls: string[] = [];
  const adapter: ProviderAdapter = {
    name,
    configured: options.configured ?? true,
    async check(id) {
      calls.push(`check ${id}`);
      if (options.check === 'throw') throw new ProviderError('failed', 'down');
      return options.check ?? true;
    },
    async toc(id) {
      calls.push(`toc ${id}`);
      return {
        complete: options.complete ?? false,
        books: [
          {
            book: 'JHN',
            name: 'John',
            chapters: Array.from({ length: 21 }, (_, i) =>
              options.complete ? (options.chapters?.[`JHN.${i + 1}`] ?? 30) : null,
            ),
          },
          {
            book: 'PSA',
            name: 'Psalms',
            chapters: Array.from({ length: 150 }, () => (options.complete ? 10 : null)),
          },
        ],
      };
    },
    async chapter(id, book, chapter): Promise<ProviderChapter> {
      calls.push(`chapter ${id} ${book}.${chapter}`);
      const count = options.chapters?.[`${book}.${chapter}`] ?? 30;
      return { count, joined: [], missing: [] };
    },
    async passage(id, reference) {
      calls.push(`passage ${id}`);
      const answer = options.passage?.(id, reference) ?? [
        unit(reference.chapter, reference.verse ?? 1),
      ];
      if (answer instanceof ProviderError) throw answer;
      return {
        units: answer,
        copyright: `© ${name}`,
        fumsToken: name === 'apibible' ? 'TOKEN' : null,
      };
    },
    ...(options.search === null
      ? {}
      : {
          async search(id: string) {
            calls.push(`search ${id}`);
            return options.search ?? ['JHN.3.16', 'not a ref', 'JHN.3.16', 'MAT.5.44'];
          },
        }),
  };
  return { adapter, calls };
}

const CATALOGUE: CatalogueVersion[] = [
  {
    id: 'NIVUK',
    name: 'NIV',
    credit: 'NIVUK',
    language: 'en',
    providers: [
      { provider: 'youversion', id: '113' },
      { provider: 'apibible', id: 'ab-niv' },
    ],
  },
  {
    id: 'ESV',
    name: 'ESV',
    credit: 'ESV',
    language: 'en',
    providers: [{ provider: 'esv', id: 'ESV' }],
  },
  {
    id: 'BSB',
    name: 'BSB',
    credit: 'BSB',
    language: 'en',
    providers: [{ provider: 'freeuse', id: 'BSB' }],
  },
];

function setup(adapters: Partial<Record<Provider, ReturnType<typeof fake>>> = {}) {
  const all = {
    youversion: adapters.youversion ?? fake('youversion', { complete: true }),
    apibible: adapters.apibible ?? fake('apibible'),
    esv: adapters.esv ?? fake('esv'),
    freeuse: adapters.freeuse ?? fake('freeuse'),
  };
  const map = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.adapter])) as Adapters;
  let now = 1_000_000;
  const time = { now: () => now, advance: (ms: number) => (now += ms) };
  const dataDir = mkdtempSync(join(tmpdir(), 'wq-bible-'));
  const availability = new Availability(map, CATALOGUE);
  const tocs = new TocStore(dataDir, map, availability, time.now);
  const passages = new Passages(map, availability, tocs, time.now);
  return { all, map, availability, tocs, passages, time, dataDir };
}

describe('keys (P2.1)', () => {
  it('reads the three keys, an empty one as missing', () => {
    expect(
      bibleKeysFromEnv({
        WORSHIP_Q_YOUVERSION_KEY: 'y',
        WORSHIP_Q_API_BIBLE_KEY: ' ',
        WORSHIP_Q_ESV_KEY: 'e',
      }),
    ).toEqual({ youversion: 'y', apibible: undefined, esv: 'e' });
    expect(keysSet({ youversion: 'y' })).toEqual({ youversion: true, apibible: false, esv: false });
  });

  it('disables the providers whose key is missing', async () => {
    const yv = fake('youversion', { configured: false });
    const ab = fake('apibible', { configured: false });
    const { availability } = setup({
      youversion: yv,
      apibible: ab,
      esv: fake('esv', { configured: false }),
    });
    await availability.refresh();
    expect(availability.available('NIVUK')).toBe(false);
    expect(availability.available('ESV')).toBe(false);
    // The Free Use Bible API needs no key (§3.5).
    expect(availability.available('BSB')).toBe(true);
    expect(yv.calls).toEqual([]);
  });
});

describe('availability (P2.3)', () => {
  it('chooses the first working provider, keeping the rest for fallback', async () => {
    const { availability } = setup();
    await availability.refresh();
    expect(availability.statuses()).toEqual([
      { id: 'NIVUK', providers: ['youversion', 'apibible'], available: true },
      { id: 'ESV', providers: ['esv'], available: true },
      { id: 'BSB', providers: ['freeuse'], available: true },
    ]);
  });

  it('makes a version with no working provider unavailable, and notices a recovery', async () => {
    let refuse = true;
    const esv = fake('esv');
    esv.adapter.check = async () => !refuse;
    const { availability } = setup({ esv });
    await availability.refresh();
    expect(availability.available('ESV')).toBe(false);
    refuse = false;
    await availability.refresh();
    expect(availability.available('ESV')).toBe(true);
  });

  it('keeps trying a provider it could not reach, rather than dropping it', async () => {
    const { availability } = setup({ esv: fake('esv', { check: 'throw' }) });
    await availability.refresh();
    expect(availability.available('ESV')).toBe(true);
  });
});

describe('tables of contents (P2.4)', () => {
  it('builds from an index where one serves the version, and reads it back from disk', async () => {
    const { availability, tocs, map, dataDir, all, time } = setup();
    await availability.refresh();
    const first = await tocs.get('NIVUK');
    expect(first.toc.books[0]!.chapters[2]).toBe(30);
    expect(all.youversion.calls.filter((c) => c.startsWith('toc'))).toHaveLength(1);
    expect(readdirSync(join(dataDir, 'bible', 'toc'))).toEqual(['NIVUK.json']);
    // A new server reads the saved contents without calling.
    const again = new TocStore(dataDir, map, availability, time.now);
    expect((await again.get('NIVUK')).hash).toBe(first.hash);
    expect(all.youversion.calls.filter((c) => c.startsWith('toc'))).toHaveLength(1);
  });

  it('fetches a chapter’s verses once, the first time it is opened, and never again', async () => {
    const { availability, tocs, all } = setup();
    await availability.refresh();
    const before = await tocs.get('BSB');
    expect(before.toc.books[0]!.chapters[2]).toBeNull();
    expect(await tocs.ensureChapter('BSB', 'JHN', 3)).toBe(true);
    expect(await tocs.ensureChapter('BSB', 'JHN', 3)).toBe(true);
    const after = await tocs.get('BSB');
    expect(after.toc.books[0]!.chapters[2]).toBe(30);
    expect(after.hash).not.toBe(before.hash);
    expect(all.freeuse.calls.filter((c) => c.startsWith('chapter'))).toEqual(['chapter BSB JHN.3']);
    expect(await tocs.ensureChapter('BSB', 'JHN', 22)).toBe(false);
  });

  it('keeps a joined verse as one unit in the saved contents', async () => {
    const freeuse = fake('freeuse');
    freeuse.adapter.chapter = async () => ({ count: 14, joined: [[12, 13]], missing: [] });
    const { availability, tocs, dataDir } = setup({ freeuse });
    await availability.refresh();
    await tocs.ensureChapter('BSB', 'JHN', 16);
    const saved = JSON.parse(readFileSync(join(dataDir, 'bible', 'toc', 'BSB.json'), 'utf8'));
    expect(saved.toc.books[0].joined).toEqual([[16, 12, 13]]);
  });

  it('refreshes an index weekly, keeping it when nothing changed', async () => {
    const { availability, tocs, all, time } = setup();
    await availability.refresh();
    const first = await tocs.get('NIVUK');
    time.advance(REFRESH_INDEX_MS);
    expect((await tocs.get('NIVUK')).hash).toBe(first.hash);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(all.youversion.calls.filter((c) => c.startsWith('toc'))).toHaveLength(2);
  });
});

describe('text and fallback (P2.5)', () => {
  it('serves through the first provider, with the version’s credit', async () => {
    const { availability, passages } = setup();
    await availability.refresh();
    const text = await passages.get('NIVUK', r('JHN.3.16'));
    expect(text).toMatchObject({
      version: 'NIVUK',
      credit: 'NIVUK',
      provider: 'youversion',
      copyright: '© youversion',
    });
  });

  it('falls back on an error or a refused key, within the version’s own providers', async () => {
    const yv = fake('youversion', {
      complete: true,
      passage: () => new ProviderError('failed', 'timeout'),
    });
    const { availability, passages, all } = setup({ youversion: yv });
    await availability.refresh();
    const text = await passages.get('NIVUK', r('JHN.3.16'));
    expect(text.provider).toBe('apibible');
    expect(text.fumsToken).toBe('TOKEN');
    // Never to another edition's provider.
    expect(all.esv.calls.filter((c) => c.startsWith('passage'))).toEqual([]);
    expect(all.freeuse.calls.filter((c) => c.startsWith('passage'))).toEqual([]);
  });

  it('marks a provider refusing the key unusable for that version until the next check', async () => {
    const yv = fake('youversion', {
      complete: true,
      passage: () => new ProviderError('unauthorized', '403'),
    });
    const { availability, passages } = setup({ youversion: yv });
    await availability.refresh();
    await passages.get('NIVUK', r('JHN.3.16'));
    expect(availability.usable('NIVUK').map((p) => p.provider)).toEqual(['apibible']);
    await availability.refresh();
    expect(availability.usable('NIVUK').map((p) => p.provider)).toEqual(['youversion', 'apibible']);
  });

  it('says unavailable when every provider fails', async () => {
    const fail = () => new ProviderError('failed', 'down');
    const { availability, passages } = setup({
      youversion: fake('youversion', { complete: true, passage: fail }),
      apibible: fake('apibible', { passage: fail }),
    });
    await availability.refresh();
    await expect(passages.get('NIVUK', r('JHN.3.16'))).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('refuses a reference the contents do not have, without asking a provider', async () => {
    const { availability, passages, all } = setup();
    await availability.refresh();
    await expect(passages.get('NIVUK', r('PSA.151'))).rejects.toMatchObject({ kind: 'not-found' });
    await expect(passages.get('NIVUK', r('JHN.3.31-JHN.3.40'))).rejects.toMatchObject({
      kind: 'not-found',
    });
    expect(all.youversion.calls.filter((c) => c.startsWith('passage'))).toEqual([]);
  });

  it('keeps text in memory for a short time only', async () => {
    const { availability, passages, all, time } = setup();
    await availability.refresh();
    await passages.get('NIVUK', r('JHN.3.16'));
    await passages.get('NIVUK', r('JHN.3.16'));
    expect(all.youversion.calls.filter((c) => c.startsWith('passage'))).toHaveLength(1);
    time.advance(CACHE_MS);
    await passages.get('NIVUK', r('JHN.3.16'));
    expect(all.youversion.calls.filter((c) => c.startsWith('passage'))).toHaveLength(2);
  });

  it('never holds more than 500 of the ESV’s verses, and writes no text to disk', async () => {
    const esv = fake('esv', {
      chapters: { 'PSA.1': 200, 'PSA.2': 200, 'PSA.3': 200 },
      passage: (_, reference) =>
        Array.from({ length: reference.endVerse! - reference.verse! + 1 }, (_, i) =>
          unit(reference.chapter, i + 1),
        ),
    });
    const { availability, passages, dataDir } = setup({ esv });
    await availability.refresh();
    await passages.get('ESV', r('PSA.1.1-PSA.1.200'));
    await passages.get('ESV', r('PSA.2.1-PSA.2.200'));
    expect(passages.cacheSize().esvVerses).toBe(400);
    await passages.get('ESV', r('PSA.3.1-PSA.3.200'));
    expect(passages.cacheSize().esvVerses).toBeLessThanOrEqual(500);
    const saved = readdirSync(join(dataDir, 'bible', 'toc'));
    expect(saved).toEqual(['ESV.json']);
    expect(readFileSync(join(dataDir, 'bible', 'toc', 'ESV.json'), 'utf8')).not.toContain(
      '"lines"',
    );
  });

  it('refuses a request over 500 verses with a clear error', async () => {
    const { availability, passages } = setup();
    await availability.refresh();
    await expect(passages.get('NIVUK', r('JHN.1.1-JHN.21.25'))).rejects.toEqual(
      new BibleError('too-large', 'At most 500 verses at once'),
    );
  });

  it('counts a reference’s verses', () => {
    expect(verseCount(r('JHN.3.16-JHN.3.18'), null)).toBe(3);
    expect(verseCount(r('JHN.3'), null)).toBe(50);
    expect(
      verseCount(r('JHN.3.30-JHN.4.2'), {
        version: 'x',
        books: [{ book: 'JHN', name: 'John', chapters: [51, 36, 36] }],
      }),
    ).toBe(9);
  });
});

describe('text search (P2.7)', () => {
  it('searches through the first provider that searches, references only, once each', async () => {
    const { availability, map } = setup();
    await availability.refresh();
    expect(await searchVersion(map, availability, 'NIVUK', 'love your enemies')).toEqual({
      references: ['JHN.3.16', 'MAT.5.44'],
      searched: true,
    });
  });

  it('answers an empty list with a flag for a version no provider searches', async () => {
    const { availability, map } = setup({ freeuse: fake('freeuse', { search: null }) });
    await availability.refresh();
    expect(await searchVersion(map, availability, 'BSB', '上帝爱世人')).toEqual({
      references: [],
      searched: false,
    });
  });

  it('keeps at most 20 references', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `PSA.${i + 1}.1`);
    const { availability, map } = setup({
      youversion: fake('youversion', { complete: true, search: many }),
    });
    await availability.refresh();
    expect((await searchVersion(map, availability, 'NIVUK', 'praise')).references).toHaveLength(20);
  });
});

describe('usage reporting (P2.8)', () => {
  const recorder = (ok: () => boolean = () => true) => {
    const urls: string[] = [];
    const fums = new Fums(async (url) => {
      urls.push(url);
      return new Response('', { status: ok() ? 200 : 500 });
    });
    return { urls, fums };
  };

  it('reports a served token once, with the device and session', async () => {
    const { urls, fums } = recorder();
    fums.report(['A'], 'device-1', 'session-1');
    await fums.flush();
    await fums.flush();
    expect(urls).toEqual(['https://fums.api.bible/f3?t=A&dId=device-1&sId=session-1']);
  });

  it('reports a resent token again, and batches tokens of one session', async () => {
    const { urls, fums } = recorder();
    fums.report(['A'], 'd', 's');
    fums.report(['A', 'B'], 'd', 's');
    await fums.flush();
    expect(urls).toEqual(['https://fums.api.bible/f3?t=A&t=A&t=B&dId=d&sId=s']);
  });

  it('retries a failure in the background, a few times at most', async () => {
    let up = false;
    const { urls, fums } = recorder(() => up);
    fums.report(['A'], 'd', 's');
    await fums.flush();
    expect(fums.pending).toBe(1);
    up = true;
    await fums.flush();
    expect(fums.pending).toBe(0);
    expect(urls).toHaveLength(2);

    const down = recorder(() => false);
    down.fums.report(['B'], 'd', 's');
    for (let i = 0; i < FUMS_ATTEMPTS + 2; i++) await down.fums.flush();
    expect(down.urls).toHaveLength(FUMS_ATTEMPTS);
    expect(down.fums.pending).toBe(0);
  });

  it('never blocks: a report returns at once, before anything is sent', () => {
    const { urls, fums } = recorder();
    fums.report(['A'], 'd', 's');
    expect(urls).toEqual([]);
  });
});
