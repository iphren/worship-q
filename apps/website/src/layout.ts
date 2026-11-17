// The frame every page of worship-q.com shares: head tags, header with navigation, footer and
// the analytics beacon. The home page puts the header and footer in at its %HEADER% and
// %FOOTER% marks; the Markdown pages (pages.ts) are wrapped whole by `pageHtml`.
//
// Tailwind finds the classes used here by reading this file, so write class names out in
// full: never build them from pieces.

export const SITE = 'https://worship-q.com';
export const REPO_URL = 'https://github.com/iphren/worship-q';

export const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** The header's links, in order. */
const NAV = [
  { href: '/guide/', label: 'Guide' },
  { href: '/compare/', label: 'Compare' },
  { href: '/releases/', label: 'Releases' },
];

/** The site's header; `current` is the path of the page it is on. */
export function header(current = '/'): string {
  const links = NAV.map(
    ({ href, label }) =>
      `<a href="${href}" class="${current === href ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');
  return `<header class="flex flex-wrap items-center gap-x-5 gap-y-2 py-6">
  <a href="/" class="flex items-center gap-3"><img src="/logo.svg" alt="" class="size-9" /><span class="text-lg font-semibold text-slate-100">Worship Q</span></a>
  <span class="flex-1"></span>
  <nav class="flex gap-5 text-sm" aria-label="Site">${links}</nav>
</header>`;
}

/** The feature pages, for the footer. */
export const FEATURE_PAGES = [
  { href: '/bible/', label: 'Bible passages' },
  { href: '/multilingual-lyrics/', label: 'Lyrics in several languages' },
  { href: '/obs/', label: 'OBS and live streams' },
  { href: '/phone-remote/', label: 'Phone remote' },
  { href: '/several-computers/', label: 'Several computers' },
];

/** The site's footer. */
export function footer(): string {
  const link = (href: string, label: string) =>
    `<a href="${href}" class="hover:text-slate-200">${label}</a>`;
  return `<footer class="grid gap-6 border-t border-slate-800 py-8 text-sm text-slate-400 sm:grid-cols-3">
  <div class="flex flex-col gap-2"><span class="font-medium text-slate-300">Features</span>${FEATURE_PAGES.map((p) => link(p.href, p.label)).join('')}</div>
  <div class="flex flex-col gap-2"><span class="font-medium text-slate-300">Help</span>${link('/guide/', 'Volunteer guide')}${link('/server/', 'Church server setup')}${link('/compare/', 'Compare')}${link('/releases/', 'Release notes')}</div>
  <div class="flex flex-col gap-2"><span class="font-medium text-slate-300">Project</span>${link(REPO_URL, 'Source code')}${link(`${REPO_URL}/blob/main/LICENSE`, 'MIT licence')}${link('/llms.txt', 'For AI assistants')}</div>
</footer>`;
}

/** Cloudflare Web Analytics: no cookies, so no consent banner (docs/seo-plan.md phase 6). */
export const ANALYTICS = `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "299edc4c8a35464fb18cb33e77f1886f"}'></script>`;

export interface PageFrame {
  /** The page's address on the site, such as `/guide/`. */
  path: string;
  /** The `<title>`. */
  title: string;
  description: string;
  /** The page's Markdown copy, such as `/guide/index.md`. */
  markdown: string;
  /** The page's content, already HTML. */
  body: string;
}

/** A whole page around `body`. */
export function pageHtml(page: PageFrame): string {
  const url = `${SITE}${page.path}`;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#020617" />
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <link rel="alternate" type="text/markdown" href="${page.markdown}" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>${title}</title>
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Worship Q" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${SITE}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="/src/styles.css" />
    <script type="module" src="/src/lightbox.ts"></script>
  </head>
  <body class="min-h-screen">
    <div class="mx-auto flex min-h-screen max-w-3xl flex-col px-4 sm:px-6">
      ${header(page.path)}
      <main class="prose flex-1 py-8 sm:py-12">
${page.body}
      </main>
      ${footer()}
    </div>
    ${ANALYTICS}
  </body>
</html>
`;
}
