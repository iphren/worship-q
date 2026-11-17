import { describe, expect, it } from 'vitest';
import * as admin from './admin';
import * as desktop from './desktop';
import {
  format,
  formatDate,
  meetingDaysLabel,
  parsePreference,
  PSEUDO,
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

  it('reads anything unknown back as automatic', () => {
    expect(parsePreference('en')).toBe('en');
    expect(parsePreference('xx')).toBe('auto');
    expect(parsePreference(undefined)).toBe('auto');
  });

  it('wraps every message in the test language, keeping placeholders', () => {
    setLocale(PSEUDO);
    try {
      expect(t('calendar.copyTo', { date: 'Sun' })).toBe('⟦Copy to Sun⟧');
      expect(formatDate('2026-11-01')).toBe('Sunday 1st Nov');
    } finally {
      setLocale('en');
    }
  });
});

describe('every app catalogue (T4)', () => {
  const catalogues = { desktop, remote, admin, output };
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

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
        }
      }
    });
  }
});
