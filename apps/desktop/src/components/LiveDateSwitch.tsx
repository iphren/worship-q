import { nextMeetingDate, weekdayOf, type IsoDate } from '@worship-q/calendar';
import { formatDate, formatRelativeDay, t, weekdayName } from '@worship-q/i18n/desktop';
import { useEffect, useState } from 'react';
import { useQuery, useSession } from '../app/context';

/** How long a chip waits for its second click while something is on screen. */
const ARMED_MS = 3000;

/**
 * The top of the live run sheet: how far its day is from today, such as "Live tomorrow",
 * which moves on by itself at midnight, and chips that go live with the last service, today
 * or the next meeting day. Going live with another day clears the screen, so while a slide
 * shows, a chip asks for a second click. A viewer sees the title only.
 */
export function LiveDateSwitch(props: { liveDate: IsoDate; viewOnly?: boolean }) {
  const { liveDate, viewOnly = false } = props;
  const session = useSession();
  const today = session.today();
  const last = useQuery(() => session.lastServiceDate(), [today]);
  const next = nextMeetingDate(today, session.workspace.meetingDays);
  const onScreen = !!session.live?.presented && !session.live.blank;
  const [armed, setArmed] = useState<IsoDate | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), ARMED_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  useEffect(() => setArmed(null), [liveDate]);

  const chips: { date: IsoDate; label: string }[] = [
    ...(last ? [{ date: last, label: t('present.lastService') }] : []),
    { date: today, label: t('common.today') },
    // Hidden when today is a meeting day: the next one is today.
    ...(next !== today ? [{ date: next, label: weekdayName(weekdayOf(next)) }] : []),
  ];

  function choose(date: IsoDate) {
    if (date === liveDate) return;
    if (onScreen && armed !== date) {
      setArmed(date);
      return;
    }
    setArmed(null);
    void session.goLive(date);
  }

  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="shrink-0 text-sm font-semibold text-slate-100">
          {t('present.liveWhen', { when: formatRelativeDay(liveDate, today) })}
        </h2>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-400">
          {formatDate(liveDate)}
        </span>
      </div>
      {!viewOnly && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          {chips.map(({ date, label }) => {
            const selected = date === liveDate;
            const waiting = armed === date;
            return (
              <button
                key={date}
                type="button"
                aria-pressed={selected}
                title={formatDate(date)}
                className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${
                  selected
                    ? 'bg-emerald-700 text-emerald-50 ring-emerald-400/60'
                    : waiting
                      ? 'bg-slate-700 text-slate-100 ring-slate-300'
                      : 'bg-slate-800 text-slate-300 ring-slate-700 hover:bg-slate-700'
                }`}
                onClick={() => choose(date)}
              >
                {label}
              </button>
            );
          })}
          {armed && (
            <span className="text-xs text-slate-400" role="status">
              {t('present.switchAgain')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
