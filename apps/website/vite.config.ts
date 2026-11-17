import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import { CONTENT } from './src/content.ts';
import { FAQS } from './src/faq.ts';
import { HOME } from './src/home.ts';
import {
  alternates,
  ANALYTICS,
  escapeHtml as escapeAttribute,
  footer,
  header,
  SITE,
} from './src/layout.ts';
import { indexMd, llmsFullTxt, llmsTxt, type ReleaseFacts } from './src/llms.ts';
import { LOCALE_INFO, localePath, SITE_LOCALES, type SiteLocale } from './src/locales.ts';
import { buildPages, PAGES as MARKDOWN_PAGES, type BuiltPage } from './src/pages.ts';
import { WORDS } from './src/words.ts';

// The public site at worship-q.com, built again whenever a release is published.
const REPO = 'iphren/worship-q';
const RELEASES = `https://github.com/${REPO}/releases`;

/** The pages listed in the sitemap, by path, in every language the site has. */
const PAGES = [
  ...new Set(
    SITE_LOCALES.flatMap((locale) =>
      ['/', ...MARKDOWN_PAGES.map((page) => page.path)].map((path) => localePath(locale, path)),
    ),
  ),
];

/**
 * index.html is the English home page. The other languages' are written from it into
 * `generated/` (as `generated/zh-hans/index.html`), and the build fills each in its language.
 * The not-found page stays one, in English: GitHub Pages serves only the site's root 404.html.
 */
const FRAME_PAGES = ['index.html'] as const;

/** The language of a page Vite transforms, from its path: `/generated/zh-hans/index.html`. */
function pageLocale(path: string): SiteLocale {
  const match = /^\/generated\/([^/]+)\//.exec(path);
  return (SITE_LOCALES as readonly string[]).includes(match?.[1] ?? '')
    ? (match![1] as SiteLocale)
    : 'en';
}

/**
 * Where the Markdown pages are written as HTML for Vite to build (git-ignored). Each moves to
 * its own address, such as `/guide/`, when the build is written out.
 */
const GENERATED = resolve(import.meta.dirname, 'generated');

/** The installer each download button serves, by the end of its file name. */
const INSTALLERS = {
  mac: '_universal.dmg',
  windows: '_x64-setup.exe',
};

/** The volunteer guide, copied whole into llms-full.txt. */
const VOLUNTEER_GUIDE = resolve(import.meta.dirname, '../../docs/volunteer-guide.md');

interface Release {
  tag_name: string;
  published_at: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

/** The latest published release, which the download buttons serve. */
async function latestRelease(): Promise<Release | null> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) return null;
  return (await response.json()) as Release;
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A JSON-LD script tag; `<` is escaped so no text can close the script early. */
const jsonLd = (data: object): HtmlTagDescriptor => ({
  tag: 'script',
  attrs: { type: 'application/ld+json' },
  children: JSON.stringify(data).replaceAll('<', '\\u003c'),
  injectTo: 'head',
});

/** The features as they appear on the page. */
function featuresHtml(locale: SiteLocale): string {
  return CONTENT[locale].features
    .map(
      ({ title, text, page }) =>
        `<div><h3 class="font-semibold">${escapeHtml(title)}</h3><p class="mt-1 text-sm text-slate-400">${escapeHtml(text)}${
          page
            ? ` <a href="${localePath(locale, page)}" class="text-sky-400 hover:text-sky-300">${WORDS[locale].more}</a>`
            : ''
        }</p></div>`,
    )
    .join('\n');
}

/** The questions as they appear on the page. */
function faqHtml(locale: SiteLocale): string {
  return FAQS[locale]
    .map(
      ({ question, answer }) =>
        `<details class="faq"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`,
    )
    .join('\n');
}

/** What search engines read about the app, the site and the questions. */
function structuredData(
  release: Release | null,
  installers: string[],
  locale: SiteLocale,
): HtmlTagDescriptor[] {
  const { summary, featureList } = CONTENT[locale];
  const app = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Worship Q',
    alternateName: 'WorshipQ',
    description: summary,
    url: `${SITE}/`,
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'Church presentation software',
    operatingSystem: 'macOS 11 or later, Windows 10 or later (64-bit)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    license: `https://github.com/${REPO}/blob/main/LICENSE`,
    image: `${SITE}/og.png`,
    downloadUrl: installers.length ? installers : RELEASES,
    ...(release && {
      softwareVersion: release.tag_name.replace(/^v/, ''),
      datePublished: release.published_at.slice(0, 10),
      releaseNotes: `${SITE}/releases/`,
    }),
    featureList,
    publisher: { '@id': `${SITE}/#organization` },
  };
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE}/#organization`,
    name: 'Worship Q',
    url: `${SITE}/`,
    logo: `${SITE}/apple-touch-icon.png`,
    sameAs: [`https://github.com/${REPO}`],
  };
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Worship Q',
    url: `${SITE}/`,
    publisher: { '@id': `${SITE}/#organization` },
  };
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS[locale].map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
  return [app, organization, website, faq].map(jsonLd);
}

