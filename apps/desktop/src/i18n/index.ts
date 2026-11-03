import { en, type MessageKey } from './en';

export type { MessageKey };
export type Messages = Record<MessageKey, string>;

const LOCALES: Record<string, Messages> = { en };
let locale = 'en';

export function setLocale(next: string): void {
  if (LOCALES[next]) locale = next;
}

export function getLocale(): string {
  return locale;
}

/** Fills `{name}` placeholders in a message. */
export function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** The interface text for a key in the current language. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return format((LOCALES[locale] ?? en)[key] ?? en[key], params);
}

const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);

const ORDINAL_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });

/** A run sheet's name, such as "Sunday 1st Nov". */
export function formatDate(date: string): string {
  const day = Number(date.slice(8, 10));
  const name = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(utcDate(date));
  return `${name({ weekday: 'long' })} ${day}${ORDINAL_SUFFIX[ordinalRules.select(day)]} ${name({ month: 'short' })}`;
}

export function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Name of a weekday, 0 = Sunday. */
export function weekdayName(day: number, style: 'short' | 'long' = 'long'): string {
  // 4 January 1970 was a Sunday.
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: style }).format(
    new Date(Date.UTC(1970, 0, 4 + day)),
  );
}

/** "Any day", "Every day", or the selected day names. */
export function meetingDaysLabel(days: readonly number[]): string {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length === 0) return t('calendar.anyDay');
  if (unique.length === 7) return t('calendar.everyDay');
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    unique.map((d) => weekdayName(d)),
  );
}
