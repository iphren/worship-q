import { describe, expect, it } from 'vitest';
import {
  fromUsfm,
  songSearchReference,
  toUsfm,
  type BibleTocResponse,
  type BibleVersionInfo,
  type PassageText,
  type Reference,
  type Toc,
} from '@worship-q/protocol';
import { BibleClient, BibleRequestError, workspaceVersions, type BibleServer } from './bible';
import { bibleWindow } from '@worship-q/protocol';

const {
  backTo,
  canContinue,
  checkReference,
  continueToNextChapter,
  INITIAL,
  isSelected,
  openAt,
  pickBook,
  pickChapter,
  pickVerse,
  referenceInVersion,
  selectedReference,
  typed,
  verseCells,
} = bibleWindow;

const r = (usfm: string): Reference => fromUsfm(usfm)!;
const usfm = (state: Parameters<typeof selectedReference>[0]) => {
  const ref = selectedReference(state);
  return ref ? toUsfm(ref) : null;
};

const NIV: Toc = {
  version: 'NIVUK',
  books: [
    {
      book: 'PSA',
      name: 'Psalms',
      abbreviation: 'Ps',
      chapters: Array.from({ length: 150 }, () => 10),
    },
    {
      book: 'MRK',
      name: 'Mark',
      abbreviation: 'Mk',
      chapters: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
    },
    {
      book: 'REV',
      name: 'Revelation',
      chapters: Array.from({ length: 22 }, (_, i) => (i === 11 ? 17 : 20)),
    },
    { book: '1CH', name: '1 Chronicles', chapters: Array.from({ length: 29 }, () => 43) },
  ],
};
const CCB: Toc = {
  version: 'CCB',
  books: [
    {
      book: 'MRK',
      name: '马可福音',
      abbreviation: '可',
      chapters: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
    },
    {
      book: 'REV',
      name: '启示录',
      chapters: Array.from({ length: 22 }, (_, i) => (i === 11 ? 18 : 20)),
    },
    {
      book: '1CH',
      name: '历代志上',
      chapters: Array.from({ length: 29 }, () => 43),
      joined: [[16, 12, 13]],
    },
  ],
};

