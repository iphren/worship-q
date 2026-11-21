import { nextMeetingDate, type IsoDate } from '@worship-q/calendar';

/** A chip at the top of the live run sheet, and the day it goes live with. */
export interface DateChip {
  kind: 'last' | 'today' | 'next';
  date: IsoDate;
}

/**
 * The chips to offer: the last service when there is one, today, and the next meeting day
 * unless that is today. The last service is any earlier day with items, meeting day or not.
 */
export function dateChips(
  today: IsoDate,
  lastService: IsoDate | null | undefined,
  meetingDays: readonly number[],
): DateChip[] {
  const next = nextMeetingDate(today, meetingDays);
  return [
    ...(lastService && lastService < today ? [{ kind: 'last' as const, date: lastService }] : []),
    { kind: 'today', date: today },
    ...(next !== today ? [{ kind: 'next' as const, date: next }] : []),
  ];
}

/**
 * What a chip does: nothing for the day already live; else go live, asking first while a
 * slide shows (also one from the previous run sheet), as a stray click mid-service would
 * move every device to another run sheet. A blank or cleared screen goes live at once.
 */
export function switchStep(
  date: IsoDate,
  liveDate: IsoDate,
  live: { presented: unknown; blank: boolean } | null,
): 'stay' | 'confirm' | 'goLive' {
  if (date === liveDate) return 'stay';
  return live?.presented && !live.blank ? 'confirm' : 'goLive';
}
