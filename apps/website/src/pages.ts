// The site's Markdown pages: the guides from docs/, the pages written for the site in
// apps/website/pages/, and the release notes from GitHub. Each becomes an HTML page in the
// site's frame (layout.ts) and keeps its Markdown as the page's copy for AI assistants.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Marked, type Tokens } from 'marked';
import { escapeHtml, pageHtml, REPO_URL, SITE } from './layout.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DOCS = resolve(ROOT, '../../docs');

export interface PageSpec {
  /** The address on the site, ending in `/`. */
  path: string;
  title: string;
  /** The meta description: one or two sentences. */
  description: string;
  /** Where the Markdown comes from. */
  source: { doc: string } | { page: string } | 'releases';
}

/** Every Markdown page, in the order the sitemap lists them. */
export const PAGES: PageSpec[] = [
  {
    path: '/guide/',
    title: 'Volunteer guide — Worship Q',
    description:
      'How to add songs, build a run sheet and present with Worship Q: Bible passages, slides, videos, phones, OBS and live audio.',
    source: { doc: 'volunteer-guide.md' },
  },
  {
    path: '/server/',
    title: 'Church server setup — Worship Q',
    description:
      "Run your church's own free Worship Q server with Docker: shared songs and media, Bible passages, phone remote control, backups and an admin app.",
    source: { doc: 'server-deployment.md' },
  },
  {
    path: '/bible/',
    title: 'Bible passages on the projector — Worship Q',
    description:
      'Show a Bible passage in seconds: type the reference, see two versions side by side, and present it. Free church presentation software.',
    source: { page: 'bible.md' },
  },
  {
    path: '/bilingual-lyrics/',
    title: 'Lyrics in two languages on one slide — Worship Q',
    description:
      'Show worship lyrics in two languages, such as Chinese and English, on the same slide. Search Chinese songs by pinyin or initials.',
    source: { page: 'bilingual-lyrics.md' },
  },
  {
    path: '/obs/',
    title: 'Lyrics subtitles and scene control for OBS — Worship Q',
    description:
      'Put song lyrics on your live stream with a subtitle overlay for OBS, and switch scenes, stream and record from Worship Q or a phone.',
    source: { page: 'obs.md' },
  },
  {
    path: '/phone-remote/',
    title: 'Control the slides from a phone — Worship Q',
    description:
      'Scan a QR code and move through the slides, change the run sheet or add a Bible passage from a phone, anywhere in the room.',
    source: { page: 'phone-remote.md' },
  },
  {
    path: '/several-computers/',
    title: 'Several computers, one presentation — Worship Q',
    description:
      'Every computer in the venue shows the same slide, and if the presenting one fails, another carries on from the same slide.',
    source: { page: 'several-computers.md' },
  },
  {
    path: '/compare/',
    title: 'Worship Q compared with ProPresenter, EasyWorship, OpenLP, FreeShow and Proclaim',
    description:
      'How Worship Q, a free and open-source church presentation app, compares with ProPresenter, EasyWorship, OpenLP, FreeShow and Proclaim.',
    source: { page: 'compare.md' },
  },
  {
    path: '/releases/',
    title: 'Release notes — Worship Q',
    description: 'What changed in each version of Worship Q, the free church presentation app.',
    source: 'releases',
  },
];

/** Where each document of docs/ lives on the site; the others stay on GitHub. */
const DOC_PAGES = new Map(
  PAGES.flatMap((page) =>
    typeof page.source === 'object' && 'doc' in page.source
      ? [[page.source.doc, page.path] as const]
      : [],
  ),
);

/**
 * A link as the site needs it. A document's relative link to another document goes to that
 * document's page, or to GitHub when it has none; `absolute` makes site links full URLs, for
 * the Markdown copies read away from the site.
 */
