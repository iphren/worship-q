import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { expandPptx } from './pptx';

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const shape = (id: number, paragraphs: string[]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>` +
  `<p:txBody><a:bodyPr/>${paragraphs.map((t) => `<a:p><a:r><a:rPr lang="en-GB"/><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;

const effect = (kind: string, spid: number, range?: [number, number]) =>
  `<p:par><p:cTn presetID="1" presetClass="${kind}" nodeType="clickEffect"><p:childTnLst><p:set><p:cBhvr>` +
  `<p:tgtEl><p:spTgt spid="${spid}">${range ? `<p:txEl><p:pRg st="${range[0]}" end="${range[1]}"/></p:txEl>` : ''}</p:spTgt></p:tgtEl>` +
  `</p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>`;

const group = (click: boolean, ...effects: string[]) =>
  `<p:par><p:cTn fill="hold"><p:stCondLst><p:cond delay="${click ? 'indefinite' : '0'}"/></p:stCondLst>` +
  `<p:childTnLst><p:par><p:cTn><p:childTnLst>${effects.join('')}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;

const timing = (...groups: string[]) =>
  `<p:timing><p:tnLst><p:par><p:cTn nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn nodeType="mainSeq">` +
  `<p:childTnLst>${groups.join('')}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

const slide = (body: string, extra = '', attrs = '') =>
  `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P} ${A} ${R}${attrs}><p:cSld><p:spTree>${body}</p:spTree></p:cSld>${extra}</p:sld>`;

function deck(slides: string[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
        slides
          .map(
            (_, i) =>
              `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
          )
          .join('') +
        `</Types>`,
    ),
    'ppt/presentation.xml': strToU8(
      `<?xml version="1.0"?><p:presentation ${P} ${R}><p:sldIdLst>` +
        slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('') +
        `</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        slides
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`,
          )
          .join('') +
        `</Relationships>`,
    ),
  };
  slides.forEach((xml, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(xml);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/>` +
        `</Relationships>`,
    );
  });
  return zipSync(files);
}

/** The expanded file's slides in presentation order. */
function slidesOf(pptx: Uint8Array): string[] {
  const files = unzipSync(pptx);
  const presentation = strFromU8(files['ppt/presentation.xml']!);
  const rels = strFromU8(files['ppt/_rels/presentation.xml.rels']!);
  return [...presentation.matchAll(/r:id="(rId\d+)"/g)].map(([, id]) => {
    const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)![1];
    return strFromU8(files[`ppt/${target}`]!);
  });
}

describe('expanding PowerPoint animations into slides', () => {
  it('makes one slide per click, hiding shapes and paragraphs not yet shown', () => {
    const expanded = expandPptx(
      deck([
        slide(
          shape(2, ['Title']) + shape(3, ['one', 'two', 'three']) + shape(4, ['picture']),
          timing(
            group(false, effect('entr', 2)),
            group(true, effect('entr', 3, [1, 1])),
            group(true, effect('entr', 3, [2, 2]), effect('entr', 4)),
            group(true, effect('exit', 4)),
          ),
        ),
        slide(shape(2, ['Second slide'])),
      ]),
    );
    expect(expanded.pages.map((p) => [p.slide, p.step, p.text])).toEqual([
      [1, 0, ['Title', 'one']],
      [1, 1, ['Title', 'one', 'two']],
      [1, 2, ['Title', 'one', 'two', 'three', 'picture']],
      [1, 3, ['Title', 'one', 'two', 'three']],
      [2, 0, ['Second slide']],
    ]);
    expect([expanded.width, expanded.height]).toEqual([12192000, 6858000]);

    const slides = slidesOf(expanded.pptx);
    expect(slides).toHaveLength(5);
    // Not shown yet: the picture is left out, the paragraphs are transparent but kept.
    expect(slides[0]).not.toContain('picture');
    expect(slides[0]!.match(/<a:alpha val="0"\/>/g)).toHaveLength(2);
    expect(slides[2]).toContain('picture');
    expect(slides[2]).not.toContain('<a:alpha');
    expect(slides[3]).not.toContain('picture');
    for (const xml of slides) expect(xml).not.toContain('p:timing');

    const files = unzipSync(expanded.pptx);
    const types = strFromU8(files['[Content_Types].xml']!);
    expect(types.match(/presentationml\.slide\+xml/g)).toHaveLength(5);
    const presentation = strFromU8(files['ppt/presentation.xml']!);
    const ids = [...presentation.matchAll(/<p:sldId id="(\d+)"/g)].map(([, id]) => id);
    expect(new Set(ids).size).toBe(5);
    // A copy keeps the layout but not the notes page.
    const copyRels = strFromU8(files['ppt/slides/_rels/slide3.xml.rels']!);
    expect(copyRels).toContain('slideLayout');
    expect(copyRels).not.toContain('notesSlide');
  });

  it('drops hidden slides and leaves slides without animations alone', () => {
    const plain = slide(shape(2, ['Plain']));
    const expanded = expandPptx(deck([plain, slide(shape(2, ['Hidden']), '', ' show="0"')]));
    expect(expanded.pages).toEqual([{ slide: 1, step: 0, text: ['Plain'] }]);
    expect(slidesOf(expanded.pptx)).toHaveLength(1);
  });

  it('does not repeat a slide for a click that changes nothing visible', () => {
    const expanded = expandPptx(
      deck([
        slide(
          shape(2, ['a']) + shape(3, ['b']),
          timing(group(true, effect('emph', 2)), group(true, effect('entr', 3))),
        ),
      ]),
    );
    expect(expanded.pages.map((p) => p.step)).toEqual([0, 2]);
  });
});
