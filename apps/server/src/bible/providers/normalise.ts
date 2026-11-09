/**
 * Turns each provider's passage into the one normalised shape (B22, spike P0.2): a unit per
 * verse or joined group, with poetry kept as lines and indents, and a psalm's title as a unit
 * of its own. Headings, footnotes, cross-references, pilcrows and links are dropped.
 *
 * A small tag reader stands in for an HTML parser: the providers' markup is regular, and the
 * recorded fixtures prove each adapter against it.
 */
import type { PassageLine, PassageUnit } from '@worship-q/bible';

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

const tidy = (text: string) => decode(text).replace(/\s+/g, ' ').trim();

type Token =
  { text: string } | { tag: string; close: boolean; self: boolean; attrs: Record<string, string> };

function tokens(html: string): Token[] {
  const out: Token[] = [];
  const re = /<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) {
      out.push({ text: m[5] });
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(/([a-z-]+)="([^"]*)"/gi)) attrs[a[1]!.toLowerCase()] = a[2]!;
    const tag = m[2]!.toLowerCase();
    out.push({ tag, close: m[1] === '/', self: m[4] === '/' || tag === 'br', attrs });
  }
  return out;
}

interface Building extends PassageUnit {
  lines: PassageLine[];
}

/** Collects units from a stream of verse starts, line breaks and text. */
class Builder {
  private units: Building[] = [];
  private current: Building | null = null;
  private indent = 0;
  private lineOpen = false;

  constructor(private chapter: number) {}

  verse(chapter: number | undefined, verses: number[], label: string): void {
    if (chapter !== undefined && Number.isFinite(chapter)) this.chapter = chapter;
    this.current = { chapter: this.chapter, verses, label, lines: [] };
    this.units.push(this.current);
    this.lineOpen = false;
  }

  title(): void {
    this.current = { chapter: this.chapter, verses: [], label: '', title: true, lines: [] };
    this.units.push(this.current);
    this.lineOpen = false;
  }

  newLine(indent: number): void {
    this.indent = indent;
    this.lineOpen = false;
  }

  text(raw: string): void {
    const current = this.current;
    if (!current) return;
    const text = decode(raw).replace(/\s+/g, ' ');
    if (!text.trim()) {
      if (this.lineOpen) current.lines[current.lines.length - 1]!.text += ' ';
      return;
    }
    if (!this.lineOpen) {
      current.lines.push({ text: '', indent: this.indent });
      this.lineOpen = true;
    }
    current.lines[current.lines.length - 1]!.text += text;
  }

  done(): PassageUnit[] {
    return this.units
      .map((unit) => ({
        ...unit,
        lines: unit.lines
          .map((line) => ({
            ...line,
            text: line.text
              .replace(/¶/g, '')
              .replace(/\(\s*\)$/, '')
              .replace(/\s+/g, ' ')
              .trim(),
          }))
          .filter((line) => line.text),
      }))
      .filter((unit) => unit.lines.length > 0);
  }
}

/** USFM paragraph styles that are poetry or other lines, with their indent. */
const POETRY: Record<string, number> = {
  q: 0,
  q1: 0,
  q2: 1,
  q3: 1,
  q4: 1,
  qc: 0,
  qr: 0,
  m: 0,
  pi: 0,
  pi1: 0,
  pi2: 1,
};
const DROPPED =
  /\b(yv-n|yv-h|s|s1|s2|s3|s4|ms|ms1|ms2|mr|r|cl|fr|ft|fqa|x|note|heading|extra_text)\b/;
const HEADING_STYLES = /^(s\d?|ms\d?|mr|r|cl|sp|d?h\d?)$/;

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i);

/**
 * YouVersion's HTML: `<span class="yv-v" v="12" ev="13">` starts a verse (`ev` for a joined
 * one), `yv-vlbl` is the printed label, class `d` a psalm's title, `yv-n` notes and `yv-h`
 * headings.
 */
export function fromYouVersion(html: string, chapter: number): PassageUnit[] {
  const builder = new Builder(chapter);
  const stack: boolean[] = [];
  let skip = 0;
  for (const token of tokens(html)) {
    if ('text' in token) {
      if (!skip) builder.text(token.text);
      continue;
    }
    if (token.self) {
      if (token.tag === 'br') builder.newLine(0);
      continue;
    }
    if (token.close) {
      if (stack.pop()) skip--;
      continue;
    }
    const cls = token.attrs.class ?? '';
    if (skip || DROPPED.test(cls) || /\byv-vlbl\b/.test(cls)) {
      stack.push(true);
      skip++;
      continue;
    }
    stack.push(false);
    if (/\byv-v\b/.test(cls)) {
      const v = Number(token.attrs.v);
      const ev = Number(token.attrs.ev ?? token.attrs.v);
      builder.verse(undefined, range(v, ev), ev > v ? `${v}-${ev}` : String(v));
    } else if (token.tag === 'div' && /^d\b/.test(cls)) {
      builder.title();
    } else if (token.tag === 'div') {
      builder.newLine(POETRY[cls.split(/\s+/)[0] ?? ''] ?? 0);
    }
  }
  return builder.done();
}

interface ApiBibleNode {
  type?: string;
  name?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  items?: ApiBibleNode[];
}

/**
 * API.Bible's JSON: `para` nodes with a USFM style hold `verse` nodes (`sid` such as
 * `1CH 16:12-13`) and text; `note` nodes are dropped.
 */
