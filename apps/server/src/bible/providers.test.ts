import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { align, fromUsfm, type PassageUnit, type Reference } from '@worship-q/bible';
import { ApiBible, chapterFromVerseIds } from './providers/apibible';
import { Esv, esvQuery } from './providers/esv';
import { FreeUse } from './providers/freeuse';
import { ProviderError, type Fetch } from './providers/types';
import { indexChapter, tocFromIndex, YouVersion, youVersionPassages } from './providers/youversion';

const fixture = (path: string) =>
  readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');

/** Answers each URL from the recorded fixtures; anything else is a 404. */
export function fixtureFetch(
  routes: Record<string, string | { status: number; body?: unknown }>,
  calls: string[] = [],
): Fetch {
  return async (url) => {
    calls.push(url);
    const key = Object.keys(routes).find((prefix) => url.includes(prefix));
    const route = key === undefined ? { status: 404 } : routes[key]!;
    if (typeof route === 'string') return new Response(fixture(route), { status: 200 });
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status });
  };
}

const r = (usfm: string): Reference => fromUsfm(usfm)!;
const labels = (units: PassageUnit[]) =>
  units.map((u) => (u.title ? 'title' : `${u.chapter}:${u.label}`));
const words = (units: PassageUnit[]) =>
  units.map((u) =>
    u.lines
      .map((l) => l.text)
      .join(' ')
      .replace(/\s+/g, ' '),
  );

const YV_BIBLE = { status: 200, body: { copyright: '© Biblica' } };
const youversion = (id: string, range: string, file: string) =>
  new YouVersion(
    'key',
    fixtureFetch({
      [`/passages/${range}?`]: `youversion/${id}-${file}.json`,
      [`/bibles/${id}`]: YV_BIBLE,
    }),
  );
const apibible = (id: string, range: string) =>
  new ApiBible('key', fixtureFetch({ [`/passages/${range}?`]: `apibible/${id}-${range}.json` }));
const esv = (file: string) =>
  new Esv('key', fixtureFetch({ '/passage/html/': `esv/${file}.json` }));
const freeuse = (id: string, chapter: string) =>
  new FreeUse(
    fixtureFetch({ [`/${id}/${chapter.replace('.', '/')}.json`]: `freeuse/${id}-${chapter}.json` }),
  );

const NIVUK_YV = '113';
const CCB_YV = '36';
const BSB_YV = '3034';
const NIVUK_AB = '3e2eb613d45e131e-01';
const KJV_AB = 'de4e12af7f28f599-01';
const OCCB_AB = '7ea794434e9ea7ee-01';

