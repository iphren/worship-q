import { describe, expect, it } from 'vitest';
import {
  BOOKS,
  BUILT_IN_NAMES,
  CATALOGUE,
  PROVIDERS,
  PassageSchema,
  align,
  bookNames,
  budgetFor,
  chapterVerses,
  describeWarning,
  estimateLines,
  formatReference,
  fromUsfm,
  nameKey,
  nextChapter,
  parseReference,
  passagePieces,
  passagePlainText,
  songSearchReference,
  toUsfm,
  tocNames,
  validate,
  verseReference,
  chapterReference,
  SIDE_BY_SIDE_BUDGET,
  type Passage,
  type PassageText,
  type PassageUnit,
  type Toc,
} from './index';

const ref = (input: string) => {
  const result = parseReference(input);
  return result.kind === 'reference' ? toUsfm(result.reference) : result;
};

describe('books (P1.1)', () => {
  it('has the 66 books in order, each in one testament and group', () => {
    expect(BOOKS).toHaveLength(66);
    expect(BOOKS[0]!.id).toBe('GEN');
    expect(BOOKS[39]!.id).toBe('MAT');
    expect(BOOKS[65]!.id).toBe('REV');
    expect(BOOKS.filter((b) => b.testament === 'old')).toHaveLength(39);
    expect(BOOKS.find((b) => b.id === 'ACT')!.group).toBe('acts');
    expect(BOOKS.find((b) => b.id === 'PSA')!.group).toBe('poetry');
  });

  it('resolves every alias to exactly one book', () => {
    for (const book of BOOKS) {
      for (const name of bookNames(book)) expect(BUILT_IN_NAMES.get(nameKey(name))).toBe(book.id);
    }
  });

  it('knows the forms volunteers type', () => {
    const names: [string, string][] = [
      ['Mark', 'MRK'],
      ['Mar', 'MRK'],
      ['Mk', 'MRK'],
      ['1 Cor', '1CO'],
      ['1Co', '1CO'],
      ['Ps', 'PSA'],
      ['Psa', 'PSA'],
      ['Song', 'SNG'],
      ['马可福音', 'MRK'],
      ['可', 'MRK'],
      ['約翰福音', 'JHN'],
      ['約', 'JHN'],
      ['约壹', '1JN'],
    ];
    for (const [name, book] of names) expect(BUILT_IN_NAMES.get(nameKey(name))).toBe(book);
  });
});

describe('references (P1.2)', () => {
  it('formats in English and Chinese', () => {
    const mark = verseReference('MRK', 15, 5, { verse: 6 });
    expect(formatReference(mark)).toBe('Mark 15:5–6');
    expect(formatReference(mark, 'zh-Hans')).toBe('马可福音 15:5-6');
    expect(formatReference(mark, 'zh-Hant')).toBe('馬可福音 15:5-6');
  });

  it('formats one verse, a whole chapter and a range across chapters', () => {
    expect(formatReference(verseReference('JHN', 3, 16))).toBe('John 3:16');
    expect(formatReference(chapterReference('PSA', 23))).toBe('Psalm 23');
    expect(formatReference(chapterReference('PSA', 23), 'zh-Hans')).toBe('诗篇 23');
    expect(formatReference(verseReference('GEN', 1, 31, { chapter: 2, verse: 3 }))).toBe(
      'Genesis 1:31–2:3',
    );
  });

  it('converts to and from USFM', () => {
    expect(toUsfm(verseReference('MRK', 15, 5, { verse: 6 }))).toBe('MRK.15.5-MRK.15.6');
    expect(toUsfm(verseReference('MRK', 15, 5))).toBe('MRK.15.5');
    expect(toUsfm(chapterReference('PSA', 23))).toBe('PSA.23');
    for (const usfm of ['MRK.15.5-MRK.15.6', 'MRK.15.5', 'PSA.23', 'GEN.1.31-GEN.2.3']) {
      expect(toUsfm(fromUsfm(usfm)!)).toBe(usfm);
    }
    expect(toUsfm(fromUsfm('JHN.3.16-18')!)).toBe('JHN.3.16-JHN.3.18');
    expect(toUsfm(fromUsfm('GEN.1.31-2.3')!)).toBe('GEN.1.31-GEN.2.3');
  });

  it('refuses USFM that is not a reference', () => {
    for (const bad of ['XYZ.1', 'MRK', 'MRK.15.6-5', 'MRK.15.5-JHN.15.6', 'MRK.0', 'mrk.15']) {
      expect(fromUsfm(bad)).toBeNull();
    }
  });
});

