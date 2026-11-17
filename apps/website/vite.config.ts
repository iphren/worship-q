import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import { FAQ } from './src/faq.ts';

// The public site at worship-q.com, built again whenever a release is published.
const SITE = 'https://worship-q.com';
const REPO = 'iphren/worship-q';
const RELEASES = `https://github.com/${REPO}/releases`;

/** The pages listed in the sitemap, by path. */
const PAGES = ['/'];

/** The installer each download button serves, by the end of its file name. */
const INSTALLERS = {
  '%MAC_URL%': '_universal.dmg',
  '%WINDOWS_URL%': '_x64-setup.exe',
};

/** One sentence that says what Worship Q is, for the structured data and anything quoting it. */
const SUMMARY =
  'Worship Q is a free, open-source church presentation app for macOS and Windows that shows song lyrics, Bible passages, slides and videos on the projector and the live stream.';

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

/** The questions as they appear on the page. */
function faqHtml(): string {
  return FAQ.map(
    ({ question, answer }) =>
      `<details class="faq"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`,
  ).join('\n');
}

/** What search engines read about the app, the site and the questions. */
function structuredData(release: Release | null, installers: string[]): HtmlTagDescriptor[] {
  const app = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Worship Q',
    alternateName: 'WorshipQ',
    description: SUMMARY,
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
      releaseNotes: release.html_url,
    }),
    featureList: [
      'Song lyrics in any language, two languages on one slide',
      'Search songs by title, lyrics, pinyin or initials',
      'Bible passages in up to two versions side by side',
      'Run sheets planned on a calendar',
      'PowerPoint, Keynote, PDF, photo and video slides',
      'Image or video backgrounds',
      'Subtitle overlay for OBS and control of OBS scenes, streaming and recording',
      'Control from a phone',
      'Several computers sharing one presentation, with failover',
      'Live audio from the mixing desk to other computers and phones',
      'Works offline with no account',
    ],
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
    mainEntity: FAQ.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
  return [app, organization, website, faq].map(jsonLd);
}

/**
 * Writes the release's installer links, version, date and notes link into the home page, with
 * its questions and structured data, and lists the pages in sitemap.xml.
 */
function releaseInfo(): Plugin {
  let release: Promise<Release | null> | undefined;
  const getRelease = () => (release ??= latestRelease().catch(() => null));

  return {
    name: 'release-info',
    async transformIndexHtml(html, ctx) {
      if (ctx.path !== '/index.html') return html;
      const latest = await getRelease();
      // A deployed page must link to real installers and name their version.
      const missing = (what: string) => {
        if (process.env.CI) throw new Error(`${what} for ${REPO}`);
        console.warn(`${what}; the page shows placeholders.`);
      };
      if (!latest) missing('No published release found');

      const installers: string[] = [];
      for (const [placeholder, suffix] of Object.entries(INSTALLERS)) {
        const asset = latest?.assets.find((a) => a.name.endsWith(suffix));
        if (latest && !asset) missing(`${latest.tag_name} has no *${suffix}`);
        if (asset) installers.push(asset.browser_download_url);
        html = html.replaceAll(placeholder, asset?.browser_download_url ?? RELEASES);
      }

      const date = latest
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
            new Date(latest.published_at),
          )
        : '—';
      html = html
        .replaceAll('%RELEASE_VERSION%', latest?.tag_name.replace(/^v/, '') ?? '—')
        .replaceAll('%RELEASE_DATE%', date)
        .replaceAll('%RELEASE_URL%', latest?.html_url ?? RELEASES)
        .replace('<!-- %FAQ% -->', faqHtml());
      return { html, tags: structuredData(latest, installers) };
    },
    async generateBundle() {
      const latest = await getRelease();
      const lastmod = latest ? `<lastmod>${latest.published_at.slice(0, 10)}</lastmod>` : '';
      const urls = PAGES.map((path) => `  <url><loc>${SITE}${path}</loc>${lastmod}</url>`);
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls,
          '</urlset>',
          '',
        ].join('\n'),
      });
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
  plugins: [tailwindcss(), releaseInfo(), screenshots()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        notFound: resolve(import.meta.dirname, '404.html'),
      },
    },
  },
});
