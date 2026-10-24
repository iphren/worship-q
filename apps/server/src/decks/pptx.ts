/**
 * Prepares a PowerPoint file for rendering as one image per click.
 *
 * Every slide whose animations appear or remove shapes on a click becomes several slides,
 * one per click: shapes not yet shown are left out, and paragraphs not yet shown are made
 * transparent so the shown ones keep their place. Hidden slides are dropped. Everything
 * else in the file is left as it is, so the renderer lays slides out as PowerPoint would.
 */
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
};
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

/** One rendered page: a slide as it looks after `step` clicks. */
export interface DeckPage {
  /** The slide's position in the original file, from 1, counting hidden slides. */
  slide: number;
  step: number;
  /** The text shown, one entry per paragraph. */
  text: string[];
}

export interface ExpandedDeck {
  pptx: Uint8Array;
  pages: DeckPage[];
  /** Slide size in EMU (914400 per inch). */
  width: number;
  height: number;
}

/** What one animation does to one shape, or to some of its paragraphs. */
interface Effect {
  kind: 'entr' | 'exit';
  spid: string;
  /** First and last paragraph, from 0, when only part of the text is animated. */
  paragraphs: [number, number] | null;
}

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as Document;
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);

function children(parent: Element, ns: string, name: string): Element[] {
  const found: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    const el = node as Element;
    if (node.nodeType === 1 && el.namespaceURI === ns && el.localName === name) found.push(el);
  }
  return found;
}

function descendants(parent: Document | Element, ns: string, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(ns, name)) as Element[];
}

/**
 * The slide's click steps. Entry 0 holds what plays before the first click; each later entry
 * holds what one click starts, including effects that follow it by themselves.
 */
export function clickSteps(slide: Document): Effect[][] {
  const steps: Effect[][] = [[]];
  const main = descendants(slide, NS.p, 'cTn').find(
    (c) => c.getAttribute('nodeType') === 'mainSeq',
  );
  const list = main && children(main, NS.p, 'childTnLst')[0];
  if (!list) return steps;
  for (const group of children(list, NS.p, 'par')) {
    const groupTiming = children(group, NS.p, 'cTn')[0];
    const conditions = groupTiming ? descendants(groupTiming, NS.p, 'cond') : [];
    const onClick = conditions.some((c) => c.getAttribute('delay') === 'indefinite');
    if (onClick) steps.push([]);
    const step = steps[steps.length - 1]!;
    for (const timing of descendants(group, NS.p, 'cTn')) {
      const kind = timing.getAttribute('presetClass');
      if (kind !== 'entr' && kind !== 'exit') continue;
      const target = descendants(timing, NS.p, 'spTgt')[0];
      const spid = target?.getAttribute('spid');
      if (!target || !spid) continue;
      const range = descendants(target, NS.p, 'pRg')[0];
      step.push({
        kind,
        spid,
        paragraphs: range
          ? [Number(range.getAttribute('st')), Number(range.getAttribute('end'))]
          : null,
      });
    }
  }
  return steps;
}

/** What is hidden after each step, without repeating a step that changes nothing visible. */
function hiddenAfterSteps(steps: Effect[][]): { step: number; hidden: Effect[] }[] {
  const targets = new Map<string, { effect: Effect; visible: boolean }>();
  const keyOf = (e: Effect) => `${e.spid}:${e.paragraphs?.join('-') ?? '*'}`;
  for (const effect of steps.flat()) {
    const key = keyOf(effect);
    // Something that first enters is hidden until then; anything else starts shown.
    if (!targets.has(key)) targets.set(key, { effect, visible: effect.kind !== 'entr' });
  }
  const states: { step: number; hidden: Effect[]; signature: string }[] = [];
  steps.forEach((step, index) => {
    for (const effect of step) targets.get(keyOf(effect))!.visible = effect.kind === 'entr';
    const hidden = [...targets.values()].filter((t) => !t.visible).map((t) => t.effect);
    const signature = hidden.map(keyOf).sort().join(',');
    if (states.at(-1)?.signature !== signature) states.push({ step: index, hidden, signature });
  });
  return states;
}

function shapeById(slide: Document, spid: string): Element | null {
  const name = descendants(slide, NS.p, 'cNvPr').find((c) => c.getAttribute('id') === spid);
  // cNvPr sits in the shape's nvSpPr (or nvPicPr, nvGrpSpPr, …), directly under the shape.
  return (name?.parentNode?.parentNode as Element | null) ?? null;
}

const FILLS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];