describe('provider adapters on recorded answers (P2.2)', () => {
  it('give the same units for John 3:16–18 from every provider', async () => {
    const ref = r('JHN.3.16-JHN.3.18');
    const all = await Promise.all([
      youversion(NIVUK_YV, 'JHN.3.16-18', 'JHN.3.16-18').passage(NIVUK_YV, ref),
      youversion(CCB_YV, 'JHN.3.16-18', 'JHN.3.16-18').passage(CCB_YV, ref),
      youversion(BSB_YV, 'JHN.3.16-18', 'JHN.3.16-18').passage(BSB_YV, ref),
      apibible(NIVUK_AB, 'JHN.3.16-JHN.3.18').passage(NIVUK_AB, ref),
      apibible(KJV_AB, 'JHN.3.16-JHN.3.18').passage(KJV_AB, ref),
      apibible(OCCB_AB, 'JHN.3.16-JHN.3.18').passage(OCCB_AB, ref),
      esv('John_3.16-18').passage('ESV', ref),
      freeuse('BSB', 'JHN.3').passage('BSB', ref),
      freeuse('cmn_cu1', 'JHN.3').passage('cmn_cu1', ref),
    ]);
    for (const passage of all) expect(labels(passage.units)).toEqual(['3:16', '3:17', '3:18']);
    // One edition, two providers: the same words, so fallback changes nothing on screen.
    expect(words(all[0]!.units)).toEqual(words(all[3]!.units));
    expect(words(all[2]!.units)).toEqual(words(all[7]!.units));
    expect(words(all[0]!.units)[0]).toMatch(/^For God so loved the world/);
    // Notes and headings are gone.
    expect(words(all[6]!.units).join(' ')).not.toMatch(/For God So Loved the World|ESV/);
  });

  it('keep the copyright line and API.Bible’s usage token', async () => {
    const ref = r('JHN.3.16-JHN.3.18');
    const ab = new ApiBible(
      'key',
      fixtureFetch({
        '/passages/': {
          status: 200,
          body: {
            ...JSON.parse(fixture(`apibible/${NIVUK_AB}-JHN.3.16-JHN.3.18.json`)),
            meta: { fumsToken: 'T1' },
          },
        },
      }),
    );
    const passage = await ab.passage(NIVUK_AB, ref);
    expect(passage.fumsToken).toBe('T1');
    expect(passage.copyright).toMatch(/New International Version/);
    const yv = await youversion(NIVUK_YV, 'JHN.3.16-18', 'JHN.3.16-18').passage(NIVUK_YV, ref);
    expect(yv.copyright).toBe('© Biblica');
    expect(yv.fumsToken).toBeNull();
  });

  it('read joined verses: 1 Chronicles 16:12–13 in CCB and CUNP', async () => {
    const ref = r('1CH.16.11-1CH.16.14');
    const ccb = await youversion(CCB_YV, '1CH.16.11-14', '1CH.16.11-14').passage(CCB_YV, ref);
    const open = await apibible(OCCB_AB, '1CH.16.11-1CH.16.14').passage(OCCB_AB, ref);
    const cunp = await freeuse('cmn_cu1', '1CH.16').passage('cmn_cu1', ref);
    const niv = await youversion(NIVUK_YV, '1CH.16.11-14', '1CH.16.11-14').passage(NIVUK_YV, ref);
    for (const passage of [ccb, open, cunp]) {
      expect(labels(passage.units)).toEqual(['16:11', '16:12-13', '16:14']);
      expect(passage.units[1]!.verses).toEqual([12, 13]);
    }
    expect(labels(niv.units)).toEqual(['16:11', '16:12', '16:13', '16:14']);
  });

  it('keep poetry lines and a psalm’s title', async () => {
    const ref = r('PSA.23');
    const niv = await youversion(NIVUK_YV, 'PSA.23', 'PSA.23').passage(NIVUK_YV, ref);
    expect(niv.units[0]!.title).toBe(true);
    expect(niv.units[2]!.lines.map((line) => line.indent)).toEqual([1, 0]);
    // A footnote inside a line is gone.
    expect(words(niv.units).join(' ')).not.toMatch(/shadow of death/);
    const es = await esv('Psalm_23').passage('ESV', ref);
    expect(es.units[0]!.title).toBe(true);
    expect(labels(es.units).slice(1)).toEqual(['23:1', '23:2', '23:3', '23:4', '23:5', '23:6']);
    const bsb = await freeuse('BSB', 'PSA.23').passage('BSB', ref);
    expect(bsb.units[0]).toMatchObject({ title: true, lines: [{ text: 'A Psalm of David.' }] });
    expect(bsb.units[1]!.lines.map((l) => l.indent)).toEqual([0, 1]);
  });

  it('read a range across chapters', async () => {
    const passage = await esv('Genesis_1.31-2.3').passage('ESV', r('GEN.1.31-GEN.2.3'));
    expect(labels(passage.units)).toEqual(['1:31', '2:1', '2:2', '2:3']);
  });

  it('let a verse a version omits go missing, and align it with a warning', async () => {
    const ref = r('MAT.17.20-MAT.17.22');
    const niv = await youversion(NIVUK_YV, 'MAT.17.20-22', 'MAT.17.20-22').passage(NIVUK_YV, ref);
    const ccb = await youversion(CCB_YV, 'MAT.17.20-22', 'MAT.17.20-22').passage(CCB_YV, ref);
    expect(labels(niv.units)).toEqual(['17:20', '17:22']);
    expect(labels(ccb.units)).toEqual(['17:20', '17:21', '17:22']);
    const aligned = align({
      reference: 'MAT.17.20-MAT.17.22',
      texts: [
        {
          version: 'NIVUK',
          credit: 'NIVUK',
          provider: 'youversion',
          copyright: '',
          units: niv.units,
          fumsToken: null,
        },
        {
          version: 'CCB',
          credit: '当代译本',
          provider: 'youversion',
          copyright: '',
          units: ccb.units,
          fumsToken: null,
        },
      ],
    });
    expect(aligned.warnings).toMatchObject([{ kind: 'missing', version: 'NIVUK', verses: [21] }]);
  });

  it('see Revelation 12:18 in CCB and not in NIVUK', async () => {
    const ref = r('REV.12.17-REV.12.18');
    const niv = await youversion(NIVUK_YV, 'REV.12.17-18', 'REV.12.17-18').passage(NIVUK_YV, ref);
    const cunp = await freeuse('cmn_cu1', 'REV.12').passage('cmn_cu1', ref);
    expect(labels(niv.units)).toEqual(['12:17']);
    expect(labels(cunp.units)).toEqual(['12:17', '12:18']);
  });

  it('refuse Psalm 151 rather than clamping it to Psalm 150 (ESV)', async () => {
    const clamped = new Esv(
      'key',
      fixtureFetch({
        '/passage/html/': {
          status: 200,
          body: {
            parsed: [[19150001, 19150006]],
            passages: ['<p><b class="verse-num" id="v19150001-1">1</b>Praise</p>'],
          },
        },
      }),
    );
    await expect(clamped.passage('ESV', r('PSA.151'))).rejects.toMatchObject({ kind: 'not-found' });
    const shortened = new Esv(
      'key',
      fixtureFetch({
        '/passage/html/': { status: 200, body: { parsed: [[64001010, 64001014]], passages: [''] } },
      }),
    );
    await expect(shortened.passage('ESV', r('3JN.1.10-3JN.1.15'))).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('refuse a verse past the chapter’s end rather than slicing short (Free Use)', async () => {
    await expect(
      freeuse('cmn_cu1', 'REV.12').passage('cmn_cu1', r('REV.12.17-REV.12.19')),
    ).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('mark a 401 or 403 as unauthorized, and a 404 as not found', async () => {
    for (const status of [401, 403]) {
      const yv = new YouVersion('key', fixtureFetch({ '/passages/': { status } }));
      await expect(yv.passage('36', r('JHN.3.16'))).rejects.toMatchObject({ kind: 'unauthorized' });
      expect(await yv.check('36')).toBe(false);
    }
    const missing = new YouVersion('key', fixtureFetch({}));
    await expect(missing.passage('113', r('PSA.151'))).rejects.toMatchObject({ kind: 'not-found' });
    const down = new YouVersion('key', async () => {
      throw new Error('ECONNRESET');
    });
    await expect(down.passage('113', r('JHN.3.16'))).rejects.toBeInstanceOf(ProviderError);
    await expect(down.passage('113', r('JHN.3.16'))).rejects.toMatchObject({ kind: 'failed' });
  });

  it('never call a provider without its key', async () => {
    const calls: string[] = [];
    const yv = new YouVersion(undefined, fixtureFetch({}, calls));
    expect(yv.configured).toBe(false);
    await expect(yv.passage('113', r('JHN.3.16'))).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(calls).toEqual([]);
  });

  it('send the key in a header, never in the address', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const yv = new YouVersion('SECRET', async (url, init) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return new Response('{}', { status: 404 });
    });
    await yv.passage('113', r('JHN.3.16')).catch(() => undefined);
    expect(seen[0]!.url).not.toContain('SECRET');
    expect(seen[0]!.headers['X-YVP-App-Key']).toBe('SECRET');
  });
});

describe('provider requests', () => {
  it('split YouVersion’s ranges at chapters', () => {
    expect(youVersionPassages(r('JHN.3.16-JHN.3.18'))).toEqual([
      { usfm: 'JHN.3.16-18', chapter: 3 },
    ]);
    expect(youVersionPassages(r('JHN.3.16'))).toEqual([{ usfm: 'JHN.3.16', chapter: 3 }]);
    expect(youVersionPassages(r('PSA.23'))).toEqual([{ usfm: 'PSA.23', chapter: 23 }]);
    expect(youVersionPassages(r('GEN.1.31-GEN.2.3'))).toEqual([
      { usfm: 'GEN.1', chapter: 1 },
      { usfm: 'GEN.2', chapter: 2 },
    ]);
  });

  it('join YouVersion’s chapters and trim them to the range', async () => {
    const chapter = (c: number, verses: number) =>
      `<div class="p">${Array.from({ length: verses }, (_, i) => `<span class="yv-v" v="${i + 1}"></span><span class="yv-vlbl">${i + 1}</span>Verse ${c}.${i + 1}`).join(' ')}</div>`;
    const yv = new YouVersion(
      'key',
      fixtureFetch({
        '/passages/GEN.1?': { status: 200, body: { content: chapter(1, 31) } },
        '/passages/GEN.2?': { status: 200, body: { content: chapter(2, 25) } },
        '/bibles/3034': { status: 200, body: { copyright: '' } },
      }),
    );
    const passage = await yv.passage('3034', r('GEN.1.31-GEN.2.3'));
    expect(labels(passage.units)).toEqual(['1:31', '2:1', '2:2', '2:3']);
  });

  it('write the ESV’s English references', () => {
    expect(esvQuery(r('JHN.3.16-JHN.3.18'))).toBe('John 3:16-18');
    expect(esvQuery(r('PSA.23'))).toBe('Psalm 23');
    expect(esvQuery(r('GEN.1.31-GEN.2.3'))).toBe('Genesis 1:31-2:3');
    expect(esvQuery(r('1CO.13.4'))).toBe('1 Corinthians 13:4');
  });

  it('read YouVersion’s index into the compact contents, joined and missing verses kept', () => {
    const verses = (ids: string[]) =>
      ids.map((id) => ({ id, passage_id: id, title: id.split('.').pop() }));
    const toc = tocFromIndex([
      {
        id: '1CH',
        title: '历代志上',
        abbreviation: '代上',
        chapters: [
          {
            id: '1CH.16',
            passage_id: '1CH.16',
            title: '16',
            verses: verses(['1CH.16.11', '1CH.16.12-13', '1CH.16.14']),
          },
        ],
      },
      {
        id: 'MAT',
        title: 'Matthew',
        chapters: [{ id: 'MAT.17', title: '17', verses: verses(['MAT.17.20', 'MAT.17.22']) }],
      },
      { id: 'INTRO', title: 'x' },
    ]);
    expect(toc).toEqual([
      {
        book: '1CH',
        name: '历代志上',
        abbreviation: '代上',
        chapters: [14],
        joined: [[1, 12, 13]],
        missing: [
          [1, 1],
          [1, 2],
          [1, 3],
          [1, 4],
          [1, 5],
          [1, 6],
          [1, 7],
          [1, 8],
          [1, 9],
          [1, 10],
        ],
      },
      { book: 'MAT', name: 'Matthew', chapters: [22], missing: expect.arrayContaining([[1, 21]]) },
    ]);
    expect(indexChapter({ verses: [{ title: '1' }, { title: '2-3' }] })).toEqual({
      count: 3,
      joined: [[2, 3]],
      missing: [],
    });
  });

  it('read API.Bible’s verse list, a joined verse as one', () => {
    expect(chapterFromVerseIds(['1CH.16.11', '1CH.16.12-1CH.16.13', '1CH.16.14'])).toEqual({
      count: 14,
      joined: [[12, 13]],
      missing: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
  });

  it('look up an API.Bible version by its abbreviation, with one call for all', async () => {
    const calls: string[] = [];
    const ab = new ApiBible(
      'key',
      fixtureFetch(
        {
          '/v1/bibles?': { status: 200, body: {} },
          '/v1/bibles': {
            status: 200,
            body: {
              data: [
                { id: 'nlt-id', abbreviation: 'NLT' },
                { id: NIVUK_AB, abbreviation: 'NIVUK' },
              ],
            },
          },
        },
        calls,
      ),
    );
    const usable = await ab.checkAll(['abbr:NLT', NIVUK_AB, 'abbr:XYZ', 'other']);
    expect([...usable].sort()).toEqual([NIVUK_AB, 'abbr:NLT'].sort());
    expect(calls).toHaveLength(1);
  });

  it('read the Free Use contents and a chapter’s joined verses from gaps', async () => {
    const fu = new FreeUse(
      fixtureFetch({
        '/cmn_cu1/books.json': {
          status: 200,
          body: { books: [{ id: '1CH', commonName: '历代志上', numberOfChapters: 29 }] },
        },
        '/cmn_cu1/1CH/16.json': 'freeuse/cmn_cu1-1CH.16.json',
      }),
    );
    const toc = await fu.toc('cmn_cu1');
    expect(toc.books[0]).toMatchObject({ book: '1CH', name: '历代志上' });
    expect(toc.books[0]!.chapters).toHaveLength(29);
    const chapter = await fu.chapter('cmn_cu1', '1CH', 16);
    expect(chapter.joined).toContainEqual([12, 13]);
  });
});
