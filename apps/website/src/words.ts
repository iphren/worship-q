// The words of the site's frame in each of its languages: the header, the footer and the
// not-found page. The pages' own text is in home.ts, content.ts, faq.ts and the Markdown pages.

import type { SiteLocale } from './locales.ts';

export interface Words {
  /** The header's links, by path. */
  nav: { guide: string; compare: string; releases: string };
  /** The header navigation's accessible name. */
  navLabel: string;
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
  };
  /** The feature pages' names, by path. */
  featurePages: Record<string, string>;
  /** The link from a feature on the home page to its own page. */
  more: string;
  notFound: { title: string; heading: string; text: string; link: string };
}

export const WORDS: Record<SiteLocale, Words> = {
  en: {
    nav: { guide: 'Guide', compare: 'Compare', releases: 'Releases' },
    navLabel: 'Site',
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
  },
};
