// The languages of worship-q.com (translation plan T9). English is at the site's root; each
// other language has the same pages under a path of its own: /zh-hans/ and /zh-hant/.

export const SITE_LOCALES = ['en', 'zh-hans', 'zh-hant'] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

interface LocaleInfo {
  /** The pages' path prefix, before their own path: '' for English. */
  prefix: string;
  /** The `lang` of the pages, and their `hreflang`. */
  lang: string;
  /** How release dates are written, for `Intl.DateTimeFormat`. */
  dates: string;
  /** The language's name in itself, for the language links. */
  name: string;
}

export const LOCALE_INFO: Record<SiteLocale, LocaleInfo> = {
  en: { prefix: '', lang: 'en', dates: 'en-GB', name: 'English' },
  'zh-hans': { prefix: '/zh-hans', lang: 'zh-Hans', dates: 'zh-Hans', name: '简体中文' },
  'zh-hant': { prefix: '/zh-hant', lang: 'zh-Hant', dates: 'zh-Hant', name: '繁體中文' },
};

/** Pages in English only, which every language links to as they are: the release notes. */
const ENGLISH_ONLY = new Set(['/releases/']);

/** A page's address in a language: `/guide/` in English, `/zh-hans/guide/` in Simplified. */
export function localePath(locale: SiteLocale, path: string): string {
  const [page = '', anchor] = path.split('#');
  if (ENGLISH_ONLY.has(page)) return path;
  return `${LOCALE_INFO[locale].prefix}${page}${anchor === undefined ? '' : `#${anchor}`}`;
}

/** Whether a page exists in every language, so it has alternates to link to. */
export function isTranslated(path: string): boolean {
  return !ENGLISH_ONLY.has(path);
}
