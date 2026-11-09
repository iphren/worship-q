/**
 * The 66 books of the Protestant canon, by USFM code, in Bible order, with the names and
 * abbreviations volunteers type in English and Chinese (P1.1, B21).
 */

export type Testament = 'old' | 'new';
export type BookGroup =
  'law' | 'history' | 'poetry' | 'prophets' | 'gospels' | 'acts' | 'letters' | 'revelation';

export interface Book {
  /** USFM code, such as `MRK` or `1CO`. */
  id: string;
  testament: Testament;
  group: BookGroup;
  /** English name, as on a slide: `Mark`, `1 Corinthians`. */
  en: string;
  /** Chinese name, simplified script. */
  zhHans: string;
  /** Chinese name, traditional script. */
  zhHant: string;
  /** Short English form for grids: `Mark`, `1 Cor`. */
  enShort: string;
  /** One- or two-character Chinese abbreviation, simplified: `可`, `林前`. */
  zhHansShort: string;
  zhHantShort: string;
  /** Further forms that name this book: abbreviations and other spellings. */
  aliases: string[];
}

type Row = [
  id: string,
  en: string,
  enShort: string,
  zhHans: string,
  zhHansShort: string,
  zhHant: string,
  zhHantShort: string,
  aliases: string,
];

// Aliases are separated by `|`. Numbered books get `I`/`II`/`III` and `First` forms below.
const OLD: [BookGroup, Row[]][] = [
  [
    'law',
    [
      ['GEN', 'Genesis', 'Gen', '创世记', '创', '創世記', '創', 'Ge|Gn'],
      ['EXO', 'Exodus', 'Exod', '出埃及记', '出', '出埃及記', '出', 'Ex|Exo'],
      ['LEV', 'Leviticus', 'Lev', '利未记', '利', '利未記', '利', 'Le|Lv'],
      ['NUM', 'Numbers', 'Num', '民数记', '民', '民數記', '民', 'Nu|Nm|Nb'],
      ['DEU', 'Deuteronomy', 'Deut', '申命记', '申', '申命記', '申', 'Dt|De|Deu'],
    ],
  ],
  [
    'history',
    [
      ['JOS', 'Joshua', 'Josh', '约书亚记', '书', '約書亞記', '書', 'Jos|Jsh'],
      ['JDG', 'Judges', 'Judg', '士师记', '士', '士師記', '士', 'Jdg|Jg|Jdgs'],
      ['RUT', 'Ruth', 'Ruth', '路得记', '得', '路得記', '得', 'Ru|Rth|Rut'],
      ['1SA', '1 Samuel', '1 Sam', '撒母耳记上', '撒上', '撒母耳記上', '撒上', '1 Sa|1Sm'],
      ['2SA', '2 Samuel', '2 Sam', '撒母耳记下', '撒下', '撒母耳記下', '撒下', '2 Sa|2Sm'],
      ['1KI', '1 Kings', '1 Kgs', '列王纪上', '王上', '列王紀上', '王上', '1 Ki|1 Kin|1Kg'],
      ['2KI', '2 Kings', '2 Kgs', '列王纪下', '王下', '列王紀下', '王下', '2 Ki|2 Kin|2Kg'],
      ['1CH', '1 Chronicles', '1 Chr', '历代志上', '代上', '歷代志上', '代上', '1 Ch|1 Chron'],
      ['2CH', '2 Chronicles', '2 Chr', '历代志下', '代下', '歷代志下', '代下', '2 Ch|2 Chron'],
      ['EZR', 'Ezra', 'Ezra', '以斯拉记', '拉', '以斯拉記', '拉', 'Ezr'],
      ['NEH', 'Nehemiah', 'Neh', '尼希米记', '尼', '尼希米記', '尼', 'Ne'],
      ['EST', 'Esther', 'Esth', '以斯帖记', '斯', '以斯帖記', '斯', 'Est|Es'],
    ],
  ],
  [
    'poetry',
    [
      ['JOB', 'Job', 'Job', '约伯记', '伯', '約伯記', '伯', 'Jb'],
      ['PSA', 'Psalms', 'Ps', '诗篇', '诗', '詩篇', '詩', 'Psalm|Psa|Pss|Psm|Pslm'],
      ['PRO', 'Proverbs', 'Prov', '箴言', '箴', '箴言', '箴', 'Pr|Pro|Prv'],
      ['ECC', 'Ecclesiastes', 'Eccl', '传道书', '传', '傳道書', '傳', 'Ecc|Ec|Qoh'],
      [
        'SNG',
        'Song of Songs',
        'Song',
        '雅歌',
        '歌',
        '雅歌',
        '歌',
        'Song of Solomon|Songs|SoS|Sng|Canticles|Cant',
      ],
    ],
  ],
  [
    'prophets',
    [
      ['ISA', 'Isaiah', 'Isa', '以赛亚书', '赛', '以賽亞書', '賽', 'Is'],
      ['JER', 'Jeremiah', 'Jer', '耶利米书', '耶', '耶利米書', '耶', 'Je|Jr'],
      ['LAM', 'Lamentations', 'Lam', '耶利米哀歌', '哀', '耶利米哀歌', '哀', 'La'],
      ['EZK', 'Ezekiel', 'Ezek', '以西结书', '结', '以西結書', '結', 'Eze|Ezk'],
      ['DAN', 'Daniel', 'Dan', '但以理书', '但', '但以理書', '但', 'Da|Dn'],
      ['HOS', 'Hosea', 'Hos', '何西阿书', '何', '何西阿書', '何', 'Ho'],
      ['JOL', 'Joel', 'Joel', '约珥书', '珥', '約珥書', '珥', 'Jl|Jol'],
      ['AMO', 'Amos', 'Amos', '阿摩司书', '摩', '阿摩司書', '摩', 'Am|Amo'],
      ['OBA', 'Obadiah', 'Obad', '俄巴底亚书', '俄', '俄巴底亞書', '俄', 'Ob|Oba'],
      ['JON', 'Jonah', 'Jonah', '约拿书', '拿', '約拿書', '拿', 'Jon|Jnh'],
      ['MIC', 'Micah', 'Mic', '弥迦书', '弥', '彌迦書', '彌', 'Mc'],
      ['NAM', 'Nahum', 'Nah', '那鸿书', '鸿', '那鴻書', '鴻', 'Na|Nam'],
      ['HAB', 'Habakkuk', 'Hab', '哈巴谷书', '哈', '哈巴谷書', '哈', 'Hb'],
      ['ZEP', 'Zephaniah', 'Zeph', '西番雅书', '番', '西番雅書', '番', 'Zep|Zp'],
      ['HAG', 'Haggai', 'Hag', '哈该书', '该', '哈該書', '該', 'Hg'],
      ['ZEC', 'Zechariah', 'Zech', '撒迦利亚书', '亚', '撒迦利亞書', '亞', 'Zec|Zc'],
      ['MAL', 'Malachi', 'Mal', '玛拉基书', '玛', '瑪拉基書', '瑪', 'Ml'],
    ],
  ],
];

