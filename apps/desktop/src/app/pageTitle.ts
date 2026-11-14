/**
 * A website's own title, read from the start of its page, to name a website item without
 * the operator typing one. Best effort: null whenever the site cannot be read in time.
 */
import { youtubeEmbedUrl } from '@worship-q/protocol';

/** The start of a page, as the native core reads it: its `Content-Type` and its bytes. */
export interface PageStart {
  contentType: string | null;
  body: Uint8Array;
}

export type FetchPageStart = (url: string) => Promise<PageStart>;

/** Titles longer than this are cut; a slide title is never that long. */
const MAX_TITLE = 120;

/** The title of the page at `url`, or null when it has none or cannot be read. */
export async function pageTitle(url: string, fetch: FetchPageStart): Promise<string | null> {
  try {
    // YouTube's pages can be a consent screen; its oEmbed answer names the video itself.
    if (youtubeEmbedUrl(url)) {
      const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
      const page = await fetch(oembed);
      const { title } = JSON.parse(new TextDecoder().decode(page.body)) as { title?: unknown };
      return typeof title === 'string' ? cleanTitle(title) : null;
    }
    return titleFromHtml(decodePage(await fetch(url)));
  } catch {
    return null;
  }
}

/** A page's text, in the character set its header or its `<meta>` names; UTF-8 otherwise. */
export function decodePage(page: PageStart): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(page.contentType ?? '')?.[1];
  // The `<meta>` is near the top, in plain ASCII whatever the page's own encoding.
  const head = new TextDecoder('latin1').decode(page.body.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(page.body);
    } catch {
      // A character set this computer does not know: try the next, or UTF-8.
    }
  }
  return new TextDecoder().decode(page.body);
}

/**
 * The title in a page's HTML: its `og:title`, which leaves out the site's name more often
 * than not, or else its `<title>`.
 */
export function titleFromHtml(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\b(?:property|name)\s*=\s*["']?og:title\b/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const title = cleanTitle(content?.[1] ?? content?.[2] ?? '');
    if (title) return title;
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return title ? cleanTitle(title) : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** A title's text with its entities decoded and its spacing tidied; null when empty. */
function cleanTitle(raw: string): string | null {
  const text = raw
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text;
}