export function fromApiBible(content: ApiBibleNode[], chapter: number): PassageUnit[] {
  const builder = new Builder(chapter);
  const walk = (node: ApiBibleNode): void => {
    if (node.type === 'text') {
      builder.text(node.text ?? '');
      return;
    }
    const attrs = node.attrs ?? {};
    if (node.name === 'note') return;
    if (node.name === 'para') {
      const style = String(attrs.style ?? 'p');
      if (HEADING_STYLES.test(style)) return;
      if (style === 'd') builder.title();
      else builder.newLine(POETRY[style] ?? 0);
    }
    if (node.name === 'verse') {
      const m = /(\d+):(\d+)(?:-(\d+))?/.exec(String(attrs.sid ?? ''));
      const v = m ? Number(m[2]) : Number.parseInt(String(attrs.number), 10);
      const ev = m?.[3] ? Number(m[3]) : v;
      builder.verse(m ? Number(m[1]) : undefined, range(v, ev), String(attrs.number ?? v));
      return; // The verse node's own text is its printed number.
    }
    for (const child of node.items ?? []) walk(child);
  };
  for (const node of content) walk(node);
  return builder.done();
}

/**
 * ESV's HTML: `<b class="verse-num" id="v43003016-1">` gives book, chapter and verse; poetry
 * lines are `<span class="line">` or `indent line`; headings `h2`–`h4`, a psalm's title
 * `h4.psalm-title`; the closing `(ESV)` link is dropped, Worship Q adding the credit.
 */
export function fromEsv(html: string): PassageUnit[] {
  const builder = new Builder(1);
  const stack: boolean[] = [];
  let skip = 0;
  for (const token of tokens(html)) {
    if ('text' in token) {
      if (!skip) builder.text(token.text);
      continue;
    }
    if (token.self) continue;
    if (token.close) {
      if (stack.pop()) skip--;
      continue;
    }
    const cls = token.attrs.class ?? '';
    if (skip) {
      stack.push(true);
      skip++;
      continue;
    }
    if (token.tag === 'h4' && /psalm-title/.test(cls)) {
      stack.push(false);
      builder.title();
      continue;
    }
    if (/^h\d$/.test(token.tag) || token.tag === 'a' || /footnote|crossref/.test(cls)) {
      stack.push(true);
      skip++;
      continue;
    }
    if (token.tag === 'b' && /verse-num|chapter-num/.test(cls)) {
      const m = /^v(\d\d)(\d\d\d)(\d\d\d)/.exec(token.attrs.id ?? '');
      if (m) builder.verse(Number(m[2]), [Number(m[3])], String(Number(m[3])));
      stack.push(true); // The printed number.
      skip++;
      continue;
    }
    stack.push(false);
    if (token.tag === 'span' && /\bline\b/.test(cls))
      builder.newLine(/\bindent\b/.test(cls) ? 1 : 0);
    if (token.tag === 'p') builder.newLine(0);
  }
  return builder.done();
}

/** One entry of a Free Use Bible API chapter's content. */
export interface FreeUseContent {
  type: string;
  number?: number;
  content?: (string | { text?: string; poem?: number; noteId?: number; lineBreak?: boolean })[];
}

const WORD_END = /[A-Za-z,.;:!?’”]$/;
const WORD_START = /^[A-Za-z‘“]/;

/**
 * The Free Use Bible API's chapter, sliced to `from`–`to`. A number missing between two
 * verses is read as joined into the verse before (CUNP's 1 Chronicles 16:12–13 arrives as 12,
 * with no 13). A note between two words loses the space between them, which is restored.
 */
export function fromFreeUse(
  chapter: number,
  content: FreeUseContent[],
  from: number,
  to: number,
): PassageUnit[] {
  const units: PassageUnit[] = [];
  const verses = content.filter((entry) => entry.type === 'verse' && entry.number !== undefined);
  for (const [i, entry] of verses.entries()) {
    const number = entry.number!;
    const next = verses[i + 1]?.number;
    const covers = [number];
    for (let n = number + 1; next !== undefined && n < next; n++) covers.push(n);
    if (covers[covers.length - 1]! < from || number > to) continue;
    const lines: PassageLine[] = [];
    let open = false;
    const append = (text: string) => {
      const last = lines[lines.length - 1]!;
      const gap = last.text && WORD_END.test(last.text) && WORD_START.test(text) ? ' ' : '';
      last.text += gap + text;
    };
    for (const part of entry.content ?? []) {
      if (typeof part === 'string') {
        if (!open) lines.push({ text: '', indent: 0 });
        append(part);
        open = true;
      } else if (part.lineBreak) {
        open = false;
      } else if (part.text !== undefined) {
        if (part.poem !== undefined || !open) {
          lines.push({ text: '', indent: part.poem !== undefined && part.poem >= 2 ? 1 : 0 });
        }
        append(part.text);
        open = part.poem === undefined;
      }
    }
    units.push({
      chapter,
      verses: covers,
      label: covers.length > 1 ? `${covers[0]}-${covers[covers.length - 1]}` : String(number),
      lines: lines.map((line) => ({ ...line, text: tidy(line.text) })).filter((line) => line.text),
    });
  }
  const subtitle = content.find((entry) => entry.type === 'hebrew_subtitle');
  if (subtitle && from <= 1) {
    const text = tidy(
      (subtitle.content ?? [])
        .map((part) => (typeof part === 'string' ? part : (part.text ?? '')))
        .join(' '),
    );
    if (text)
      units.unshift({ chapter, verses: [], label: '', title: true, lines: [{ text, indent: 0 }] });
  }
  return units.filter((unit) => unit.lines.length > 0);
}