const NEW: [BookGroup, Row[]][] = [
  [
    'gospels',
    [
      ['MAT', 'Matthew', 'Matt', '马太福音', '太', '馬太福音', '太', 'Mt|Mat'],
      ['MRK', 'Mark', 'Mark', '马可福音', '可', '馬可福音', '可', 'Mk|Mar|Mrk|Mr'],
      ['LUK', 'Luke', 'Luke', '路加福音', '路', '路加福音', '路', 'Lk|Luk|Lu'],
      ['JHN', 'John', 'John', '约翰福音', '约', '約翰福音', '約', 'Jn|Jhn|Joh'],
    ],
  ],
  ['acts', [['ACT', 'Acts', 'Acts', '使徒行传', '徒', '使徒行傳', '徒', 'Ac|Act']]],
  [
    'letters',
    [
      ['ROM', 'Romans', 'Rom', '罗马书', '罗', '羅馬書', '羅', 'Ro|Rm'],
      ['1CO', '1 Corinthians', '1 Cor', '哥林多前书', '林前', '哥林多前書', '林前', '1 Co'],
      ['2CO', '2 Corinthians', '2 Cor', '哥林多后书', '林后', '哥林多後書', '林後', '2 Co'],
      ['GAL', 'Galatians', 'Gal', '加拉太书', '加', '加拉太書', '加', 'Ga'],
      ['EPH', 'Ephesians', 'Eph', '以弗所书', '弗', '以弗所書', '弗', 'Ephes'],
      ['PHP', 'Philippians', 'Phil', '腓立比书', '腓', '腓立比書', '腓', 'Php|Pp'],
      ['COL', 'Colossians', 'Col', '歌罗西书', '西', '歌羅西書', '西', 'Coll'],
      [
        '1TH',
        '1 Thessalonians',
        '1 Thess',
        '帖撒罗尼迦前书',
        '帖前',
        '帖撒羅尼迦前書',
        '帖前',
        '1 Th|1 Thes',
      ],
      [
        '2TH',
        '2 Thessalonians',
        '2 Thess',
        '帖撒罗尼迦后书',
        '帖后',
        '帖撒羅尼迦後書',
        '帖後',
        '2 Th|2 Thes',
      ],
      ['1TI', '1 Timothy', '1 Tim', '提摩太前书', '提前', '提摩太前書', '提前', '1 Ti'],
      ['2TI', '2 Timothy', '2 Tim', '提摩太后书', '提后', '提摩太後書', '提後', '2 Ti'],
      ['TIT', 'Titus', 'Titus', '提多书', '多', '提多書', '多', 'Tit|Ti'],
      ['PHM', 'Philemon', 'Phlm', '腓利门书', '门', '腓利門書', '門', 'Phm|Philem'],
      ['HEB', 'Hebrews', 'Heb', '希伯来书', '来', '希伯來書', '來', 'He'],
      ['JAS', 'James', 'Jas', '雅各书', '雅', '雅各書', '雅', 'Jm|Jam'],
      ['1PE', '1 Peter', '1 Pet', '彼得前书', '彼前', '彼得前書', '彼前', '1 Pe|1 Pt'],
      ['2PE', '2 Peter', '2 Pet', '彼得后书', '彼后', '彼得後書', '彼後', '2 Pe|2 Pt'],
      [
        '1JN',
        '1 John',
        '1 John',
        '约翰一书',
        '约一',
        '約翰一書',
        '約壹',
        '1 Jn|1 Jhn|1 Joh|约壹|約一',
      ],
      [
        '2JN',
        '2 John',
        '2 John',
        '约翰二书',
        '约二',
        '約翰二書',
        '約貳',
        '2 Jn|2 Jhn|2 Joh|约贰|約二',
      ],
      [
        '3JN',
        '3 John',
        '3 John',
        '约翰三书',
        '约三',
        '約翰三書',
        '約參',
        '3 Jn|3 Jhn|3 Joh|约叁|約三',
      ],
      ['JUD', 'Jude', 'Jude', '犹大书', '犹', '猶大書', '猶', 'Jud|Jd'],
    ],
  ],
  [
    'revelation',
    [['REV', 'Revelation', 'Rev', '启示录', '启', '啟示錄', '啟', 'Re|Rv|Apocalypse|Revelations']],
  ],
];

