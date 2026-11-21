import { describe, expect, it } from 'vitest';
import * as admin from './admin';
import * as desktop from './desktop';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  format,
  formatDate,
  formatRelativeDay,
  matchLanguage,
  meetingDaysLabel,
  parsePreference,
  resolveLocale,
  setLocale,
  t,
  weekdayName,
} from './desktop';
import * as output from './output';
import * as remote from './remote';

describe('interface text', () => {
  it('fills placeholders', () => {
    expect(format('Copy to {date}', { date: 'Sunday' })).toBe('Copy to Sunday');
    expect(format('{a} and {a}, {missing}', { a: 1 })).toBe('1 and 1, {missing}');
    expect(t('calendar.copyTo', { date: 'Sun' })).toBe('Copy to Sun');
  });

  it('names weekdays from Sunday', () => {
    expect(weekdayName(0)).toBe('Sunday');
    expect(weekdayName(6, 'short')).toBe('Sat');
  });

  it('formats a date without shifting it by the computer timezone', () => {
    expect(formatDate('2026-10-11')).toBe('Sunday 11th Oct');
    expect(formatDate('2026-11-01')).toBe('Sunday 1st Nov');
    expect(formatDate('2026-11-22')).toBe('Sunday 22nd Nov');
    expect(formatDate('2026-10-03')).toBe('Saturday 3rd Oct');
  });

  it('says how far a run sheet is from today', () => {
    const today = '2026-11-21';
    const live = (date: string) => t('present.liveWhen', { when: formatRelativeDay(date, today) });
    expect(live('2026-11-21')).toBe('Live today');
    expect(live('2026-11-22')).toBe('Live tomorrow');
    expect(live('2026-11-23')).toBe('Live in 2 days');
    expect(live('2026-11-27')).toBe('Live in 6 days');
    expect(live('2026-11-20')).toBe('Live yesterday');
    expect(live('2026-11-15')).toBe('Live 6 days ago');
    // Days up to two weeks, not "next week".
    expect(live('2026-12-01')).toBe('Live in 10 days');
    expect(live('2026-12-12')).toBe('Live in 3 weeks');
    expect(live('2026-09-21')).toBe('Live 2 months ago');
    expect(live('2027-11-21')).toBe('Live in 1 year');
    expect(live('2024-11-21')).toBe('Live 2 years ago');
  });
});

