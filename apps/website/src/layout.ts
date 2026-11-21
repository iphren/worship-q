// The frame every page of worship-q.com shares: head tags, header with navigation, footer and
// the analytics beacon. The home page puts the header and footer in at its %HEADER% and
// %FOOTER% marks; the Markdown pages (pages.ts) are wrapped whole by `pageHtml`.
//
// Tailwind finds the classes used here by reading this file, so write class names out in
// full: never build them from pieces.

import { isTranslated, LOCALE_INFO, localePath, SITE_LOCALES, type SiteLocale } from './locales.ts';
import { WORDS } from './words.ts';

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
  { href: '/guide/', label: 'guide' },
  { href: '/compare/', label: 'compare' },
  { href: '/releases/', label: 'releases' },
] as const;

/**
 * The site's header, on the page at `page` (its English path, such as `/guide/`) in a
 * language, with a language button that leads to the same page in the site's other languages.
 */
export function header(page = '/', locale: SiteLocale = 'en'): string {
  const words = WORDS[locale];
  const current = localePath(locale, page);
  const links = NAV.map(({ href, label }) => ({
    href: localePath(locale, href),
    label: words.nav[label],
  }))
    .map(
      ({ href, label }) =>
        `<a href="${href}" class="${current === href ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');
  return `<header class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-6 sm:flex sm:gap-x-5">
  <a href="${localePath(locale, '/')}" class="flex items-center gap-3 whitespace-nowrap sm:mr-auto"><img src="/logo.svg" alt="" class="size-9" /><span class="text-lg font-semibold text-slate-100">Worship Q</span></a>
  ${languageMenu(page, locale)}
  <nav class="col-span-2 flex gap-5 text-sm" aria-label="${words.navLabel}">${links}</nav>
</header>`;
}

/**
 * The language button: it shows the page's language and opens a menu of links to the page in
 * each of the site's languages, each named in itself. A `<details>`, so it opens without
 * JavaScript; languageMenu.ts closes it on Esc or a click elsewhere.
 */
function languageMenu(page: string, locale: SiteLocale): string {
  if (!isTranslated(page)) return '';
  const links = SITE_LOCALES.map((other) => {
    const { name, lang } = LOCALE_INFO[other];
    return other === locale
      ? `<a href="${localePath(other, page)}" lang="${lang}" aria-current="true" class="block rounded-md px-3 py-1.5 whitespace-nowrap text-slate-100">${name}</a>`
      : `<a href="${localePath(other, page)}" hreflang="${lang}" lang="${lang}" class="block rounded-md px-3 py-1.5 whitespace-nowrap text-slate-400 hover:bg-slate-800 hover:text-slate-100">${name}</a>`;
  }).join('');
  return `<details class="language-menu relative justify-self-end text-sm sm:order-last">
    <summary class="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 hover:border-slate-500 hover:text-slate-100" aria-label="${WORDS[locale].language}: ${LOCALE_INFO[locale].name}"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.75 5.6 3.75 9S14.5 18.4 12 21c-2.5-2.6-3.75-5.6-3.75-9S9.5 5.6 12 3Z" /></svg>${LOCALE_INFO[locale].name}<svg class="language-menu-arrow size-3 text-slate-500" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></summary>
    <nav class="absolute right-0 z-10 mt-2 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-lg" aria-label="${WORDS[locale].language}">${links}</nav>
  </details>`;
}

/**
 * The page's address in every language, for search engines: `hreflang` links, with English
 * as the default for every other language.
 */
export function alternates(page: string): string {
  if (!isTranslated(page)) return '';
  return [
    ...SITE_LOCALES.map(
      (locale) =>
        `<link rel="alternate" hreflang="${LOCALE_INFO[locale].lang}" href="${SITE}${localePath(locale, page)}" />`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${SITE}${page}" />`,
  ].join('\n    ');
}

/** The feature pages, for the footer, in order; their names are in words.ts. */
export const FEATURE_PAGES = [
  '/bible/',
  '/multilingual-lyrics/',
  '/obs/',
  '/phone-remote/',
  '/several-computers/',
];

/** The site's footer, in a language. */
export function footer(locale: SiteLocale = 'en'): string {
  const words = WORDS[locale];
  const f = words.footer;
  // Site pages in the footer's language; llms.txt and other sites as they are.
  const link = (href: string, label: string, translated = href.startsWith('/')) =>
    `<a href="${translated ? localePath(locale, href) : href}" class="hover:text-slate-200">${label}</a>`;
  return `<footer class="grid gap-6 border-t border-slate-800 py-8 text-sm text-slate-400 sm:grid-cols-3">
  <div class="flex flex-col gap-2"><span class="font-medium text-slate-300">${f.features}</span>${FEATURE_PAGES.map((path) => link(path, words.featurePages[path] ?? path)).join('')}</div>
  <div class="flex flex-col gap-2"><span class="font-medium text-slate-300">${f.help}</span>${link('/guide/', f.guide)}${link('/server/', f.server)}${link('/compare/', f.compare)}${link('/releases/', f.releases)}</div>
  <div class="flex flex-col gap-2"><span class="font-medium text-slate-300">${f.project}</span>${link(REPO_URL, f.source)}${link(`${REPO_URL}/blob/main/LICENSE`, f.licence)}${link('/privacy/', f.privacy)}${link('/llms.txt', f.llms, false)}</div>
</footer>`;
}

/** Cloudflare Web Analytics: no cookies, so no consent banner (docs/seo-plan.md phase 6). */
export const ANALYTICS = `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "299edc4c8a35464fb18cb33e77f1886f"}'></script>`;

export interface PageFrame {
  /** The page's address on the site in its language, such as `/zh-hans/guide/`. */
  path: string;
  /** The page's English address, such as `/guide/`, which names it in every language. */
  page: string;
  /** The `<title>`. */
  title: string;
  description: string;
  /** The page's Markdown copy, such as `/guide/index.md`. */
  markdown: string;
  /** The page's content, already HTML. */
  body: string;
}

/** A whole page around `body`, in a language; `page.path` is already the language's. */
export function pageHtml(page: PageFrame, locale: SiteLocale = 'en'): string {
  const url = `${SITE}${page.path}`;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  return `<!doctype html>
<html lang="${LOCALE_INFO[locale].lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#020617" />
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <link rel="alternate" type="text/markdown" href="${page.markdown}" />
    ${alternates(page.page)}
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
    <script type="module" src="/src/languageMenu.ts"></script>
  </head>
  <body class="min-h-screen">
    <div class="mx-auto flex min-h-screen max-w-3xl flex-col px-4 sm:px-6">
      ${header(page.page, locale)}
      <main class="prose flex-1 py-8 sm:py-12">
${page.body}
      </main>
      ${footer(locale)}
    </div>
    ${ANALYTICS}
  </body>
</html>
`;
}