const ROMAN = ['I', 'II', 'III'];
const ORDINAL = ['First', 'Second', 'Third'];

/** Extra forms for a numbered English name: `I Corinthians`, `First Corinthians`. */
function numbered(name: string, full: boolean): string[] {
  const m = /^([1-3]) (.+)$/.exec(name);
  if (!m) return [];
  const n = Number(m[1]) - 1;
  // Roman and spelled-out forms only for full names: `I Sa` would read as Isaiah.
  return full ? [`${ROMAN[n]} ${m[2]}`, `${ORDINAL[n]} ${m[2]}`] : [];
}

function build(testament: Testament, groups: [BookGroup, Row[]][]): Book[] {
  return groups.flatMap(([group, rows]) =>
    rows.map(([id, en, enShort, zhHans, zhHansShort, zhHant, zhHantShort, aliases]) => {
      const extra = aliases.split('|').filter(Boolean);
      return {
        id,
        testament,
        group,
        en,
        enShort,
        zhHans,
        zhHansShort,
        zhHant,
        zhHantShort,
        aliases: [...extra, ...numbered(en, true)],
      };
    }),
  );
}

/** Every book, in Bible order. */
export const BOOKS: readonly Book[] = [...build('old', OLD), ...build('new', NEW)];

const BY_ID = new Map(BOOKS.map((book) => [book.id, book]));

/**
 * Chapters per book in the usual English numbering. Versions differ in their verses, never
 * here in their chapters; used where a provider lists no contents (ESV).
 */
const CHAPTER_COUNTS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5,
  48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6,
  4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];

/** A book's number of chapters in the usual English numbering; 0 for an unknown code. */
export function chapterCount(id: string): number {
  return CHAPTER_COUNTS[BOOKS.findIndex((book) => book.id === id)] ?? 0;
}

export function bookById(id: string): Book | undefined {
  return BY_ID.get(id);
}

/** A book's position from 1 (Genesis) to 66 (Revelation); 0 for an unknown code. */
export function bookNumber(id: string): number {
  return BOOKS.findIndex((book) => book.id === id) + 1;
}

/** How names are compared: lower case, full-width forms folded, spaces and dots removed. */
export function nameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s.·]/g, '');
}

/** Every form a book is known by, the forms shown included. */
export function bookNames(book: Book): string[] {
  return [
    book.id,
    book.en,
    book.enShort,
    book.zhHans,
    book.zhHansShort,
    book.zhHant,
    book.zhHantShort,
    ...book.aliases,
  ];
}

/** Name key → book id for the built-in names. */
export const BUILT_IN_NAMES: ReadonlyMap<string, string> = (() => {
  const names = new Map<string, string>();
  for (const book of BOOKS) {
    for (const name of bookNames(book)) {
      const key = nameKey(name);
      const other = names.get(key);
      if (other && other !== book.id) {
        throw new Error(`Book name ${name} names both ${other} and ${book.id}`);
      }
      names.set(key, book.id);
    }
  }
  return names;
})();

export type BibleLanguage = 'en' | 'zh-Hans' | 'zh-Hant';

/** A book's name in a language. */
export function bookName(id: string, language: BibleLanguage, short = false): string {
  const book = BY_ID.get(id);
  if (!book) return id;
  switch (language) {
    case 'zh-Hans':
      return short ? book.zhHansShort : book.zhHans;
    case 'zh-Hant':
      return short ? book.zhHantShort : book.zhHant;
    default:
      return short ? book.enShort : book.en;
  }
}