/** Makes a run's text transparent, keeping its size and so its place. */
function makeTransparent(doc: Document, props: Element) {
  for (const name of FILLS) for (const el of children(props, NS.a, name)) props.removeChild(el);
  const fill = doc.createElementNS(NS.a, 'a:solidFill');
  const color = doc.createElementNS(NS.a, 'a:srgbClr');
  color.setAttribute('val', 'FFFFFF');
  const alpha = doc.createElementNS(NS.a, 'a:alpha');
  alpha.setAttribute('val', '0');
  color.appendChild(alpha);
  fill.appendChild(color);
  // The fill comes after an outline and before everything else.
  const outline = children(props, NS.a, 'ln')[0];
  props.insertBefore(fill, outline ? outline.nextSibling : props.firstChild);
}

function hideParagraph(doc: Document, paragraph: Element) {
  for (const run of [...children(paragraph, NS.a, 'r'), ...children(paragraph, NS.a, 'fld')]) {
    let props = children(run, NS.a, 'rPr')[0];
    if (!props) {
      props = doc.createElementNS(NS.a, 'a:rPr');
      run.insertBefore(props, run.firstChild);
    }
    makeTransparent(doc, props);
  }
  const end = children(paragraph, NS.a, 'endParaRPr')[0];
  if (end) makeTransparent(doc, end);
  // The bullet takes the text's (now transparent) colour.
  let props = children(paragraph, NS.a, 'pPr')[0];
  if (!props) {
    props = doc.createElementNS(NS.a, 'a:pPr');
    paragraph.insertBefore(props, paragraph.firstChild);
  }
  for (const name of ['buClr', 'buClrTx']) {
    for (const el of children(props, NS.a, name)) props.removeChild(el);
  }
  const after = [
    'buSzTx',
    'buSzPct',
    'buSzPts',
    'buFontTx',
    'buFont',
    'buNone',
    'buAutoNum',
    'buChar',
    'buBlip',
    'tabLst',
    'defRPr',
    'extLst',
  ].flatMap((name) => children(props, NS.a, name))[0];
  props.insertBefore(doc.createElementNS(NS.a, 'a:buClrTx'), after ?? null);
}

function textBody(shape: Element): Element | null {
  return descendants(shape, NS.p, 'txBody')[0] ?? null;
}

/** The slide's text in reading order, leaving out hidden paragraphs. */
function slideText(slide: Document, hiddenParagraphs: Map<Element, Set<number>>): string[] {
  const lines: string[] = [];
  const bodies = [...descendants(slide, NS.p, 'txBody'), ...descendants(slide, NS.a, 'txBody')];
  // Document order: sort by position among all elements.
  const order = new Map(
    (Array.from(slide.getElementsByTagName('*')) as Element[]).map((el, i) => [el, i]),
  );
  bodies.sort((x, y) => order.get(x)! - order.get(y)!);
  for (const body of bodies) {
    const hidden = hiddenParagraphs.get(body);
    children(body, NS.a, 'p').forEach((paragraph, index) => {
      if (hidden?.has(index)) return;
      // A line break inside a paragraph starts a new line of text.
      const text = Array.from(paragraph.getElementsByTagNameNS(NS.a, '*') as unknown as Element[])
        .map((el) =>
          el.localName === 't' ? (el.textContent ?? '') : el.localName === 'br' ? '\n' : '',
        )
        .join('');
      for (const line of text.split('\n')) {
        const clean = line.replace(/\s+/g, ' ').trim();
        if (clean) lines.push(clean);
      }
    });
  }
  return lines;
}

/** The slide as it looks with `hidden` hidden, without animations or transitions. */
function slideAt(xml: string, hidden: Effect[]): { xml: string; text: string[] } {
  const doc = parse(xml);
  for (const name of ['timing', 'transition']) {
    for (const el of descendants(doc, NS.p, name)) {
      // A transition is often wrapped for older readers; drop the wrapper with it.
      const wrapper = el.parentNode?.parentNode as Element | null;
      const target =
        wrapper?.namespaceURI === NS.mc && wrapper.localName === 'AlternateContent' ? wrapper : el;
      target.parentNode?.removeChild(target);
    }
  }
  const hiddenParagraphs = new Map<Element, Set<number>>();
  const removed: Element[] = [];
  for (const effect of hidden) {
    const shape = shapeById(doc, effect.spid);
    if (!shape) continue;
    if (!effect.paragraphs) {
      removed.push(shape);
      continue;
    }
    const body = textBody(shape);
    if (!body) continue;
    const paragraphs = children(body, NS.a, 'p');
    const set = hiddenParagraphs.get(body) ?? new Set<number>();
    for (let i = effect.paragraphs[0]; i <= effect.paragraphs[1] && i < paragraphs.length; i++) {
      hideParagraph(doc, paragraphs[i]!);
      set.add(i);
    }
    hiddenParagraphs.set(body, set);
  }
  for (const shape of removed) shape.parentNode?.removeChild(shape);
  return { xml: serialize(doc), text: slideText(doc, hiddenParagraphs) };
}

