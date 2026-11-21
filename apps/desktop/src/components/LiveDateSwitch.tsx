import { weekdayOf, type IsoDate } from '@worship-q/calendar';
import { formatDate, formatRelativeDay, t, weekdayName } from '@worship-q/i18n/desktop';
import { useEffect, useState } from 'react';
import { useQuery, useSession } from '../app/context';
import { dateChips, switchStep, type DateChip } from '../lib/liveDateSwitch';
import { ConfirmDialog } from './Dialog';

function chipLabel(chip: DateChip): string {
  if (chip.kind === 'last') return t('present.lastService');
  if (chip.kind === 'today') return t('common.today');
  return weekdayName(weekdayOf(chip.date));
}

/**
 * The top of the live run sheet: how far its day is from today, such as "Live tomorrow",
 * which moves on by itself at midnight, and chips that go live with the last service, today
 * or the next meeting day. While a slide shows, a chip asks first, so a stray click during a
 * service does not move everyone to another run sheet. A viewer sees the title only.
 */
export function LiveDateSwitch(props: { liveDate: IsoDate; viewOnly?: boolean }) {
  const { liveDate, viewOnly = false } = props;
  const session = useSession();
  const today = session.today();
  const last = useQuery(() => session.lastServiceDate(), [today]);
  const [asking, setAsking] = useState<IsoDate | null>(null);
  useEffect(() => setAsking(null), [liveDate]);

  const chips = dateChips(today, last, session.workspace.meetingDays);

  function choose(date: IsoDate) {
    const step = switchStep(date, liveDate, session.live);
    if (step === 'confirm') setAsking(date);
    else if (step === 'goLive') void session.goLive(date);
  }

  return (
    <>
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
            {chips.map((chip) => {
              const { date } = chip;
              const selected = date === liveDate;
              return (
                <button
                  key={date}
                  type="button"
                  aria-pressed={selected}
                  title={formatDate(date)}
                  className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${
                    selected
                      ? 'bg-emerald-700 text-emerald-50 ring-emerald-400/60'
                      : 'bg-slate-800 text-slate-300 ring-slate-700 hover:bg-slate-700'
                  }`}
                  onClick={() => choose(date)}
                >
                  {chipLabel(chip)}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* Outside the spaced block, which would otherwise space the chips from it. */}
      {asking && (
        <ConfirmDialog
          title={t('present.switchTitle', { date: formatDate(asking) })}
          body={t('present.switchBody')}
          confirmLabel={t('calendar.goLive')}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null);
            void session.goLive(asking);
          }}
        />
      )}
    </>
  );
}
