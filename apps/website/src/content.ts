// What worship-q.com says about Worship Q, kept here once: the build writes it into the home
// page, its structured data, llms.txt, llms-full.txt and index.md. Plain text only, in
// English (a Chinese site comes later); keep every sentence true for the latest release.
// `CONTENT` holds it per language; llms.txt and index.md stay English.

/** One sentence that says what Worship Q is; the page opens with it and others quote it. */
export const SUMMARY =
  'Worship Q is a free, open-source church presentation app for macOS and Windows that shows song lyrics, Bible passages, slides and videos on the projector and the live stream.';

import type { SiteLocale } from './locales.ts';

export interface Feature {
  title: string;
  text: string;
  /** The feature's own page on the site, when it has one. */
  page?: string;
}

export const FEATURES: Feature[] = [
  {
    title: 'Songs in any language',
    page: '/multilingual-lyrics/',
    text: 'Search by title or lyrics, and Chinese songs by pinyin or initials. A line and its translations share a slide, in two languages or more.',
  },
  {
    title: 'Bible passages',
    page: '/bible/',
    text: "With your church's server: type a reference such as Mark 15:5-6, or browse by book and chapter, and show up to two versions side by side.",
  },
  {
    title: 'A run sheet for every meeting',
    text: "Plan on a calendar, reuse an earlier week, and open on today's service, already live.",
  },
  {
    title: 'Slides, PDFs, photos and videos',
    text: "With your church's server, PowerPoint, Keynote and PDF decks become slides beside the songs. Videos download ahead of time and never stream during the service.",
  },
  {
    title: 'Projector and live stream together',
    page: '/obs/',
    text: 'A full-screen slideshow with image or video backgrounds, and a subtitle overlay for OBS. Switch OBS scenes and start the stream from Worship Q.',
  },
  {
    title: 'Control from a phone',
    page: '/phone-remote/',
    text: 'Scan a QR code, approve the phone once, and move through the slides or add a Bible passage from anywhere in the room.',
  },
  {
    title: 'Several computers, one presentation',
    page: '/several-computers/',
    text: 'Every connected computer shows the same slide. If the presenting one fails, another carries on from the same slide.',
  },
  {
    title: 'Live audio',
    text: 'Send the sound from the mixing desk to other computers and phones, so someone outside the room can switch slides in time.',
  },
  {
    title: 'Works on its own',
    text: "No account or internet needed. Connect to your church's own server for shared songs, media, Bible passages and phones.",
  },
  {
    title: 'Free and open source',
    text: 'MIT licence, no ads, no subscription. Installed copies update themselves, never while the slideshow is open.',
  },
];

/** Requirements, as the download buttons state them. */
export const PLATFORMS = {
  mac: 'macOS 11 or later, Apple Silicon and Intel',
  windows: 'Windows 10 or later, 64-bit',
};

/** What the app does, as a list for search engines' structured data. */
export const FEATURE_LIST = [
  'Song lyrics in any language, bilingual or multilingual on one slide',
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
];

/** The home page's summary, features and feature list, in each of the site's languages. */
export const CONTENT: Record<
  SiteLocale,
  { summary: string; features: Feature[]; featureList: string[] }
> = {
  en: { summary: SUMMARY, features: FEATURES, featureList: FEATURE_LIST },
};