describe('parsing references (§3.1)', () => {
  it('reads every English form of Mark 15:5–6 alike', () => {
    for (const input of [
      'Mark 15:5-6',
      'Mar 15:5-6',
      'Mk 15:5-6',
      'mark 15 5-6',
      'Mark 15.5-6',
      'mk15.5-6',
      'Mark 15:5–6',
      'Mark 15:5 - 6',
      'MARK 15:5—6',
      'Mark 15:5~6',
    ]) {
      expect(ref(input), input).toBe('MRK.15.5-MRK.15.6');
    }
  });

  it('reads chapters, numbered books and ranges across chapters', () => {
    expect(ref('Mark 15')).toBe('MRK.15');
    expect(ref('Ps 23')).toBe('PSA.23');
    expect(ref('Psalm 23:1-6')).toBe('PSA.23.1-PSA.23.6');
    expect(ref('1 Cor 13:4-7')).toBe('1CO.13.4-1CO.13.7');
    expect(ref('1Co 13:4-7')).toBe('1CO.13.4-1CO.13.7');
    expect(ref('I Corinthians 13')).toBe('1CO.13');
    expect(ref('Song of Songs 2:4')).toBe('SNG.2.4');
    expect(ref('Gen 1:31-2:3')).toBe('GEN.1.31-GEN.2.3');
  });

  it('reads Chinese forms', () => {
    for (const input of [
      '马可福音15:5-6',
      '可15:5-6',
      '马可福音 15 章 5-6 节',
      '馬可福音15章5至6節',
      '马可福音15章5-6节',
      '可１５：５-６',
    ]) {
      expect(ref(input), input).toBe('MRK.15.5-MRK.15.6');
    }
    expect(ref('約3:16')).toBe('JHN.3.16');
    expect(ref('可１５：５')).toBe('MRK.15.5');
    expect(ref('诗篇23篇')).toBe('PSA.23');
  });

  it('gives a book alone, or the books a prefix shares', () => {
    expect(parseReference('Mark')).toEqual({ kind: 'book', book: 'MRK' });
    expect(parseReference('Psalm')).toEqual({ kind: 'book', book: 'PSA' });
    expect(parseReference('Jo')).toEqual({
      kind: 'books',
      books: ['JOS', 'JOB', 'JOL', 'JON', 'JHN'],
    });
    expect(parseReference('1 Jo')).toEqual({ kind: 'book', book: '1JN' });
    expect(ref('John 3')).toBe('JHN.3');
    expect(ref('1 John 3')).toBe('1JN.3');
    expect(ref('Phil 4:13')).toBe('PHP.4.13');
    expect(ref('Phm 1:6')).toBe('PHM.1.6');
    expect(parseReference('马可')).toEqual({ kind: 'book', book: 'MRK' });
  });

  it('finds nothing in song titles or a number alone', () => {
    expect(parseReference('Amazing grace')).toEqual({ kind: 'none' });
    expect(parseReference('10000 reasons')).toEqual({ kind: 'none' });
    expect(parseReference('3')).toEqual({ kind: 'none' });
    expect(parseReference('3:16')).toEqual({ kind: 'none' });
    expect(parseReference('')).toEqual({ kind: 'none' });
  });

  it('refuses a range written backwards rather than turning it round', () => {
    expect(parseReference('Mark 15:6-5')).toEqual({ kind: 'none' });
    expect(parseReference('Gen 2:3-1:31')).toEqual({ kind: 'none' });
    expect(parseReference('Mark 0')).toEqual({ kind: 'none' });
  });

  it('reads a reference half typed', () => {
    expect(ref('Mark 15:')).toBe('MRK.15');
    expect(ref('Mark 15:5-')).toBe('MRK.15.5');
  });

  it('takes extra names from a table of contents', () => {
    const names = [
      { book: 'MRK', name: '马可' },
      { book: 'JHN', name: 'Yohanes' },
    ];
    const result = parseReference('Yohanes 3:16', names);
    expect(result.kind === 'reference' && toUsfm(result.reference)).toBe('JHN.3.16');
    // A built-in name is never taken over.
    expect(parseReference('Mark', [{ book: 'JHN', name: 'Mark' }])).toEqual({
      kind: 'book',
      book: 'MRK',
    });
  });

  it('offers references to the song search only for named books (B9, P4.6)', () => {
    expect(toUsfm(songSearchReference('Mark 15:5')!)).toBe('MRK.15.5');
    expect(toUsfm(songSearchReference('可15:5')!)).toBe('MRK.15.5');
    expect(songSearchReference('Amazing grace')).toBeNull();
    expect(songSearchReference('Psalm')).toBeNull();
    expect(songSearchReference('10000 reasons')).toBeNull();
    // A prefix that happens to fit one book is a guess, not a reference.
    expect(songSearchReference('Hab 3')).not.toBeNull();
    expect(songSearchReference('Habak 3')).toBeNull();
  });

  it('reads the P1 milestone forms as one reference', () => {
    expect(ref('马可福音15章5-6节')).toBe(ref('Mar 15:5-6'));
    expect(ref('mk15.5-6')).toBe(ref('Mar 15:5-6'));
  });
});

