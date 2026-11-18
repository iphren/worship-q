/**
 * The interface language of every Worship Q app (translation plan T1–T4): the current
 * language, message lookup with `{name}` placeholders, and dates in that language. Each app
 * imports its own entry (`@worship-q/i18n/desktop` and the like), which joins the shared
 * messages with its own.
 */
import { common, type CommonKey } from './en/common';
import { common as commonHans } from './zh-hans/common';
import { common as commonHant } from './zh-hant/common';

/** The interface languages a person can choose, each named in itself. */
export const LOCALES = [
  { code: 'en', nativeName: 'English' },
  { code: 'zh-Hans', nativeName: '简体中文' },
  { code: 'zh-Hant', nativeName: '繁體中文' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
/** What a person chose: a language, or `auto` for the system's or browser's. */
export type LanguagePreference = 'auto' | Locale;

export type Params = Record<string, string | number>;

const isLocale = (code: string): code is Locale => LOCALES.some((locale) => locale.code === code);

/** A language code written in any case, such as `zh-hans` in an address, as Worship Q's own. */
const canonicalLocale = (code: string): Locale | null =>
  LOCALES.find((locale) => locale.code.toLowerCase() === code.toLowerCase())?.code ?? null;

/** A stored preference, read back safely: anything unknown is `auto`. */
export function parsePreference(value: unknown): LanguagePreference {
  return (typeof value === 'string' && canonicalLocale(value)) || 'auto';
}

/**
 * The language to show for a preference: the chosen one, or for `auto` the first of the
 * system's languages Worship Q has (T2), else English.
 */
export function resolveLocale(
  preference: LanguagePreference,
  systemLanguages: readonly string[] = browserLanguages(),
): Locale {
  if (preference !== 'auto') return preference;
  for (const tag of systemLanguages) {
    const match = matchLanguage(tag);
    if (match) return match;
  }
  return 'en';
}

/** Regions whose Chinese is written in Traditional characters (T2). */
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/**
 * The language Worship Q has for a BCP 47 tag, such as `en-GB`, if any. Chinese follows its
 * script when the tag names one (`zh-Hant`), else its region: Taiwan, Hong Kong and Macau
 * read Traditional, and mainland China, Singapore and every other Chinese read Simplified.
 */
export function matchLanguage(tag: string): Locale | null {
  const [language = '', ...rest] = tag.toLowerCase().split(/[-_]/);
  if (language === 'en') return 'en';
  if (language !== 'zh') return null;
  if (rest.includes('hant')) return 'zh-Hant';
  if (rest.includes('hans')) return 'zh-Hans';
  return rest.some((part) => TRADITIONAL_REGIONS.has(part)) ? 'zh-Hant' : 'zh-Hans';
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

// ── The current language ───────────────────────────────────────────────────

let locale: Locale = 'en';
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return locale;
}

/** Changes the interface language and the page's `lang`, and tells whoever listens. */
export function setLocale(next: Locale): void {
  if (!isLocale(next)) return;
  if (typeof document !== 'undefined') document.documentElement.lang = intlLocale(next);
  if (next === locale) return;
  locale = next;
  for (const listener of listeners) listener();
}

/**
 * Applies a preference. A language in the address, such as `?lang=zh-Hans`, wins, for
 * checking a page and for the screenshots.
 */
export function applyPreference(preference: LanguagePreference): Locale {
  const forced =
    typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  const next = (forced ? canonicalLocale(forced) : null) ?? resolveLocale(preference);
  setLocale(next);
  return next;
}

/** Where a browser app keeps its Language choice: per browser, as nothing else is kept. */
const BROWSER_KEY = 'wq.language';

/** The browser app's saved choice; `auto` when there is none or storage is unavailable. */
export function loadBrowserPreference(): LanguagePreference {
  try {
    return parsePreference(localStorage.getItem(BROWSER_KEY));
  } catch {
    return 'auto';
  }
}

/** Saves and applies a browser app's choice. */
export function saveBrowserPreference(preference: LanguagePreference): void {
  try {
    if (preference === 'auto') localStorage.removeItem(BROWSER_KEY);
    else localStorage.setItem(BROWSER_KEY, preference);
  } catch {
    // Storage unavailable: the choice lasts while the page is open.
  }
  applyPreference(preference);
}

/**
 * Starts a browser app in its saved language, following the browser's own language while
 * the choice is Automatic.
 */
export function startBrowserLanguage(): void {
  applyPreference(loadBrowserPreference());
  if (typeof window === 'undefined') return;
  window.addEventListener('languagechange', () => applyPreference(loadBrowserPreference()));
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current language, for names such as the Bible's books. */
export function baseLocale(active: Locale = locale): Locale {
  return active;
}

/** The language `Intl` formats with. */
export function intlLocale(active: Locale = locale): string {
  return active;
}

// ── Messages ───────────────────────────────────────────────────────────────

/** Fills `{name}` placeholders in a message. */
export function format(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Every language's messages for one app: each language has every key English has (T4). */
export type Catalogues<M extends Record<string, string>> = { en: M } & Record<
  Exclude<Locale, 'en'>,
  Record<keyof M, string>
>;

/** Looks up a key in the current language, falling back to English. */
export function translator<M extends Record<string, string>>(catalogues: Catalogues<M>) {
  return (key: keyof M & string, params?: Params): string => {
    const english = catalogues.en[key] as string;
    const own = (catalogues as Partial<Record<Locale, Record<string, string>>>)[locale]?.[key];
    return format(own ?? english, params);
  };
}

/** Whether a count takes a message's singular (`.one`) or its plural (`.other`). */
export function pluralCategory(count: number): 'one' | 'other' {
  return new Intl.PluralRules(intlLocale()).select(count) === 'one' ? 'one' : 'other';
}

/** The keys that have `.one` and `.other` forms, without the ending. */
export type PluralBase<K extends string> = K extends `${infer B}.other` ? B : never;

const commonText = translator<Record<CommonKey, string>>({
  en: common,
  'zh-Hans': commonHans,
  'zh-Hant': commonHant,
});

// ── Dates ──────────────────────────────────────────────────────────────────

const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);

const ORDINAL_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });

/** A run sheet's name, such as "Sunday 1st Nov", or `11月22日星期日` in Chinese (T6). */
export function formatDate(date: string): string {
  const name = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intlLocale(), { timeZone: 'UTC', ...options }).format(utcDate(date));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (intlLocale() === 'en') {
    return `${name({ weekday: 'long' })} ${day}${ORDINAL_SUFFIX[ordinalRules.select(day)]} ${name({ month: 'short' })}`;
  }
  if (intlLocale().startsWith('zh')) return `${month}月${day}日${name({ weekday: 'long' })}`;
  return name({ weekday: 'long', month: 'short', day: 'numeric' });
}