describe('the Bible window (§3.4)', () => {
  it('shows chapters when a book is typed, and verses with nothing chosen for a chapter', () => {
    expect(typed('Mark', NIV)).toMatchObject({ level: 'chapters', book: 'MRK', first: null });
    const chapter = typed('Mark 15', NIV);
    expect(chapter).toMatchObject({
      level: 'verses',
      book: 'MRK',
      chapter: 15,
      first: null,
      last: null,
    });
    // With nothing chosen, the whole chapter is what would be added.
    expect(usfm(chapter)).toBe('MRK.15');
  });

  it('chooses the verses typed, and the version’s own names work', () => {
    expect(usfm(typed('Mark 15:5-6', NIV))).toBe('MRK.15.5-MRK.15.6');
    expect(usfm(typed('马可福音15章5-6节', NIV))).toBe('MRK.15.5-MRK.15.6');
    expect(usfm(typed('历代志上 16:12', CCB))).toBe('1CH.16.12');
    expect(usfm(typed('Gen 1:31-2:3', NIV))).toBe('GEN.1.31-GEN.2.3');
  });

  it('lists the books an ambiguous prefix shares', () => {
    expect(typed('Jo', NIV)).toMatchObject({
      level: 'books',
      candidates: ['JOS', 'JOB', 'JOL', 'JON', 'JHN'],
    });
  });

  it('searches the words only when the text is not a reference', () => {
    expect(typed('love your enemies', NIV).searchText).toBe('love your enemies');
    expect(typed('Mark 15:5', NIV).searchText).toBeNull();
    expect(typed('Jo', NIV).searchText).toBeNull();
    expect(typed('  ', NIV).searchText).toBeNull();
  });

  it('chooses a range by first and last verse, in either order', () => {
    const chapter = pickChapter(pickBook(INITIAL, 'MRK', 'en'), 15, 'en');
    expect(chapter.input).toBe('Mark 15');
    const first = pickVerse(chapter, 5, 'en');
    expect(usfm(first)).toBe('MRK.15.5');
    expect(first.input).toBe('Mark 15:5');
    const range = pickVerse(first, 8, 'en');
    expect(usfm(range)).toBe('MRK.15.5-MRK.15.8');
    expect(range.input).toBe('Mark 15:5–8');
    expect(isSelected(range, 15, 6)).toBe(true);
    expect(isSelected(range, 15, 9)).toBe(false);
    const backwards = pickVerse(pickVerse(chapter, 8, 'en'), 5, 'en');
    expect(usfm(backwards)).toBe('MRK.15.5-MRK.15.8');
  });

  it('chooses one verse when it is clicked twice, and starts again on a third click', () => {
    const chapter = pickChapter(pickBook(INITIAL, 'MRK', 'en'), 15, 'en');
    const once = pickVerse(pickVerse(chapter, 5, 'en'), 5, 'en');
    expect(usfm(once)).toBe('MRK.15.5');
    const again = pickVerse(pickVerse(pickVerse(chapter, 5, 'en'), 8, 'en'), 2, 'en');
    expect(usfm(again)).toBe('MRK.15.2');
    expect(again.last).toBeNull();
    // A typed range is complete: a click starts again too.
    expect(usfm(pickVerse(typed('Mark 15:5-6', NIV), 9, 'en'))).toBe('MRK.15.9');
  });

  it('writes the box in the first version’s language', () => {
    const chapter = pickChapter(pickBook(INITIAL, 'MRK', 'zh-Hans'), 15, 'zh-Hans');
    expect(chapter.input).toBe('马可福音 15');
    expect(pickVerse(pickVerse(chapter, 5, 'zh-Hans'), 6, 'zh-Hans').input).toBe('马可福音 15:5-6');
  });

  it('goes back by the breadcrumb, keeping the box in step', () => {
    const range = typed('Mark 15:5-6', NIV);
    const chapters = backTo(range, 'chapters', 'en');
    expect(chapters).toMatchObject({
      level: 'chapters',
      book: 'MRK',
      chapter: null,
      first: null,
      input: 'Mark',
    });
    const verses = backTo(range, 'verses', 'en');
    expect(verses).toMatchObject({ level: 'verses', chapter: 15, first: null, input: 'Mark 15' });
    expect(backTo(range, 'books', 'en')).toEqual(INITIAL);
  });

  it('carries a range on into the next chapter', () => {
    const first = pickVerse(pickChapter(pickBook(INITIAL, 'MRK', 'en'), 15, 'en'), 40, 'en');
    expect(canContinue(first, NIV)).toBe(true);
    const next = continueToNextChapter(first, NIV, 'en');
    expect(next.chapter).toBe(16);
    expect(usfm(pickVerse(next, 3, 'en'))).toBe('MRK.15.40-MRK.16.3');
    const last = pickVerse(pickChapter(pickBook(INITIAL, 'MRK', 'en'), 16, 'en'), 1, 'en');
    expect(canContinue(last, NIV)).toBe(false);
  });

  it('says when a reference is not in the version, offering the nearest chapter; nothing is presented', () => {
    expect(checkReference(typed('Psalm 151', NIV), NIV)).toEqual({
      kind: 'no-chapter',
      book: 'PSA',
      chapter: 151,
      nearest: 150,
    });
    expect(checkReference(typed('Mark 16:21', NIV), NIV)).toMatchObject({
      kind: 'no-verse',
      verses: 20,
    });
    expect(checkReference(typed('Mark 15:5', NIV), NIV)).toMatchObject({ kind: 'ok' });
    expect(checkReference(typed('Mark 15:5', NIV), null)).toMatchObject({ kind: 'loading' });
    expect(checkReference(typed('Gen 1', NIV), NIV)).toMatchObject({ kind: 'no-book' });
  });

  it('opens at an item’s reference, for editing', () => {
    const state = openAt(r('MRK.15.5-MRK.15.6'), NIV, 'en');
    expect(state).toMatchObject({
      level: 'verses',
      book: 'MRK',
      chapter: 15,
      input: 'Mark 15:5–6',
    });
    expect(usfm(state)).toBe('MRK.15.5-MRK.15.6');
    expect(openAt(null, NIV, 'en')).toEqual(INITIAL);
  });

  it('shows joined verses as one cell', () => {
    const cells = verseCells(typed('历代志上 16', CCB), CCB)!;
    expect(cells.find((c) => c.verse === 12)).toEqual({ verse: 12, last: 13, label: '12-13' });
  });

  it('trims a second version’s reference to the verses it has (B14)', () => {
    expect(toUsfm(referenceInVersion(r('REV.12.17-REV.12.18'), NIV)!)).toBe('REV.12.17');
    expect(referenceInVersion(r('REV.12.18'), NIV)).toBeNull();
    expect(toUsfm(referenceInVersion(r('REV.12.17-REV.12.18'), CCB)!)).toBe('REV.12.17-REV.12.18');
    expect(referenceInVersion(r('PSA.23'), CCB)).toBeNull();
    expect(toUsfm(referenceInVersion(r('MRK.15'), CCB)!)).toBe('MRK.15');
  });
});