const toc = (books: Toc['books']): Toc => ({ version: 'T', books });
const NIV = toc([
  { book: 'PSA', name: 'Psalms', chapters: Array.from({ length: 150 }, () => 10) },
  { book: '3JN', name: '3 John', chapters: [15] },
  {
    book: 'MAT',
    name: 'Matthew',
    chapters: [25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27],
    missing: [[17, 21]],
  },
  { book: 'MRK', name: 'Mark', abbreviation: 'Mk', chapters: [45, null] },
]);
const KJV = toc([{ book: '3JN', name: '3 John', chapters: [14] }]);
const CCB = toc([
  {
    book: '1CH',
    name: '历代志上',
    abbreviation: '代上',
    chapters: Array.from({ length: 29 }, (_, i) => (i === 15 ? 43 : 30)),
    joined: [[16, 12, 13]],
  },
]);

describe('tables of contents (P1.4)', () => {
  it('refuses Psalm 151 rather than clamping it', () => {
    expect(validate(chapterReference('PSA', 151), NIV)).toEqual({
      ok: false,
      missing: 'chapter',
      chapter: 151,
      chapters: 150,
    });
    expect(validate(chapterReference('PSA', 150), NIV)).toEqual({ ok: true });
  });

  it('knows 3 John 15 is in the NIV and not in the KJV', () => {
    expect(validate(verseReference('3JN', 1, 15), NIV)).toEqual({ ok: true });
    expect(validate(verseReference('3JN', 1, 15), KJV)).toMatchObject({
      ok: false,
      missing: 'verse',
    });
  });

  it('refuses a range ending past the chapter, and a book the version lacks', () => {
    expect(validate(verseReference('3JN', 1, 10, { verse: 16 }), NIV)).toMatchObject({
      ok: false,
      missing: 'verse',
      verse: 16,
      verses: 15,
    });
    expect(validate(verseReference('JHN', 3, 16), NIV)).toEqual({ ok: false, missing: 'book' });
  });

  it('says when a chapter’s verses are not known yet', () => {
    expect(validate(verseReference('MRK', 2, 1), NIV)).toEqual({ ok: 'unknown', chapter: 2 });
    expect(chapterVerses(NIV, 'MRK', 2)).toEqual([]);
    expect(chapterVerses(NIV, 'MRK', 3)).toBeNull();
  });

  it('lists a chapter’s verses with joined ones as one and missing ones left out', () => {
    const ch16 = chapterVerses(CCB, '1CH', 16)!;
    expect(ch16.map((cell) => cell.label).slice(10, 13)).toEqual(['11', '12-13', '14']);
    expect(ch16).toHaveLength(42);
    const mat17 = chapterVerses(NIV, 'MAT', 17)!;
    expect(mat17.map((cell) => cell.verse)).not.toContain(21);
    expect(mat17).toHaveLength(26);
  });

  it('gives the next chapter within the book', () => {
    expect(nextChapter(NIV, 'MRK', 1)).toBe(2);
    expect(nextChapter(NIV, 'MRK', 2)).toBeNull();
    expect(nextChapter(NIV, 'GEN', 1)).toBeNull();
  });

  it('gives the version’s names to the parser', () => {
    expect(tocNames(CCB)).toEqual([
      { book: '1CH', name: '历代志上' },
      { book: '1CH', name: '代上' },
    ]);
  });
});

