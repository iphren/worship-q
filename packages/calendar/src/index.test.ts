import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateInTimeZone,
  defaultCalendarDate,
  meetingDayKind,
  monthGrid,
  nextMeetingDate,
  normalizeMeetingDays,
  shiftMonth,
  weekdayOf,
} from './index';

// 2026-10-10 is a Saturday, 2026-10-11 a Sunday.
const SATURDAY = '2026-10-10';
const SUNDAY = '2026-10-11';

describe('dates', () => {
  it('knows the weekday of a date', () => {
    expect(weekdayOf(SATURDAY)).toBe(6);
    expect(weekdayOf(SUNDAY)).toBe(0);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('uses the workspace timezone, not the computer one', () => {
    const instant = new Date('2026-10-10T23:30:00Z');
    expect(dateInTimeZone(instant, 'UTC')).toBe('2026-10-10');
    expect(dateInTimeZone(instant, 'Europe/London')).toBe('2026-10-11');
    expect(dateInTimeZone(instant, 'Asia/Shanghai')).toBe('2026-10-11');
    expect(dateInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-10-10');
  });
});

describe('meeting days', () => {
  it('labels none as Any day and all seven as Every day', () => {
    expect(meetingDayKind([])).toBe('any');
    expect(meetingDayKind([0, 1, 2, 3, 4, 5, 6])).toBe('every');
    expect(meetingDayKind([0])).toBe('some');
    expect(meetingDayKind([0, 3])).toBe('some');
  });

  it('normalizes the selection', () => {
    expect(normalizeMeetingDays([3, 0, 3, 9, -1])).toEqual([0, 3]);
  });

  it('opens today for Any day and Every day', () => {
    expect(nextMeetingDate(SATURDAY, [])).toBe(SATURDAY);
    expect(nextMeetingDate(SATURDAY, [0, 1, 2, 3, 4, 5, 6])).toBe(SATURDAY);
  });

  it('opens next Sunday by default, or today when today is Sunday', () => {
    expect(nextMeetingDate(SATURDAY, [0])).toBe(SUNDAY);
    expect(nextMeetingDate(SUNDAY, [0])).toBe(SUNDAY);
    expect(nextMeetingDate('2026-10-12', [0])).toBe('2026-10-18');
  });

  it('opens the next matching day of a subset, including today', () => {
    expect(nextMeetingDate(SATURDAY, [3, 5])).toBe('2026-10-14');
    expect(nextMeetingDate('2026-10-14', [3, 5])).toBe('2026-10-14');
    expect(nextMeetingDate('2026-10-15', [3, 5])).toBe('2026-10-16');
  });

  it('computes the default date in the workspace timezone', () => {
    // Saturday evening in UTC is already Sunday in Shanghai.
    const instant = new Date('2026-10-10T20:00:00Z');
    expect(defaultCalendarDate(instant, 'Asia/Shanghai', [0])).toBe(SUNDAY);
    expect(defaultCalendarDate(instant, 'America/New_York', [6])).toBe(SATURDAY);
    expect(defaultCalendarDate(instant, 'America/New_York', [0])).toBe(SUNDAY);
  });
});

describe('monthGrid', () => {
  it('covers the month in six Sunday-first weeks', () => {
    const grid = monthGrid(2026, 10);
    expect(grid).toHaveLength(6);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[0]![0]).toBe('2026-09-27');
    expect(grid.flat()).toContain('2026-10-01');
    expect(grid.flat()).toContain('2026-10-31');
    expect(grid.every((week) => weekdayOf(week[0]!) === 0)).toBe(true);
  });

  it('shifts months across years', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});