/** The latest release, and what the pages say about it. */
interface Facts {
  release: Release | null;
  /** The installers' addresses, Mac then Windows, as far as the release has them. */
  installers: string[];
  page: ReleaseFacts;
}

/** Reads the latest release once per build; in CI a release without installers fails it. */
async function releaseFacts(): Promise<Facts> {
  const release = await latestRelease().catch(() => null);
  // A deployed page must link to real installers and name their version.
  const missing = (what: string) => {
    if (process.env.CI) throw new Error(`${what} for ${REPO}`);
    console.warn(`${what}; the page shows placeholders.`);
  };
  if (!release) missing('No published release found');
  const installer = (suffix: string) => {
    const asset = release?.assets.find((a) => a.name.endsWith(suffix));
    if (release && !asset) missing(`${release.tag_name} has no *${suffix}`);
    return asset?.browser_download_url ?? null;
  };
  const mac = installer(INSTALLERS.mac);
  const windows = installer(INSTALLERS.windows);
  return {
    release,
    installers: [mac, windows].filter((url): url is string => url !== null),
    page: {
      version: release?.tag_name.replace(/^v/, '') ?? null,
      date: release ? releaseDate(release, 'en') : null,
      notesUrl: `${SITE}/releases/`,
      macUrl: mac ?? RELEASES,
      windowsUrl: windows ?? RELEASES,
    },
  };
}

/** The day a release was published, as written in a language. */
function releaseDate(release: Release, locale: SiteLocale): string {
  return new Intl.DateTimeFormat(LOCALE_INFO[locale].dates, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(release.published_at));
}

/** The not-found page in a language. */
function notFoundHtml(html: string, locale: SiteLocale): string {
  const words = WORDS[locale].notFound;
  return html
    .replace('%LANG%', LOCALE_INFO[locale].lang)
    .replace('%NOT_FOUND_TITLE%', escapeAttribute(words.title))
    .replace('%NOT_FOUND_HEADING%', escapeHtml(words.heading))
    .replace('%NOT_FOUND_TEXT%', escapeHtml(words.text))
    .replace('%NOT_FOUND_LINK%', escapeHtml(words.link))
    .replace('%NOT_FOUND_HOME%', localePath(locale, '/'));
}

/**
 * Writes the release's installer links, version, date and notes link into the home page, with
 * its summary, features, questions and structured data. Lists the pages in sitemap.xml, and
 * writes the site in Markdown for AI assistants: llms.txt, llms-full.txt and index.md.
 */
function releaseInfo(): Plugin {
  let facts: Promise<Facts> | undefined;
  const getFacts = () => (facts ??= releaseFacts());

  return {
    name: 'release-info',
    async transformIndexHtml(html, ctx) {
      const locale = pageLocale(ctx.path);
      const file = ctx.path.split('/').pop();
      if (file === '404.html') return notFoundHtml(html, locale);
      if (
        ctx.path !== '/index.html' &&
        ctx.path !== `/generated${localePath(locale, '/')}index.html`
      )
        return html;
      const { release, installers, page } = await getFacts();
      const home = HOME[locale];
      const path = localePath(locale, '/');
      html = html
        .replace('%ALTERNATES%', alternates('/'))
        .replaceAll('%URL%', `${SITE}${path}`)
        .replace('%MARKDOWN%', `${path}index.md`)
        .replace('<!-- %HOME% -->', () => home.body)
        .replace('%LANG%', LOCALE_INFO[locale].lang)
        .replace('%TITLE%', escapeAttribute(home.title))
        .replace('%DESCRIPTION%', escapeAttribute(home.description))
        .replace('%OG_TITLE%', escapeAttribute(home.ogTitle))
        .replace('%OG_DESCRIPTION%', escapeAttribute(home.ogDescription))
        .replace('%OG_IMAGE_ALT%', escapeAttribute(home.ogImageAlt))
        .replace('%MARKDOWN_TITLE%', escapeAttribute(home.markdownTitle))
        .replaceAll('%MAC_URL%', page.macUrl)
        .replaceAll('%WINDOWS_URL%', page.windowsUrl)
        .replaceAll('%RELEASE_VERSION%', page.version ?? '—')
        .replaceAll('%RELEASE_DATE%', release ? releaseDate(release, locale) : '—')
        .replace('%SUMMARY%', escapeHtml(CONTENT[locale].summary))
        .replace('<!-- %HEADER% -->', header('/', locale))
        .replace('<!-- %FOOTER% -->', footer(locale))
        .replace('<!-- %ANALYTICS% -->', ANALYTICS)
        .replace('<!-- %FEATURES% -->', featuresHtml(locale))
        .replace('<!-- %FAQ% -->', faqHtml(locale));
      return { html, tags: structuredData(release, installers, locale) };
    },
    async generateBundle() {
      const { release, page } = await getFacts();
      const lastmod = release ? `<lastmod>${release.published_at.slice(0, 10)}</lastmod>` : '';
      const urls = PAGES.map((path) => `  <url><loc>${SITE}${path}</loc>${lastmod}</url>`);
      const emit = (fileName: string, source: string) =>
        this.emitFile({ type: 'asset', fileName, source });
      emit(
        'sitemap.xml',
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls,
          '</urlset>',
          '',
        ].join('\n'),
      );
      emit('llms.txt', llmsTxt(page));
      emit('llms-full.txt', llmsFullTxt(page, readFileSync(VOLUNTEER_GUIDE, 'utf8')));
      for (const locale of SITE_LOCALES)
        emit(
          `${localePath(locale, '/').slice(1)}index.md`,
          indexMd({ ...page, date: release ? releaseDate(release, locale) : null }, locale),
        );
    },
  };
}

