// The words of the site's frame in each of its languages: the header, the footer and the
// not-found page. The pages' own text is in home.ts, content.ts, faq.ts and the Markdown pages.

import type { SiteLocale } from './locales.ts';
import { words as hans } from './zh-hans.ts';
import { words as hant } from './zh-hant.ts';

export interface Words {
  /** The header's links, by path. */
  nav: { guide: string; compare: string; releases: string };
  /** The header navigation's accessible name. */
  navLabel: string;
  /** The accessible name of the links to the page in the site's other languages. */
  language: string;
  footer: {
    features: string;
    help: string;
    project: string;
    guide: string;
    server: string;
    compare: string;
    releases: string;
    source: string;
    licence: string;
    llms: string;
    privacy: string;
  };
  /** The feature pages' names, by path. */
  featurePages: Record<string, string>;
  /** The link from a feature on the home page to its own page. */
  more: string;
  notFound: { title: string; heading: string; text: string; link: string };
  /** The home page's Markdown copy, index.md. */
  markdown: {
    download: string;
    whatItDoes: string;
    questions: string;
    more: string;
    screenshots: string;
    macDownload: string;
    windowsDownload: string;
    /** The release, with `{version}` and `{date}`. */
    version: string;
    notes: string;
    updates: string;
    windowsWarning: string;
    compare: string;
    source: string;
  };
}

export const WORDS: Record<SiteLocale, Words> = {
  en: {
    nav: { guide: 'Guide', compare: 'Compare', releases: 'Releases' },
    navLabel: 'Site',
    language: 'Language',
    footer: {
      features: 'Features',
      help: 'Help',
      project: 'Project',
      guide: 'Volunteer guide',
      server: 'Church server setup',
      compare: 'Compare',
      releases: 'Release notes',
      source: 'Source code',
      licence: 'MIT licence',
      llms: 'For AI assistants',
      privacy: 'Privacy',
    },
    featurePages: {
      '/bible/': 'Bible passages',
      '/multilingual-lyrics/': 'Lyrics in several languages',
      '/obs/': 'OBS and live streams',
      '/phone-remote/': 'Phone remote',
      '/several-computers/': 'Several computers',
    },
    more: 'More',
    notFound: {
      title: 'Page not found — Worship Q',
      heading: 'This page is not here',
      text: "The address may have changed. Worship Q's downloads, features and questions are on the home page.",
      link: 'Go to worship-q.com',
    },
    markdown: {
      download: 'Download',
      whatItDoes: 'What it does',
      questions: 'Questions',
      more: 'More',
      screenshots: 'Screenshots',
      macDownload: 'Download for Mac',
      windowsDownload: 'Download for Windows',
      version: 'Version {version}, released {date}.',
      notes: 'Release notes',
      updates: 'Installed copies update themselves, never while the slideshow is open.',
      windowsWarning:
        'The Mac app is signed and notarized. The Windows app is not yet signed with Microsoft, so the first time it opens Windows may show "Windows protected your PC": choose More info, then Run anyway.',
      compare: 'Compared with other church presentation software',
      source: 'Source code',
    },
  },
  'zh-hans': hans,
  'zh-hant': hant,
};