function resolve(base: string, target: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function relsPath(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}

/** Expands a .pptx (or .ppsx, .pptm, .potx) file into one slide per click. */
export function expandPptx(file: Uint8Array): ExpandedDeck {
  const files = unzipSync(file);
  const read = (path: string) => {
    const data = files[path];
    if (!data) throw new Error(`The file has no ${path}; it may not be a PowerPoint file.`);
    return strFromU8(data);
  };
  const types = parse(read('[Content_Types].xml'));
  const mainPart =
    descendants(types, NS.ct, 'Override')
      .find((o) =>
        /presentationml\.(presentation|slideshow|template)\.main/.test(
          o.getAttribute('ContentType') ?? '',
        ),
      )
      ?.getAttribute('PartName')
      ?.slice(1) ?? 'ppt/presentation.xml';
  const presentation = parse(read(mainPart));
  const presentationRels = parse(read(relsPath(mainPart)));

  const size = descendants(presentation, NS.p, 'sldSz')[0];
  const width = Number(size?.getAttribute('cx') ?? 9144000);
  const height = Number(size?.getAttribute('cy') ?? 6858000);

  const relationships = descendants(presentationRels, NS.rel, 'Relationship');
  const targetOf = new Map(
    relationships.map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']),
  );
  let nextRel =
    Math.max(
      0,
      ...relationships.map((r) => Number(/\d+$/.exec(r.getAttribute('Id') ?? '')?.[0] ?? 0)),
    ) + 1;
  const slideNumbers = Object.keys(files)
    .map((path) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)?.[1])
    .filter(Boolean)
    .map(Number);
  let nextSlide = Math.max(0, ...slideNumbers) + 1;

  const list = descendants(presentation, NS.p, 'sldIdLst')[0];
  const ids = list ? children(list, NS.p, 'sldId') : [];
  let nextId = Math.max(255, ...ids.map((s) => Number(s.getAttribute('id')))) + 1;
  const relRoot = presentationRels.documentElement!;
  const typesRoot = types.documentElement!;

  const pages: DeckPage[] = [];
  ids.forEach((entry, index) => {
    const part = resolve(mainPart, targetOf.get(entry.getAttributeNS(NS.r, 'id')) ?? '');
    const xml = files[part] ? strFromU8(files[part]) : null;
    if (!xml) return;
    const slide = parse(xml);
    if (slide.documentElement?.getAttribute('show') === '0') {
      list!.removeChild(entry);
      return;
    }
    const states = hiddenAfterSteps(clickSteps(slide));
    let insertAfter: Element = entry;
    states.forEach((state, stateIndex) => {
      const rendered = slideAt(xml, state.hidden);
      pages.push({ slide: index + 1, step: state.step, text: rendered.text });
      if (stateIndex === 0) {
        files[part] = strToU8(rendered.xml);
        return;
      }
      const copy = `ppt/slides/slide${nextSlide++}.xml`;
      files[copy] = strToU8(rendered.xml);
      const rels = files[relsPath(part)];
      if (rels) {
        // The copy shares the slide's layout and pictures but not its notes page.
        const doc = parse(strFromU8(rels));
        for (const r of descendants(doc, NS.rel, 'Relationship')) {
          if (r.getAttribute('Type') === NOTES_REL) r.parentNode?.removeChild(r);
        }
        files[relsPath(copy)] = strToU8(serialize(doc));
      }
      const override = types.createElementNS(NS.ct, 'Override');
      override.setAttribute('PartName', `/${copy}`);
      override.setAttribute(
        'ContentType',
        'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
      );
      typesRoot.appendChild(override);
      const rel = presentationRels.createElementNS(NS.rel, 'Relationship');
      const relId = `rId${nextRel++}`;
      rel.setAttribute('Id', relId);
      rel.setAttribute('Type', SLIDE_REL);
      rel.setAttribute('Target', copy.replace(/^ppt\//, ''));
      relRoot.appendChild(rel);
      const id = presentation.createElementNS(NS.p, 'p:sldId');
      id.setAttribute('id', String(nextId++));
      id.setAttributeNS(NS.r, 'r:id', relId);
      list!.insertBefore(id, insertAfter.nextSibling);
      insertAfter = id;
    });
  });

  files['[Content_Types].xml'] = strToU8(serialize(types));
  files[mainPart] = strToU8(serialize(presentation));
  files[relsPath(mainPart)] = strToU8(serialize(presentationRels));
  return { pptx: zipSync(files), pages, width, height };
}
