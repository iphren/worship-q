/**
 * A workspace's run sheets, view only: the month calendar of the desktop's Calendar tab, and
 * the chosen date's run sheet beside it. Nothing here changes a run sheet.
 */
import {
  monthGrid,
  nextMeetingDate,
  shiftMonth,
  weekdayOf,
  yearMonthOf,
} from '@worship-q/calendar';
import type { IsoDate } from '@worship-q/protocol';
import { ItemBadgeMark } from '@worship-q/ui';
import { useState } from 'react';
import { api } from '../api';
import { formatDate } from '../format';
import { Badge, Card, ErrorText, SectionTitle, Spinner } from '../ui';
import { useLoad } from '../useLoad';

const POLL_MS = 20_000;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** The browser's own date; the admin pages know no workspace time zone. */
function todayHere(): IsoDate {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

const weekday = (day: number) =>
  new Date(2024, 0, 7 + day).toLocaleDateString('en', { weekday: 'short' });
const monthTitle = (year: number, month: number) =>
  new Date(year, month - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' });

export function RunSheetsSection({ id }: { id: string }) {
  const days = useLoad(() => api.runSheetDays(id), [id], POLL_MS);
  const today = todayHere();
  const [picked, setPicked] = useState<IsoDate | null>(null);
  const [browsing, setBrowsing] = useState<{ year: number; month: number } | null>(null);
  const meetingDays = days.data?.meetingDays ?? [0];
  // Opens on the next meeting day, as the desktop does.
  const selected = picked ?? nextMeetingDate(today, meetingDays);
  const { year, month } = browsing ?? yearMonthOf(selected);
  const sheet = useLoad(() => api.runSheet(id, selected), [id, selected], POLL_MS);
  const planned = new Map((days.data?.dates ?? []).map((d) => [d.date, d.items]));
  const liveDate = days.data?.liveDate ?? null;
  const weeks = monthGrid(year, month);
  const shift = (by: number) => setBrowsing(shiftMonth(year, month, by));

  return (
    <Card>
      <SectionTitle>Run sheets</SectionTitle>
      <ErrorText error={days.error ?? sheet.error} className="mb-2" />
      {!days.data && !days.error && (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> Loading…
        </p>
      )}
      {days.data && (
        <div className="flex flex-col gap-5 md:flex-row">
          <div className="w-full shrink-0 md:w-72">
            <div className="mb-2 flex items-center gap-1">
              <span className="flex-1 text-sm font-semibold text-slate-100">
                {monthTitle(year, month)}
              </span>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                onClick={() => {
                  setPicked(today);
                  setBrowsing(null);
                }}
              >
                Today
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-slate-300 hover:bg-slate-800"
                aria-label="Previous month"
                onClick={() => shift(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-slate-300 hover:bg-slate-800"
                aria-label="Next month"
                onClick={() => shift(1)}
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {WEEKDAYS.map((day) => (
                <div key={day} className="py-1 text-slate-500">
                  {weekday(day)}
                </div>
              ))}
              {weeks.flat().map((date) => {
                const inMonth = yearMonthOf(date).month === month;
                const isSelected = date === selected;
                const isMeeting = meetingDays.includes(weekdayOf(date));
                return (
                  <button
                    key={date}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={formatDate(date)}
                    onClick={() => setPicked(date)}
                    className={[
                      'relative flex h-10 flex-col items-center justify-center rounded-md border text-sm',
                      isSelected
                        ? 'border-sky-400 bg-sky-900/50'
                        : 'border-transparent hover:bg-slate-800',
                      inMonth ? '' : 'opacity-35',
                      isMeeting && !isSelected ? 'bg-slate-800/60' : '',
                      date === today ? 'font-bold text-sky-300' : 'text-slate-200',
                    ].join(' ')}
                  >
                    {/* A date with nothing planned is fainter than one with a run sheet. */}
                    <span className={planned.has(date) ? '' : 'opacity-20'}>
                      {Number(date.slice(8))}
                    </span>
                    <span className="flex h-1.5">
                      {date === liveDate && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                          title="Live now"
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-100">{formatDate(selected)}</h3>
              {selected === liveDate && <Badge tone="live">Live now</Badge>}
            </div>
            {!sheet.data && !sheet.error && (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <Spinner /> Loading…
              </p>
            )}
            {sheet.data && sheet.data.date === selected && sheet.data.items.length === 0 && (
              <p className="text-sm text-slate-400">Nothing is planned for this date.</p>
            )}
            {sheet.data && sheet.data.date === selected && sheet.data.items.length > 0 && (
              <ol className="space-y-1">
                {sheet.data.items.map((item, index) => {
                  const badge = item.badge;
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-900 px-3 py-2 text-sm"
                    >
                      <span className="w-5 shrink-0 text-right text-slate-500 tabular-nums">
                        {index + 1}
                      </span>
                      <span className="flex min-w-40 flex-1 items-center gap-2">
                        {badge && <ItemBadgeMark badge={badge} />}
                        <span className="min-w-0 truncate">{item.title || 'Untitled'}</span>
                      </span>
                      {item.removed && <Badge tone="warn">Removed from library</Badge>}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