/**
 * The Markdown pages (src/pages.ts): written as HTML into `generated/` for Vite to build, served
 * at their own addresses in development, moved there in the build, each with its Markdown
 * copy beside it as `index.md`.
 */
function markdownPages(): Plugin {
  let built: BuiltPage[] = [];
  const file = (path: string) => resolve(GENERATED, `.${path}`, 'index.html');
  return {
    name: 'markdown-pages',
    enforce: 'post',
    async config() {
      built = (await Promise.all(SITE_LOCALES.map((locale) => buildPages(REPO, locale)))).flat();
      rmSync(GENERATED, { recursive: true, force: true });
      for (const page of built) {
        mkdirSync(dirname(file(page.path)), { recursive: true });
        writeFileSync(file(page.path), page.html);
      }
      // The other languages' home and not-found pages, from the English ones.
      const frames = SITE_LOCALES.filter((locale) => locale !== 'en').flatMap((locale) =>
        FRAME_PAGES.map((name) => {
          const target = resolve(GENERATED, `.${localePath(locale, '/')}`, name);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, readFileSync(resolve(import.meta.dirname, name), 'utf8'));
          return [`${name.replace('.html', '')}-${locale}`, target] as const;
        }),
      );
      return {
        build: {
          rollupOptions: {
            input: {
              ...Object.fromEntries(
                built.map((page) => [`page-${page.path.replaceAll('/', '')}`, file(page.path)]),
              ),
              ...Object.fromEntries(frames),
            },
          },
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = decodeURI(req.url?.split('?')[0] ?? '');
        const page = built.find((p) => p.path === path || `${p.path}index.md` === path);
        const home = SITE_LOCALES.some(
          (locale) => locale !== 'en' && localePath(locale, '/') === path,
        );
        if (page)
          req.url = path.endsWith('.md') ? `/generated${path}` : `/generated${path}index.html`;
        else if (home) req.url = `/generated${path}index.html`;
        next();
      });
      // The Markdown copies, for the development server.
      for (const page of built)
        writeFileSync(resolve(dirname(file(page.path)), 'index.md'), page.markdown);
    },
    generateBundle(_options, bundle) {
      // Each page moves from generated/ to its own address. Rolldown takes no new entries
      // in `bundle`, so the page is emitted again under its new name.
      for (const [name, output] of Object.entries(bundle)) {
        if (!name.startsWith('generated/') || output.type !== 'asset') continue;
        delete bundle[name];
        this.emitFile({
          type: 'asset',
          fileName: name.slice('generated/'.length),
          source: output.source,
        });
      }
      for (const page of built) {
        this.emitFile({
          type: 'asset',
          fileName: `${page.path.slice(1)}index.md`,
          source: page.markdown,
        });
      }
    },
  };
}

/**
 * Checks that every screenshot the pages show is in `public/screenshots`. They are rendered
 * from the app by `pnpm screenshots apps/website/public/screenshots`, not kept in git.
 */
function screenshots(): Plugin {
  return {
    name: 'screenshots',
    transformIndexHtml(html) {
      const files = [...html.matchAll(/["'(]\/(screenshots\/[^"')\s]+)/g)].map((m) => m[1]!);
      const missing = [...new Set(files)].filter(
        (file) => !existsSync(resolve(import.meta.dirname, 'public', file)),
      );
      if (missing.length === 0) return;
      const message = `Missing ${missing.join(', ')}: run pnpm screenshots apps/website/public/screenshots`;
      if (process.env.CI) throw new Error(message);
      console.warn(`${message}; the page shows broken images.`);
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), releaseInfo(), markdownPages(), screenshots()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        notFound: resolve(import.meta.dirname, '404.html'),
      },
    },
  },
});