const line = (text: string, indent = 0) => ({ text, indent });
const unit = (chapter: number, verses: number[], text: string): PassageUnit => ({
  chapter,
  verses,
  label: verses.length > 1 ? `${verses[0]}-${verses[verses.length - 1]}` : String(verses[0]),
  lines: [line(text)],
});
const text = (version: string, units: PassageUnit[], credit = version): PassageText => ({
  version,
  credit,
  provider: 'youversion',
  copyright: '©',
  units,
  fumsToken: null,
});

describe('the passage shape (P1.5)', () => {
  const passage: Passage = {
    reference: 'MRK.15.5-MRK.15.6',
    texts: [text('NIVUK', [unit(15, [5], 'But Jesus'), unit(15, [6], 'Now it was')])],
  };

  it('round-trips through its schema', () => {
    expect(PassageSchema.parse(JSON.parse(JSON.stringify(passage)))).toEqual(passage);
  });

  it('reads a text without a usage token as having none', () => {
    const { fumsToken, ...older } = passage.texts[0]!;
    void fumsToken;
    expect(PassageSchema.parse({ ...passage, texts: [older] }).texts[0]!.fumsToken).toBeNull();
  });

  it('refuses more than two versions, none, and a reference that is not USFM', () => {
    const t = passage.texts[0]!;
    expect(PassageSchema.safeParse({ ...passage, texts: [t, t, t] }).success).toBe(false);
    expect(PassageSchema.safeParse({ ...passage, texts: [] }).success).toBe(false);
    expect(PassageSchema.safeParse({ ...passage, reference: 'Mark 15:5' }).success).toBe(false);
  });

  it('gives plain text for older devices', () => {
    expect(passagePlainText(passage)).toBe('5 But Jesus\n\n6 Now it was');
  });
});