describe('meeting-day labels (criterion 19)', () => {
  it('labels none as Any day and all seven as Every day', () => {
    expect(meetingDaysLabel([])).toBe('Any day');
    expect(meetingDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
  });

  it('names the selected days in week order', () => {
    expect(meetingDaysLabel([0])).toBe('Sunday');
    expect(meetingDaysLabel([5, 3])).toBe('Wednesday and Friday');
    expect(meetingDaysLabel([6, 0, 3])).toBe('Sunday, Wednesday, and Saturday');
  });
});

describe('choosing the language (T2)', () => {
  it('follows the first system language Worship Q has', () => {
    expect(resolveLocale('auto', ['fr-FR', 'en-GB'])).toBe('en');
    expect(resolveLocale('auto', [])).toBe('en');
    expect(resolveLocale('en', ['fr'])).toBe('en');
  });

  it('picks the Chinese script by region or script (T2)', () => {
    expect(matchLanguage('zh-CN')).toBe('zh-Hans');
    expect(matchLanguage('zh-SG')).toBe('zh-Hans');
    expect(matchLanguage('zh')).toBe('zh-Hans');
    expect(matchLanguage('zh-TW')).toBe('zh-Hant');
    expect(matchLanguage('zh-HK')).toBe('zh-Hant');
    expect(matchLanguage('zh_MO')).toBe('zh-Hant');
    expect(matchLanguage('zh-Hant-CN')).toBe('zh-Hant');
    expect(matchLanguage('zh-Hans-HK')).toBe('zh-Hans');
    expect(resolveLocale('auto', ['fr', 'zh-TW', 'en'])).toBe('zh-Hant');
    expect(resolveLocale('auto', ['en-GB', 'zh-CN'])).toBe('en');
  });

  it('reads anything unknown back as automatic', () => {
    expect(parsePreference('zh-Hant')).toBe('zh-Hant');
    expect(parsePreference('zh-hans')).toBe('zh-Hans');
    expect(parsePreference('en')).toBe('en');
    expect(parsePreference('xx')).toBe('auto');
    expect(parsePreference(undefined)).toBe('auto');
  });
});

describe('Chinese', () => {
  it('names run sheets with the month and day, then the weekday (T6)', () => {
    setLocale('zh-Hans');
    try {
      expect(formatDate('2026-11-22')).toBe('11月22日星期日');
      expect(t('calendar.copyTo', { date: formatDate('2026-11-01') })).toBe('复制到11月1日星期日');
      expect(meetingDaysLabel([3, 0])).toBe('星期日和星期三');
      const live = (date: string) =>
        t('present.liveWhen', { when: formatRelativeDay(date, '2026-11-21') });
      expect(live('2026-11-27')).toBe('6天后的流程表');
      expect(live('2026-11-23')).toBe('后天的流程表');
      expect(live('2026-11-22')).toBe('明天的流程表');
      expect(live('2026-11-21')).toBe('今天的流程表');
      expect(live('2026-11-20')).toBe('昨天的流程表');
    } finally {
      setLocale('en');
    }
    setLocale('zh-Hant');
    try {
      expect(formatDate('2026-11-22')).toBe('11月22日星期日');
      expect(meetingDaysLabel([])).toBe('不限日期');
    } finally {
      setLocale('en');
    }
  });
});

/** What reads the same in every language: names, codes and examples, and placeholders. */
const SAME_IN_EVERY_LANGUAGE =
  /Worship Q|OBS|PDF|CCLI|MB|API\.Bible|YouVersion|ESV|WebSocket|localhost:\d+|https?:\S+|[\w.-]+@[\w.-]+|[\w-]+\.example\.org|[A-Z]{4}-[A-Z]{4}-[A-Z]{4}|\{\w+\}/g;

describe('every app catalogue (T4)', () => {
  const catalogues = { desktop, remote, admin, output };
  // Which placeholders a message uses; how often is up to each language's sentence.
  const placeholders = (text: string) =>
    [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

  for (const [app, { messages }] of Object.entries(catalogues)) {
    it(`${app}: every language has every key, with the same placeholders`, () => {
      const english = messages.en as Record<string, string>;
      for (const [code, own] of Object.entries(messages) as [string, Record<string, string>][]) {
        if (code === 'en') continue;
        expect(Object.keys(own).sort()).toEqual(Object.keys(english).sort());
        for (const key of Object.keys(english)) {
          expect(placeholders(own[key] ?? ''), `${code} ${key}`).toEqual(
            placeholders(english[key]!),
          );
          // Left in English by mistake: the same words, beyond names and placeholders.
          if (own[key] === english[key])
            expect(
              english[key]!.replace(SAME_IN_EVERY_LANGUAGE, ''),
              `${code} ${key} is still English`,
            ).not.toMatch(/[a-z]{2,}/i);
        }
      }
    });
  }
});

/**
 * Keeping translations current (translation plan §6 question 1): `translated.json` holds each
 * English message as it was when translated. An English message changed or added since then
 * fails here until its translations are updated and the record is brought up to date with
 * `pnpm --filter @worship-q/i18n translated`.
 */
describe('translations are current', () => {
  const record = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'translated.json'), 'utf8'),
  ) as Record<string, Record<string, string>>;
  const catalogues = { desktop, remote, admin, output };

  for (const [app, { messages }] of Object.entries(catalogues)) {
    it(`${app}: no English message changed since it was translated`, () => {
      const english = messages.en as Record<string, string>;
      const stale = Object.keys(english).filter((key) => record[app]?.[key] !== english[key]);
      expect(
        stale,
        'English changed since translated: translate these, then run the translated script',
      ).toEqual([]);
    });
  }
});
