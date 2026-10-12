import { monthGrid, yearMonthOf } from '@worship-q/calendar';
import type { IsoDate } from '@worship-q/protocol';
import { useState } from 'react';
import { useApp, useQuery, useSession } from '../app/context';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { MonthCalendar } from '../components/MonthCalendar';
import { RunSheetEditor } from '../components/RunSheetEditor';
import { formatDate, meetingDaysLabel, t } from '../i18n';

type CopyStep = { step: 'choose' | 'confirm-replace'; source: IsoDate } | null;

export function CalendarPage() {
  const { navigate } = useApp();
  const session = useSession();
  const { openDate, liveDate } = session;
  const today = session.today();
  const [browsed, setBrowsed] = useState<IsoDate>(openDate);
  const [month, setMonth] = useState(() => yearMonthOf(openDate));
  const [copy, setCopy] = useState<CopyStep>(null);
  const [message, setMessage] = useState<string | null>(null);

  const weeks = monthGrid(month.year, month.month);
  const planned = useQuery(
    () =>
      session.store
        .datesWithItems(session.workspace.id, weeks[0]![0]!, weeks[5]![6]!)
        .then((dates) => new Set(dates)),
    [month.year, month.month],
  );
  const view = useQuery(() => session.viewDate(browsed), [browsed]);
  const target = useQuery(() => session.viewDate(openDate), [openDate]);
  const entries = view?.date === browsed ? view.entries : [];
  const targetCount = target?.date === openDate ? target.entries.length : 0;

  const isLive = browsed === liveDate;
  const editable = session.canEdit(browsed);
  const canCopy = browsed !== openDate && entries.length > 0;
  // The live run sheet can always be edited, yet only the open date is the target of copies.
  // With nothing live, opening a date would make it live, which is what Go live is for.
  const canOpen = session.isLive && browsed !== openDate;

  function show(date: IsoDate) {
    setBrowsed(date);
    setMonth(yearMonthOf(date));
    setMessage(null);
  }
  const names = {
    target: formatDate(openDate),
    source: formatDate(browsed),
    date: formatDate(openDate),
  };

  async function runCopy(source: IsoDate, mode?: 'append' | 'replace') {
    const result = await session.copyFrom(source, mode);
    if (result.status === 'choose') {
      setCopy({ step: 'choose', source });
      return;
    }
    setCopy(null);
    if (result.status === 'copied') {
      setMessage(t('calendar.copied', { count: result.count, date: formatDate(openDate) }));
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-80 shrink-0 space-y-4 border-r border-slate-700 p-4">
        <MonthCalendar
          year={month.year}
          month={month.month}
          onMonthChange={(year, m) => setMonth({ year, month: m })}
          selected={browsed}
          onSelect={(date) => {
            setBrowsed(date);
            setMessage(null);
          }}
          today={today}
          liveDate={liveDate}
          openDate={openDate}
          planned={planned ?? new Set()}
          meetingDays={session.workspace.meetingDays}
        />
        <p className="text-xs text-slate-400">
          {t('calendar.meetingDays', { label: meetingDaysLabel(session.workspace.meetingDays) })}
        </p>
        <ul className="space-y-1 text-xs text-slate-400">
          {/* One line per dot on the calendar: a date that is both live and open has one dot. */}
          {liveDate && (
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />{' '}
              {t(liveDate === openDate ? 'calendar.liveAndEditing' : 'calendar.live')} ·{' '}
              <button className="underline hover:text-slate-200" onClick={() => show(liveDate)}>
                {formatDate(liveDate)}
              </button>
            </li>
          )}
          {liveDate !== openDate && (
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-yellow-400" /> {t('calendar.editing')} ·{' '}
              <button className="underline hover:text-slate-200" onClick={() => show(openDate)}>
                {formatDate(openDate)}
              </button>
            </li>
          )}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-xl font-semibold">{formatDate(browsed, 'long')}</h1>
          {isLive ? (
            <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold">
              {t('calendar.live')}
            </span>
          ) : editable ? (
            <span className="rounded bg-yellow-500 px-2 py-0.5 text-xs font-semibold text-slate-900">
              {t('calendar.editing')}
            </span>
          ) : (
            <span className="rounded bg-slate-600 px-2 py-0.5 text-xs font-semibold">
              {t('calendar.readOnly')}
            </span>
          )}
          <span className="flex-1" />
          {canCopy && (
            <button className="btn" onClick={() => void runCopy(browsed)}>
              {t('calendar.copyTo', { date: formatDate(openDate) })}
            </button>
          )}
          {canOpen && (
            <button className="btn btn-edit" onClick={() => void session.editRunSheet(browsed)}>
              {t('calendar.editRunSheet')}
            </button>
          )}
          {!isLive && (
            <button
              className="btn btn-live"
              onClick={() => void session.goLive(browsed).then(() => navigate('present'))}
            >
              {t('calendar.goLive')}
            </button>
          )}
        </header>
        {message && (
          <p className="notice border-emerald-700 bg-emerald-900/30 text-emerald-200">{message}</p>
        )}
        <div className="panel flex min-h-0 max-w-2xl flex-1 flex-col p-3">
          <RunSheetEditor key={browsed} date={browsed} />
        </div>
      </section>

      {copy?.step === 'choose' && (
        <Dialog
          title={t('calendar.copyTitle', { date: names.date })}
          onClose={() => setCopy(null)}
          actions={
            <>
              <button className="btn" onClick={() => setCopy(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => setCopy({ step: 'confirm-replace', source: copy.source })}
              >
                {t('calendar.replace')}
              </button>
              <button
                className="btn btn-primary"
                autoFocus
                onClick={() => void runCopy(copy.source, 'append')}
              >
                {t('calendar.append')}
              </button>
            </>
          }
        >
          {t('calendar.copyBody', {
            ...names,
            count: targetCount,
            source: formatDate(copy.source),
          })}
        </Dialog>
      )}
      {copy?.step === 'confirm-replace' && (
        <ConfirmDialog
          title={t('calendar.replaceTitle', { date: names.date })}
          body={t('calendar.replaceBody', { count: targetCount, source: formatDate(copy.source) })}
          confirmLabel={t('calendar.replace')}
          danger
          onCancel={() => setCopy(null)}
          onConfirm={() => void runCopy(copy.source, 'replace')}
        />
      )}
    </div>
  );
}
