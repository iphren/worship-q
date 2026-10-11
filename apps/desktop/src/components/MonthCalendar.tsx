import { monthGrid, shiftMonth, weekdayOf, yearMonthOf } from '@worship-q/calendar';
import type { IsoDate } from '@worship-q/protocol';
import { formatMonth, t, weekdayName } from '../i18n';

export function MonthCalendar(props: {
  year: number;
  month: number;
  onMonthChange(year: number, month: number): void;
  selected: IsoDate;
  onSelect(date: IsoDate): void;
  today: IsoDate;
  liveDate: IsoDate | null;
  openDate: IsoDate;
  planned: ReadonlySet<IsoDate>;
  meetingDays: readonly number[];
}) {
  const { year, month } = props;
  const weeks = monthGrid(year, month);
  const shift = (by: number) => {
    const next = shiftMonth(year, month, by);
    props.onMonthChange(next.year, next.month);
  };
  const goToday = () => {
    const now = yearMonthOf(props.today);
    props.onMonthChange(now.year, now.month);
    props.onSelect(props.today);
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <span className="flex-1 text-sm font-semibold">{formatMonth(year, month)}</span>
        <button className="btn btn-ghost btn-sm" onClick={goToday}>
          {t('common.today')}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => shift(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
          <div key={day} className="py-1 text-slate-500">
            {weekdayName(day, 'short')}
          </div>
        ))}
        {weeks.flat().map((date) => {
          const inMonth = yearMonthOf(date).month === month;
          const isSelected = date === props.selected;
          const isLive = date === props.liveDate;
          const isOpen = date === props.openDate;
          const isMeeting = props.meetingDays.includes(weekdayOf(date));
          return (
            <button
              key={date}
              onClick={() => props.onSelect(date)}
              className={[
                'relative flex h-10 flex-col items-center justify-center rounded-md border text-sm',
                isSelected
                  ? 'border-sky-400 bg-sky-900/50'
                  : 'border-transparent hover:bg-slate-700',
                inMonth ? '' : 'opacity-35',
                isMeeting && !isSelected ? 'bg-slate-700/40' : '',
                date === props.today ? 'font-bold text-sky-300' : '',
              ].join(' ')}
            >
              {/* A date with nothing planned is fainter than one with a run sheet. */}
              <span className={props.planned.has(date) ? '' : 'opacity-10'}>
                {Number(date.slice(8))}
              </span>
              <span className="flex h-1.5 gap-0.5">
                {isLive && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                    title={t('calendar.live')}
                  />
                )}
                {isOpen && !isLive && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-yellow-400"
                    title={t('calendar.editing')}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
