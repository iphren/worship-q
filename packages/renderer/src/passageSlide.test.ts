import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EMPTY_FRAME, type OutputFrame } from '@worship-q/protocol';
import { fitPassage, PASSAGE_EDGE_RATIO, PASSAGE_TEXT_TOP, type Measure } from './layout';
import { Slide } from './Slide';

const measure: Measure = (text) =>
  Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0)! > 0x2e7f ? 1 : 0.5), 0);
const column = (version: string, credit: string, verses: string[]) => ({
  version,
  credit,
  units: verses.map((text, i) => ({ label: String(i + 5), lines: [{ text, indent: 0 }] })),
});
const html = (columns: ReturnType<typeof column>[], headers = ['Mark 15:5–8']) => {
  const frame: OutputFrame = {
    ...EMPTY_FRAME,
    pieceId: 'v15:5',
    passage: { columns, headers },
  };
  return renderToStaticMarkup(createElement(Slide, { frame, width: 1920, height: 1080, measure }));
};

describe('a passage slide’s reference and credits (P6.3)', () => {
  it('shows the whole passage’s reference at the top left for one version', () => {
    expect(html([column('NIVUK', 'NIV (UK)', ['But Jesus'])])).toMatch(
      /justify-content:space-between[^>]*><span>Mark 15:5–8<\/span><\/div>/,
    );
  });

  it('shows it in each version’s language at the top left and right for two', () => {
    const two = html(
      [column('NIVUK', 'NIV (UK)', ['But Jesus']), column('CCB', '当代译本（简）', ['耶稣'])],
      ['Mark 15:5–8', '马可福音 15:5-8'],
    );
    expect(two).toMatch(
      /justify-content:space-between[^>]*><span>Mark 15:5–8<\/span><span>马可福音 15:5-8<\/span>/,
    );
  });

  it('puts one version’s credit at the lower right, and two at the lower left and right', () => {
    const one = html([column('NIVUK', 'NIV (UK)', ['But Jesus'])]);
    expect(one).toMatch(/justify-content:flex-end[^>]*><span>NIV \(UK\)<\/span>/);
    const two = html([
      column('NIVUK', 'NIV (UK)', ['But Jesus']),
      column('CCB', '当代译本（简）', ['耶稣']),
    ]);
    expect(two).toMatch(
      /justify-content:space-between[^>]*><span>NIV \(UK\)<\/span><span>当代译本（简）<\/span>/,
    );
  });

  it('keeps the reference and credits in the same places whatever the verses', () => {
    const short = fitPassage([column('A', 'A', ['Short.'])], 1920, 1080, measure);
    const long = fitPassage(
      [
        column(
          'A',
          'A',
          Array.from({ length: 14 }, () => 'x'.repeat(60)),
        ),
      ],
      1920,
      1080,
      measure,
    );
    expect(long.fontSize).toBeLessThan(short.fontSize);
    for (const fitted of [short, long]) {
      expect(fitted.edge).toBe(1080 * PASSAGE_EDGE_RATIO);
      expect(fitted.marginY).toBe(1080 * PASSAGE_TEXT_TOP);
      expect([fitted.headerSize, fitted.creditSize]).toEqual([short.headerSize, short.creditSize]);
    }
  });
});
