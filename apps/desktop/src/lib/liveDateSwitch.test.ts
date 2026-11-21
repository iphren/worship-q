import { describe, expect, it } from 'vitest';
import { dateChips, switchStep } from './liveDateSwitch';

// Saturday 21 November 2026; the next day is a Sunday.
const SATURDAY = '2026-11-21';
const SUNDAY = '2026-11-22';
const SUNDAYS = [0];

describe('the date chips', () => {
  it('offers the last service, today and the next meeting day on a day without a meeting', () => {
    expect(dateChips(SATURDAY, '2026-11-15', SUNDAYS)).toEqual([
      { kind: 'last', date: '2026-11-15' },
      { kind: 'today', date: SATURDAY },
      { kind: 'next', date: SUNDAY },
    ]);
  });

  it('leaves out the next meeting day when today is one', () => {
    expect(dateChips(SUNDAY, '2026-11-15', SUNDAYS)).toEqual([
      { kind: 'last', date: '2026-11-15' },
      { kind: 'today', date: SUNDAY },
    ]);
  });

  it('leaves out the last service when there is none, or while it is still loading', () => {
    expect(dateChips(SATURDAY, null, SUNDAYS).map((chip) => chip.kind)).toEqual(['today', 'next']);
    expect(dateChips(SATURDAY, undefined, SUNDAYS).map((chip) => chip.kind)).toEqual([
      'today',
      'next',
    ]);
  });

  it('takes the last service as given, also when it was not a meeting day', () => {
    // A Wednesday run sheet with items is the last service.
    expect(dateChips(SATURDAY, '2026-11-18', SUNDAYS)[0]).toEqual({
      kind: 'last',
      date: '2026-11-18',
    });
  });

  it('never offers a last service of today or later', () => {
    expect(dateChips(SATURDAY, SATURDAY, SUNDAYS).map((chip) => chip.kind)).toEqual([
      'today',
      'next',
    ]);
    expect(dateChips(SATURDAY, SUNDAY, SUNDAYS).map((chip) => chip.kind)).toEqual([
      'today',
      'next',
    ]);
  });

  it('offers the last service from long ago, such as the year before', () => {
    expect(dateChips('2027-01-02', '2026-12-27', SUNDAYS)[0]).toEqual({
      kind: 'last',
      date: '2026-12-27',
    });
  });

  it('finds the next meeting day across a month and a year end', () => {
    // Thursday 31 December 2026: the next Sunday is 3 January 2027.
    expect(dateChips('2026-12-31', null, SUNDAYS).at(-1)).toEqual({
      kind: 'next',
      date: '2027-01-03',
    });
  });

  it('picks the nearest of several meeting days', () => {
    // Wednesdays and Sundays, on a Monday: Wednesday comes first.
    expect(dateChips('2026-11-23', null, [0, 3]).at(-1)).toEqual({
      kind: 'next',
      date: '2026-11-25',
    });
  });

  it('offers only today when every day is, or any day may be, a meeting day', () => {
    for (const days of [[], [0, 1, 2, 3, 4, 5, 6]]) {
      expect(dateChips(SATURDAY, null, days)).toEqual([{ kind: 'today', date: SATURDAY }]);
    }
  });
});

describe('choosing a chip', () => {
  const showing = { presented: { itemId: 'i1' }, blank: false };

  it('does nothing for the day already live, whatever is on screen', () => {
    expect(switchStep(SUNDAY, SUNDAY, showing)).toBe('stay');
    expect(switchStep(SUNDAY, SUNDAY, null)).toBe('stay');
  });

  it('asks first while a slide shows', () => {
    expect(switchStep(SATURDAY, SUNDAY, showing)).toBe('confirm');
  });

  it('goes live at once when nothing shows', () => {
    expect(switchStep(SATURDAY, SUNDAY, { presented: null, blank: false })).toBe('goLive');
  });

  it('goes live at once while the screen is blanked', () => {
    expect(switchStep(SATURDAY, SUNDAY, { presented: { itemId: 'i1' }, blank: true })).toBe(
      'goLive',
    );
    expect(switchStep(SATURDAY, SUNDAY, { presented: null, blank: true })).toBe('goLive');
  });

  it('goes live at once without a live state', () => {
    expect(switchStep(SATURDAY, SUNDAY, null)).toBe('goLive');
  });
});