/** A run sheet's name with its year, for the window's title: "Sunday 1st Nov 2026", `2026年11月1日星期日`. */
export function formatDateWithYear(date: string): string {
  const year = date.slice(0, 4);
  return intlLocale().startsWith('zh')
    ? `${year}年${formatDate(date)}`
    : `${formatDate(date)} ${year}`;
}

export function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Name of a weekday, 0 = Sunday. */
export function weekdayName(day: number, style: 'short' | 'long' = 'long'): string {
  // 4 January 1970 was a Sunday.
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: 'UTC', weekday: style }).format(
    new Date(Date.UTC(1970, 0, 4 + day)),
  );
}

/** "Any day", "Every day", or the selected day names. */
export function meetingDaysLabel(days: readonly number[]): string {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length === 0) return commonText('calendar.anyDay');
  if (unique.length === 7) return commonText('calendar.everyDay');
  return listFormat(unique.map((d) => weekdayName(d)));
}

/** Items joined as in a sentence: "a, b and c" in English. */
export function listFormat(
  items: readonly string[],
  type: 'conjunction' | 'disjunction' = 'conjunction',
): string {
  return new Intl.ListFormat(intlLocale(), { type }).format(items);
}

/** A number in the current language, with the given options. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(), options).format(value);
}

/** The languages a Language setting offers. */
export function languageChoices(): { value: LanguagePreference; label: string }[] {
  return [
    { value: 'auto', label: commonText('language.auto') },
    ...LOCALES.map((l) => ({ value: l.code as Locale, label: l.nativeName as string })),
  ];
}

export { common };
