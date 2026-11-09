/**
 * The slide budget (B24) and the drawing agree: every slide `passagePieces` makes from
 * ordinary verses is drawn at the full target size, never shrunk to fit. Widths follow spike
 * P0.3's measurements at 1920 × 1080: a Latin character about half an em on average, a
 * Chinese one about a full em.
 */
import { align, passagePieces, type Passage, type PassageUnit } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { fitPassage, PASSAGE_TARGET_RATIO, type Measure } from './layout';

const measure: Measure = (text) =>
  Array.from(text).reduce(
    (sum, char) => sum + (char.codePointAt(0)! > 0x2e7f ? 1 : /[mwMW]/.test(char) ? 0.8 : 0.48),
    0,
  );

const ENGLISH =
  'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.';
const CHINESE = '神爱世人，甚至将祂独一的儿子赐给他们，叫一切信祂的人不致灭亡，反得永生。';

const verses = (count: number, text: (n: number) => string[], indent = false): PassageUnit[] =>
  Array.from({ length: count }, (_, i) => ({
    chapter: 3,
    verses: [i + 1],
    label: String(i + 1),
    lines: text(i).map((line, j) => ({ text: line, indent: indent && j % 2 === 1 ? 1 : 0 })),
  }));

const text = (version: string, units: PassageUnit[]) => ({
  version,
  credit: version,
  provider: 'youversion' as const,
  copyright: '',
  units,
  fumsToken: null,
});

/** English prose verses of varied length, as in John 3. */
const prose = (n: number) => [ENGLISH.slice(0, 60 + ((n * 37) % 70))];
const chinese = (n: number) => [CHINESE.slice(0, 18 + ((n * 7) % 18))];
/** Poetry: short lines, two or three to a verse, as in the Psalms. */
const poem = (n: number) =>
  [
    'The Lord is my shepherd, I lack nothing.',
    'He makes me lie down in green pastures,',
    'he leads me beside quiet waters,',
  ].slice(0, 2 + (n % 2));
const poemZh = (n: number) =>
  ['耶和华是我的牧者，', '我必不至缺乏。', '祂使我躺卧在青草地上，'].slice(0, 2 + (n % 2));

function sizes(passage: Passage): number[] {
  return passagePieces(align(passage)).map(
    (piece) => fitPassage(piece.columns, 1920, 1080, measure).fontSize,
  );
}

describe('the slide budget fits the slide at 6 %', () => {
  const target = 1080 * PASSAGE_TARGET_RATIO;
  const cases: [string, Passage][] = [
    [
      'English and Chinese prose',
      {
        reference: 'JHN.3.1-JHN.3.36',
        texts: [text('NIVUK', verses(36, prose)), text('CCB', verses(36, chinese))],
      },
    ],
    [
      'English prose alone',
      { reference: 'JHN.3.1-JHN.3.36', texts: [text('NIVUK', verses(36, prose))] },
    ],
    [
      'Chinese prose alone',
      { reference: 'JHN.3.1-JHN.3.36', texts: [text('CCB', verses(36, chinese))] },
    ],
    [
      'English and Chinese poetry',
      {
        reference: 'PSA.3.1-PSA.3.30',
        texts: [text('NIVUK', verses(30, poem, true)), text('CCB', verses(30, poemZh, true))],
      },
    ],
  ];

  for (const [name, passage] of cases) {
    it(`draws every slide of ${name} at the target size`, () => {
      const all = sizes(passage);
      expect(all.length).toBeGreaterThan(1);
      for (const size of all) expect(size).toBeCloseTo(target);
    });
  }

  it('packs whole verses, one version holding more than two side by side', () => {
    const sideBySide = passagePieces(align(cases[0]![1]));
    const single = passagePieces(align(cases[1]![1]));
    // Every verse on exactly one slide, and several on some.
    expect(sideBySide.flatMap((s) => s.rows.map((r) => r.key))).toHaveLength(36);
    expect(sideBySide.length).toBeLessThan(36);
    expect(single.length).toBeLessThan(sideBySide.length);
    expect(single.some((slide) => slide.rows.length >= 3)).toBe(true);
  });
});
