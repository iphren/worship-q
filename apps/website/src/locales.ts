// The languages of worship-q.com (translation plan T9). English is at the site's root; each
// other language gets the same pages under a path of its own, such as /zh-hans/, in phase 2.
// Until then the list has English alone, so the build writes English pages only.

export const SITE_LOCALES = ['en'] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

interface LocaleInfo {
  /** The pages' path prefix, before their own path: '' for English. */
  prefix: string;
  /** The `lang` of the pages. */
  lang: string;
  /** How release dates are written, for `Intl.DateTimeFormat`. */
  dates: string;
}

export const LOCALE_INFO: Record<SiteLocale, LocaleInfo> = {
  en: { prefix: '', lang: 'en', dates: 'en-GB' },
};

/** A page's address in a language: `/guide/` in English. */
export function localePath(locale: SiteLocale, path: string): string {
  return `${LOCALE_INFO[locale].prefix}${path}`;
}