describe('aligning versions (§3.2)', () => {
  it('lines up the same numbering one to one, with no warnings', () => {
    const aligned = align({
      reference: 'JHN.3.16-JHN.3.17',
      texts: [
        text('NIVUK', [unit(3, [16], 'For God'), unit(3, [17], 'For God did not')]),
        text('CCB', [unit(3, [16], '神爱世人'), unit(3, [17], '因为神')]),
      ],
    });
    expect(aligned.rows.map((row) => row.key)).toEqual(['3:16', '3:17']);
    expect(aligned.rows.every((row) => row.cells.every((cell) => cell.length === 1))).toBe(true);
    expect(aligned.warnings).toEqual([]);
  });

  it('widens a joined verse cut by the range in that version only, and warns (P1 milestone)', () => {
    // 1 Chronicles 16:13–14: CCB sends its whole 12–13.
    const aligned = align({
      reference: '1CH.16.13-1CH.16.14',
      texts: [
        text('NIVUK', [unit(16, [13], 'you his servants'), unit(16, [14], 'He is the LORD')]),
        text('CCB', [unit(16, [12, 13], '祂仆人'), unit(16, [14], '祂是')], '当代译本'),
      ],
    });
    expect(aligned.rows.map((row) => row.key)).toEqual(['16:12', '16:14']);
    expect(aligned.rows[0]!.cells[0]!.map((u) => u.label)).toEqual(['13']);
    expect(aligned.rows[0]!.cells[1]!.map((u) => u.label)).toEqual(['12-13']);
    expect(aligned.warnings).toEqual([
      {
        kind: 'joined',
        version: 'CCB',
        credit: '当代译本',
        chapter: 16,
        verses: [12, 13],
        label: '12-13',
      },
    ]);
    expect(describeWarning(aligned.warnings[0]!, '1CH')).toBe('当代译本 joins verses 16:12–13');
  });

  it('keeps both of the other version’s verses in the joined row, and still warns', () => {
    const aligned = align({
      reference: '1CH.16.12-1CH.16.13',
      texts: [
        text('NIVUK', [unit(16, [12], 'Remember'), unit(16, [13], 'you his servants')]),
        text('CCB', [unit(16, [12, 13], '祂仆人')]),
      ],
    });
    expect(aligned.rows).toHaveLength(1);
    expect(aligned.rows[0]!.cells[0]).toHaveLength(2);
    expect(aligned.warnings.map((w) => w.kind)).toEqual(['joined']);
  });

  it('leaves a verse missing in one version empty, and warns naming that version', () => {
    const aligned = align({
      reference: 'REV.12.17-REV.12.18',
      texts: [
        text('NIVUK', [unit(12, [17], 'Then the dragon')]),
        text('CCB', [unit(12, [17], '龙'), unit(12, [18], '那时龙站在海边')]),
      ],
    });
    expect(aligned.rows[1]!.cells[0]).toEqual([]);
    expect(aligned.warnings).toEqual([
      { kind: 'missing', version: 'NIVUK', credit: 'NIVUK', chapter: 12, verses: [18] },
    ]);
    expect(describeWarning(aligned.warnings[0]!, 'REV')).toBe('NIVUK has no Revelation 12:18');
  });

  it('leaves a verse a version omits empty, never saying "not found"', () => {
    const aligned = align({
      reference: 'MAT.17.20-MAT.17.22',
      texts: [
        text('NIVUK', [unit(17, [20], 'He replied'), unit(17, [22], 'When they came')]),
        text('CCB', [unit(17, [20], '耶稣说'), unit(17, [21], '这一类'), unit(17, [22], '他们')]),
      ],
    });
    const row21 = aligned.rows.find((row) => row.key === '17:21')!;
    expect(row21.cells[0]).toEqual([]);
    expect(aligned.warnings).toMatchObject([{ kind: 'missing', version: 'NIVUK', verses: [21] }]);
  });

  it('with one version, warns only of its joined verses', () => {
    const aligned = align({
      reference: '1CH.16.11-1CH.16.15',
      texts: [text('CCB', [unit(16, [11], 'a'), unit(16, [12, 13], 'b'), unit(16, [15], 'd')])],
    });
    expect(aligned.rows).toHaveLength(3);
    expect(aligned.warnings.map((w) => w.kind)).toEqual(['joined']);
  });

  it('keeps a psalm’s title before verse 1, only when the range starts there', () => {
    const title: PassageUnit = {
      chapter: 23,
      verses: [],
      label: '',
      title: true,
      lines: [line('A psalm of David.')],
    };
    const units = [title, unit(23, [1], 'The LORD'), unit(23, [2], 'He makes me')];
    expect(align({ reference: 'PSA.23', texts: [text('NIVUK', units)] }).rows[0]!.key).toBe(
      'title',
    );
    expect(
      align({ reference: 'PSA.23.2', texts: [text('NIVUK', units)] }).rows.map((r) => r.key),
    ).toEqual(['23:2']);
  });

  it('drops units outside the range a provider sent', () => {
    const aligned = align({
      reference: 'JHN.3.16',
      texts: [text('NIVUK', [unit(3, [15], 'x'), unit(3, [16], 'y'), unit(3, [17], 'z')])],
    });
    expect(aligned.rows.map((r) => r.key)).toEqual(['3:16']);
  });

  it('lines up a range across chapters in order', () => {
    const aligned = align({
      reference: 'GEN.1.31-GEN.2.2',
      texts: [text('ESV', [unit(1, [31], 'a'), unit(2, [1], 'b'), unit(2, [2], 'c')])],
    });
    expect(aligned.rows.map((r) => r.key)).toEqual(['1:31', '2:1', '2:2']);
  });
});

