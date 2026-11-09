import type { RunSheetView } from '@worship-q/session';
import { formatDate, t } from '../i18n';
import { DeckBadge } from './DeckBadge';

/** How many items the glance lists; a longer run sheet shows only its last ones. */
const SHOWN = 6;

/**
 * A brief look at a run sheet just added to from the library, which does not show it,
 * with the added item marked. It never takes clicks, so it cannot get in the way.
 */
export function RunSheetGlance(props: { view: RunSheetView; addedItemId: string }) {
  const { entries } = props.view;
  const start = Math.max(0, entries.length - SHOWN);
  const hidden = start;
  return (
    <div
      role="status"
      className="run-sheet-glance pointer-events-none fixed top-4 right-4 z-50 w-72 rounded-lg border border-slate-600 bg-slate-800/95 p-3 shadow-2xl"
    >
      <p className="label mb-3">
        {t('runSheet.tab')} · {formatDate(props.view.date)}
      </p>
      <ol className="space-y-1">
        {hidden > 0 && (
          <li className="rounded-md bg-sky-900/50 px-2 py-1.5 text-sm text-sky-200 ring-1 ring-sky-500/60">
            {t('runSheet.glanceMore', { count: hidden })}
          </li>
        )}
        {entries.slice(start).map((entry, offset) => {
          const added = entry.item.id === props.addedItemId;
          return (
            <li
              key={entry.item.id}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                added ? 'bg-emerald-900/60 ring-1 ring-emerald-400' : 'bg-slate-900/60'
              }`}
            >
              <span className="w-5 shrink-0 text-right text-xs text-slate-500">
                {start + offset + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <DeckBadge song={entry.song} />
                {entry.song.title || t('songs.untitled')}
              </span>
              {added && <span className="shrink-0 text-emerald-300">✓</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