function siteLink(href: string, fromDocs: boolean, absolute: boolean): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('#')) return href;
  let target = href;
  if (fromDocs && !href.startsWith('/')) {
    const [file = '', anchor] = href.split('#');
    const page = DOC_PAGES.get(file);
    target = page ? `${page}${anchor ? `#${anchor}` : ''}` : `${REPO_URL}/blob/main/docs/${href}`;
  }
  return absolute && target.startsWith('/') ? `${SITE}${target}` : target;
}

/** Rewrites every Markdown link and image address with `siteLink`. */
function rewriteLinks(markdown: string, fromDocs: boolean, absolute: boolean): string {
  return markdown.replace(
    /(\]\()([^)\s]+)(\))/g,
    (_, open: string, href: string, close: string) =>
      `${open}${siteLink(href, fromDocs, absolute)}${close}`,
  );
}

/** A heading's id as GitHub makes it, so links written for GitHub keep working. */
function slug(text: string, seen: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

/**
 * Markdown to HTML, with GitHub's heading ids, tables wrapped to scroll on phones, and each
 * screenshot linked to its full-size picture, which opens in the lightbox (src/lightbox.ts).
 */
function render(markdown: string): string {
  const seen = new Map<string, number>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      image({ href, text }: Tokens.Image) {
        const full = /^(\/screenshots\/[^/]+)\.webp$/.exec(href);
        if (!full) return false;
        return `<a href="${full[1]}.png"><img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" /></a>`;
      },
      heading({ tokens, depth, text }: Tokens.Heading) {
        const id = slug(text, seen);
        return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: 'th' | 'td') =>
          `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
        const rows = token.rows
          .map((row) => `<tr>${row.map((c) => cell(c, 'td')).join('')}</tr>`)
          .join('');
        return `<div class="table-scroll"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  return marked.parse(markdown, { async: false });
}

interface Release {
  tag_name: string;
  published_at: string;
  html_url: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

/** Every published release's notes, newest first, as one Markdown page. */
async function releasesMarkdown(repo: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${repo}'s releases`);
  const releases = ((await response.json()) as Release[]).filter((r) => !r.draft && !r.prerelease);
  const sections = releases.map((release) => {
    // release-please starts the notes with a heading of its own: the version and date.
    const notes = (release.body ?? '')
      .replaceAll('\r\n', '\n')
      .replace(/^#{1,3} \[?[\d.]+\]?.*\n+/, '')
      .trim();
    return `## ${release.tag_name.replace(/^v/, '')} · ${longDate(release.published_at)}

${notes || 'No notes.'}

[On GitHub](${release.html_url})`;
  });
  return `# Release notes

Installed copies of Worship Q update themselves, never while the slideshow is open. Every
version is also on [GitHub](${REPO_URL}/releases), with its installers.

${sections.join('\n\n')}
`;
}

/** A page's Markdown source, before links are rewritten. */
async function source(page: PageSpec, repo: string): Promise<{ text: string; fromDocs: boolean }> {
  if (page.source === 'releases') return { text: await releasesMarkdown(repo), fromDocs: false };
  if ('doc' in page.source)
    return { text: readFileSync(resolve(DOCS, page.source.doc), 'utf8'), fromDocs: true };
  return { text: readFileSync(resolve(ROOT, 'pages', page.source.page), 'utf8'), fromDocs: false };
}

export interface BuiltPage {
  spec: PageSpec;
  /** The page, as `<path>index.html`. */
  html: string;
  /** Its Markdown copy, as `<path>index.md`, with full URLs. */
  markdown: string;
}

/** Every Markdown page, built. */
export async function buildPages(repo: string): Promise<BuiltPage[]> {
  return Promise.all(
    PAGES.map(async (spec) => {
      const { text, fromDocs } = await source(spec, repo);
      return {
        spec,
        html: pageHtml({
          path: spec.path,
          title: spec.title,
          description: spec.description,
          markdown: `${spec.path}index.md`,
          body: render(rewriteLinks(text, fromDocs, false)),
        }),
        markdown: rewriteLinks(text, fromDocs, true),
      };
    }),
  );
}
