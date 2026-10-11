/**
 * Calendar rules: workspace-timezone dates and meeting days.
 *
 * Dates are `YYYY-MM-DD` strings. Weekdays are 0 = Sunday … 6 = Saturday.
 */

export type IsoDate = string;

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(date: IsoDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The calendar date at `instant` in the given IANA timezone, wherever the computer is. */
export function dateInTimeZone(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function weekdayOf(date: IsoDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** Sorted, de-duplicated weekdays. */
export function normalizeMeetingDays(days: readonly number[]): number[] {
  return [...new Set(days)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
}

export type MeetingDayKind = 'any' | 'every' | 'some';

/** "Any day" (none selected) and "Every day" (all selected) behave alike but are labelled apart. */
export function meetingDayKind(days: readonly number[]): MeetingDayKind {
  const count = normalizeMeetingDays(days).length;
  if (count === 0) return 'any';
  if (count === 7) return 'every';
  return 'some';
}

/** The first meeting day on or after `from`. With no days selected, every day qualifies. */
export function nextMeetingDate(from: IsoDate, meetingDays: readonly number[]): IsoDate {
  const days = normalizeMeetingDays(meetingDays);
  if (days.length === 0) return from;
  for (let offset = 0; offset < 7; offset++) {
    const candidate = addDays(from, offset);
    if (days.includes(weekdayOf(candidate))) return candidate;
  }
  return from;
}

/** The date the calendar opens on: the next meeting day including today. */
export function defaultCalendarDate(
  now: Date,
  timeZone: string,
  meetingDays: readonly number[],
): IsoDate {
  return nextMeetingDate(dateInTimeZone(now, timeZone), meetingDays);
}

/**
 * Where to go after a presentation ends: the next meeting day after the ended date, and
 * never in the past. A presentation ended before its date came (on `endedOn`) skips
 * nothing: that meeting is still to come, so today stays the default when it is a meeting day.
 */
export function nextMeetingDateAfter(
  endedDate: IsoDate,
  endedOn: IsoDate,
  today: IsoDate,
  meetingDays: readonly number[],
): IsoDate {
  if (endedOn < endedDate) return nextMeetingDate(today, meetingDays);
  const dayAfter = addDays(endedDate, 1);
  return nextMeetingDate(dayAfter > today ? dayAfter : today, meetingDays);
}

/** Six weeks of dates covering the given month, each week starting on `weekStart`. */
export function monthGrid(year: number, month: number, weekStart = 0): IsoDate[][] {
  const first = fromUtc(Date.UTC(year, month - 1, 1));
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
  );
}

export function yearMonthOf(date: IsoDate): { year: number; month: number } {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return { year, month };
}

export function shiftMonth(
  year: number,
  month: number,
  by: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