describe('slides (§3.3)', () => {
  const verses = (n: number, words: string, chinese = false) =>
    Array.from({ length: n }, (_, i) => unit(1, [i + 1], chinese ? words.repeat(1) : words));
  const passage = (en: PassageUnit[], zh?: PassageUnit[]): Passage => ({
    reference: `PSA.1.1-PSA.1.${Math.max(en.length, zh?.length ?? 0)}`,
    texts: zh ? [text('NIVUK', en), text('CCB', zh)] : [text('NIVUK', en)],
  });

  it('makes one slide of a short passage', () => {
    const pieces = passagePieces(align(passage(verses(2, 'Short verse.'))));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.id).toBe('v1:1');
  });

  it('splits a long passage into whole rows, never splitting a joined unit', () => {
    // With its label, each verse is two lines side by side; five fit in ten lines.
    const en = verses(12, 'x'.repeat(50));
    const zh = verses(12, '字'.repeat(10), true);
    zh.splice(4, 2, unit(1, [5, 6], '字'.repeat(10)));
    const pieces = passagePieces(align(passage(en, zh)));
    for (const piece of pieces) {
      expect(piece.rows.length).toBeGreaterThan(0);
      for (const row of piece.rows) {
        // Every unit of a row is on the slide holding the row.
        const labels = piece.columns[1]!.units.map((u) => u.label);
        if (row.verses.some(([, v]) => v === 5)) expect(labels).toContain('5-6');
      }
    }
    const rowsSeen = pieces.flatMap((piece) => piece.rows.map((row) => row.key));
    expect(rowsSeen).toEqual(align(passage(en, zh)).rows.map((row) => row.key));
    expect(pieces[0]!.rows.map((r) => r.key)).toEqual(['1:1', '1:2', '1:3', '1:4']);
    // Rows 5 and 6 are one row, as CCB joins them, and start the next slide.
    expect(pieces[1]!.rows[0]!.verses).toEqual([
      [1, 5],
      [1, 6],
    ]);
  });

  it('gives a row over the budget a slide of its own', () => {
    const long = unit(1, [2], '字'.repeat(200));
    const pieces = passagePieces(
      align(
        passage(
          [unit(1, [1], 'a'), unit(1, [2], 'b'), unit(1, [3], 'c')],
          [unit(1, [1], '一'), long, unit(1, [3], '三')],
        ),
      ),
    );
    expect(pieces.map((p) => p.rows.map((r) => r.key))).toEqual([['1:1'], ['1:2'], ['1:3']]);
  });

  it('lets the longer column decide where a slide ends', () => {
    const en = verses(6, 'Short.');
    const zh = verses(6, '字'.repeat(34), true); // three lines each side by side
    const pieces = passagePieces(align(passage(en, zh)));
    expect(pieces.map((p) => p.rows.length)).toEqual([3, 3]);
  });

  it('counts wide characters by their width, mixed text character by character', () => {
    const budget = SIDE_BY_SIDE_BUDGET;
    expect(estimateLines('x'.repeat(30), budget)).toBe(1);
    expect(estimateLines('x'.repeat(31), budget)).toBe(2);
    expect(estimateLines('字'.repeat(12), budget)).toBe(1);
    expect(estimateLines('字'.repeat(13), budget)).toBe(2);
    // Six wide characters take half a line, as fifteen Latin ones do.
    expect(estimateLines('字'.repeat(6) + 'x'.repeat(15), budget)).toBe(1);
    expect(estimateLines('字'.repeat(6) + 'x'.repeat(16), budget)).toBe(2);
    expect(estimateLines('', budget)).toBe(1);
  });

  it('holds more on a single-version slide', () => {
    expect(budgetFor(1).latin).toBeGreaterThan(budgetFor(2).latin);
    const en = verses(6, 'x'.repeat(50));
    expect(passagePieces(align(passage(en)))).toHaveLength(1);
    expect(
      passagePieces(
        align(
          passage(
            en,
            en.map((u) => ({ ...u, lines: [line('x'.repeat(50))] })),
          ),
        ),
      ),
    ).toHaveLength(2);
  });

  it('keeps slide ids when the same passage is saved again', () => {
    const p = passage(verses(12, 'x'.repeat(59)));
    const first = passagePieces(align(p)).map((piece) => piece.id);
    const again = passagePieces(align(JSON.parse(JSON.stringify(p)) as Passage)).map(
      (piece) => piece.id,
    );
    expect(again).toEqual(first);
  });

  it('carries each column’s credit and labels', () => {
    const pieces = passagePieces(
      align({
        reference: 'JHN.3.16',
        texts: [
          text('NIVUK', [unit(3, [16], 'For God')]),
          text('CCB', [unit(3, [16], '神爱世人')], '当代译本'),
        ],
      }),
    );
    expect(pieces[0]!.columns).toEqual([
      { version: 'NIVUK', credit: 'NIVUK', units: [{ label: '16', lines: [line('For God')] }] },
      { version: 'CCB', credit: '当代译本', units: [{ label: '16', lines: [line('神爱世人')] }] },
    ]);
  });
});

describe('the catalogue (P1.8)', () => {
  it('has unique ids, known providers, and no provider twice in a version', () => {
    const ids = CATALOGUE.map((version) => version.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const version of CATALOGUE) {
      expect(version.providers.length).toBeGreaterThan(0);
      for (const entry of version.providers) expect(PROVIDERS).toContain(entry.provider);
      const providers = version.providers.map((entry) => entry.provider);
      expect(new Set(providers).size, version.id).toBe(providers.length);
    }
  });

  it('starts with the first church’s versions', () => {
    for (const id of [
      'NIVUK',
      'NKJV',
      'NLT',
      'ESV',
      'KJV',
      'BSB',
      'CUNP-S',
      'CUNP-T',
      'CCB',
      'CSBS',
    ]) {
      expect(
        CATALOGUE.some((version) => version.id === id),
        id,
      ).toBe(true);
    }
  });
});