describe('the song search’s reference row (P4.6, B9)', () => {
  it('offers a reference for Mark 15:5 and 可15:5, none for a song title', () => {
    expect(toUsfm(songSearchReference('Mark 15:5')!)).toBe('MRK.15.5');
    expect(toUsfm(songSearchReference('可15:5')!)).toBe('MRK.15.5');
    expect(songSearchReference('Amazing grace')).toBeNull();
  });
});

class FakeServer implements BibleServer {
  calls: string[] = [];
  hash = 'h1';
  offline = false;
  versionsList: BibleVersionInfo[] = [
    { id: 'NIVUK', name: 'NIV', credit: 'NIVUK', language: 'en', tocHash: 'h1' },
    { id: 'CCB', name: '当代译本', credit: '当代译本', language: 'zh-Hans', tocHash: 'c1' },
  ];
  async versions() {
    this.calls.push('versions');
    if (this.offline) throw new Error('offline');
    return this.versionsList;
  }
  async toc(
    version: string,
    chapter?: { book: string; chapter: number },
  ): Promise<BibleTocResponse> {
    this.calls.push(`toc ${version}${chapter ? ` ${chapter.book}.${chapter.chapter}` : ''}`);
    if (this.offline) throw new Error('offline');
    const toc = version === 'CCB' ? CCB : NIV;
    return { toc, hash: version === 'CCB' ? 'c1' : this.hash };
  }
  async passage(version: string, ref: string): Promise<PassageText> {
    this.calls.push(`passage ${version} ${ref}`);
    if (this.offline) throw new TypeError('Failed to fetch');
    const reference = fromUsfm(ref)!;
    if (version === 'NIVUK' && reference.chapter === 12 && (reference.endVerse ?? 0) > 17) {
      throw new BibleRequestError('not-found');
    }
    const units = [];
    for (let v = reference.verse ?? 1; v <= (reference.endVerse ?? 3); v++) {
      units.push({
        chapter: reference.chapter,
        verses: [v],
        label: String(v),
        lines: [{ text: `${version} ${v}`, indent: 0 }],
      });
    }
    return {
      version,
      credit: version,
      provider: 'youversion',
      copyright: '',
      units,
      fumsToken: null,
    };
  }
  async search() {
    return { references: [], searched: true };
  }
  reported: [string[], string, string][] = [];
  async reportUsage(tokens: string[], device: string, session: string) {
    this.reported.push([tokens, device, session]);
  }
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe('the Bible client (P4.1)', () => {
  const setup = (server: FakeServer | null = new FakeServer(), storage = memoryStorage()) => ({
    server,
    storage,
    client: new BibleClient(
      () => server,
      () => storage,
      () => 'https://church',
    ),
  });

  it('reads the saved contents without a request', async () => {
    const { server, storage } = setup();
    const first = new BibleClient(
      () => server,
      () => storage,
      () => 'https://church',
    );
    await first.versions();
    await first.toc('NIVUK');
    expect(server!.calls).toEqual(['versions', 'toc NIVUK']);
    // A later run, the hash unchanged: no request for the contents.
    const later = new BibleClient(
      () => server,
      () => storage,
      () => 'https://church',
    );
    await later.versions();
    expect(await later.toc('NIVUK')).toEqual(NIV);
    expect(server!.calls).toEqual(['versions', 'toc NIVUK', 'versions']);
  });

  it('refreshes the saved contents when the server’s change', async () => {
    const { server, client } = setup();
    await client.versions();
    await client.toc('NIVUK');
    server!.hash = 'h2';
    server!.versionsList = server!.versionsList.map((v) =>
      v.id === 'NIVUK' ? { ...v, tocHash: 'h2' } : v,
    );
    await client.versions();
    await client.toc('NIVUK');
    expect(server!.calls.filter((c) => c === 'toc NIVUK')).toHaveLength(2);
  });

  it('offline, gives the saved contents and versions, and a clear error for text', async () => {
    const { server, storage, client } = setup();
    await client.versions();
    await client.toc('NIVUK');
    server!.offline = true;
    const later = new BibleClient(
      () => server,
      () => storage,
      () => 'https://church',
    );
    expect((await later.versions()).map((v) => v.id)).toEqual(['NIVUK', 'CCB']);
    expect(await later.toc('NIVUK')).toEqual(NIV);
    await expect(later.text('NIVUK', r('MRK.15.5'))).rejects.toMatchObject({ code: 'offline' });
    const none = new BibleClient(
      () => null,
      () => storage,
      () => 'https://church',
    );
    await expect(none.text('NIVUK', r('MRK.15.5'))).rejects.toBeInstanceOf(BibleRequestError);
  });

  it('keeps one church server’s contents apart from another’s', async () => {
    const storage = memoryStorage();
    const server = new FakeServer();
    await new BibleClient(
      () => server,
      () => storage,
      () => 'https://a',
    ).toc('NIVUK');
    server.offline = true;
    expect(
      await new BibleClient(
        () => server,
        () => storage,
        () => 'https://b',
      ).toc('NIVUK'),
    ).toBeNull();
  });

  it('fetches a chapter’s verses the first time it is opened', async () => {
    const server = new FakeServer();
    const partial: Toc = {
      version: 'NLT',
      books: [{ book: 'MRK', name: 'Mark', chapters: [null, null] }],
    };
    server.toc = async (version, chapter) => {
      server.calls.push(`toc ${version}${chapter ? ` ${chapter.book}.${chapter.chapter}` : ''}`);
      return chapter
        ? {
            toc: { ...partial, books: [{ ...partial.books[0]!, chapters: [45, null] }] },
            hash: 'n2',
          }
        : { toc: partial, hash: 'n1' };
    };
    const { client } = setup(server);
    const toc = await client.tocWithChapter('NLT', 'MRK', 1);
    expect(toc!.books[0]!.chapters).toEqual([45, null]);
    await client.tocWithChapter('NLT', 'MRK', 1);
    expect(server.calls.filter((c) => c.includes('MRK.1'))).toHaveLength(1);
  });

  it('fetches both versions in chip order, a second one trimmed to what it has', async () => {
    const { client, server } = setup();
    await client.versions();
    const passage = await client.passage(['CCB', 'NIVUK'], r('REV.12.17-REV.12.18'));
    expect(passage.texts.map((t) => t.version)).toEqual(['CCB', 'NIVUK']);
    expect(server!.calls).toContain('passage NIVUK REV.12.17');
    expect(passage.texts[1]!.units.map((u) => u.label)).toEqual(['17']);
  });

  it('gives a second version with none of the passage an empty column', async () => {
    const { client } = setup();
    await client.versions();
    const passage = await client.passage(['CCB', 'NIVUK'], r('REV.12.18'));
    expect(passage.texts[1]).toMatchObject({ version: 'NIVUK', units: [] });
  });

  it('reports with a stable random computer id and the session given', async () => {
    const { client, server, storage } = setup();
    client.reportUsage(['T'], 'live-1');
    await Promise.resolve();
    const again = new BibleClient(
      () => server,
      () => storage,
      () => 'https://church',
    );
    again.reportUsage(['U'], 'live-2');
    await Promise.resolve();
    expect(server!.reported.map(([, device]) => device)).toEqual([
      client.deviceId,
      client.deviceId,
    ]);
    expect(client.deviceId).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('the workspace’s versions (P4.4)', () => {
  const offered: BibleVersionInfo[] = [
    { id: 'NIVUK', name: '', credit: '', language: 'en' },
    { id: 'CCB', name: '', credit: '', language: 'zh-Hans' },
  ];
  it('applies the chosen ones still offered, else the church’s first', () => {
    expect(workspaceVersions(['CCB', 'NIVUK'], offered)).toEqual(['CCB', 'NIVUK']);
    expect(workspaceVersions(['ESV'], offered)).toEqual(['NIVUK']);
    expect(workspaceVersions([], [])).toEqual([]);
  });
});
