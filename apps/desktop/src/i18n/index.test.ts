import { describe, expect, it } from 'vitest';
import { format, formatDate, meetingDaysLabel, t, weekdayName } from './index';

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
    expect(formatDate('2026-10-11')).toContain('Sun');
    expect(formatDate('2026-10-11')).toContain('11');
    expect(formatDate('2026-10-11', 'long')).toContain('Sunday');
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
