import type { IsoDate } from '@worship-q/protocol';
import { useRef, useState, type PointerEvent } from 'react';
import { useQuery, useSession } from '../app/context';
import { t } from '../i18n';
import { ConfirmDialog } from './Dialog';
import { Icon } from './Icon';
import { SongPeek } from './SongPeek';

type Drag = { id: string; from: number; to: number; dy: number; step: number };

function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** The songs planned for a date. Editable only when the session has the date open. */
export function RunSheetEditor(props: {
  date: IsoDate;
  activeItemId?: string | null;
  /** Makes the rows clickable; the grip and the row's buttons keep their own actions. */
  onSelectItem?: (itemId: string) => void;
}) {
  const { onSelectItem } = props;
  const session = useSession();
  const { date } = props;
  const editable = session.canEdit(date);
  const [search, setSearch] = useState('');
  const view = useQuery(() => session.viewDate(date), [date]);
  const songs = useQuery(
    () => (editable ? session.store.listSongs(session.workspace.id, search) : Promise.resolve([])),
    [search, editable],
  );
  const saved = view?.date === date ? view.entries : [];
  // A dropped item shows in its new place straight away, until the reloaded view replaces it.
  const [moved, setMoved] = useState<{ view: typeof view; ids: string[] } | null>(null);
  const entries =
    moved && moved.view === view && moved.ids.length === saved.length
      ? moved.ids.flatMap((id) => saved.find((entry) => entry.item.id === id) ?? [])
      : saved;
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const grab = useRef<{
    y: number;
    scroll: number;
    rows: { top: number; bottom: number }[];
  } | null>(null);

  function startDrag(event: PointerEvent<HTMLElement>, id: string, index: number) {
    const list = listRef.current;
    if (event.button !== 0 || !list) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rows = [...list.querySelectorAll('li[data-item]')].map((row) => {
      const { top, bottom } = row.getBoundingClientRect();
      return { top, bottom };
    });
    const row = rows[index];
    if (!row) return;
    const gap = rows.length > 1 ? rows[1]!.top - rows[0]!.bottom : 0;
    grab.current = { y: event.clientY, scroll: list.scrollTop, rows };
    setDrag({ id, from: index, to: index, dy: 0, step: row.bottom - row.top + gap });
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const start = grab.current;
    const list = listRef.current;
    if (!drag || !start || !list) return;
    const dy = event.clientY - start.y + list.scrollTop - start.scroll;
    const top = start.rows[drag.from]!.top + dy;
    const bottom = start.rows[drag.from]!.bottom + dy;
    let to = drag.from;
    start.rows.forEach((row, index) => {
      const middle = (row.top + row.bottom) / 2;
      if (index < drag.from && top < middle) to--;
      if (index > drag.from && bottom > middle) to++;
    });
    setDrag({ ...drag, to, dy });
  }

  function endDrag(drop: boolean) {
    grab.current = null;
    setDrag(null);
    if (!drop || !drag || drag.to === drag.from) return;
    const ids = reorder(entries, drag.from, drag.to).map((entry) => entry.item.id);
    setMoved({ view, ids });
    void session.moveItem(drag.id, drag.to).catch((error: unknown) => {
      setMoved(null);
      throw error;
    });
  }

  /** How far a row is shifted while an item is dragged past it. */
  function offset(index: number): number {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    const { step } = drag;
    if (index >= drag.to && index < drag.from) return step;
    if (index <= drag.to && index > drag.from) return -step;
    return 0;
  }
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removing = entries.find((entry) => entry.item.id === removingId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ol ref={listRef} className="min-h-0 shrink space-y-1 overflow-auto">
        {view && entries.length === 0 && (
          <li className="px-1 py-2 text-sm text-slate-500">
            {editable ? t('runSheet.empty') : t('calendar.nothingPlanned')}
          </li>
        )}
        {entries.map((entry, index) => (
          <li
            key={entry.item.id}
            data-item
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              entry.item.id === drag?.id
                ? 'relative z-10 bg-slate-700 shadow-lg ring-1 ring-sky-500'
                : entry.item.id === props.activeItemId
                  ? 'bg-sky-900/60'
                  : 'bg-slate-900/60'
            } ${drag && entry.item.id !== drag.id ? 'transition-transform duration-150' : ''} ${
              onSelectItem && !drag
                ? 'cursor-pointer transition hover:bg-slate-700/70 active:scale-[0.98] active:bg-sky-800/70'
                : ''
            }`}
            style={drag ? { transform: `translateY(${offset(index)}px)` } : undefined}
            onClick={(event) => {
              if ((event.target as Element).closest('button, [data-grip]')) return;
              onSelectItem?.(entry.item.id);
            }}
          >
            {editable && (
              <span
                data-grip
                className={`-mx-1 shrink-0 touch-none rounded px-0.5 py-1 text-slate-500 select-none hover:text-slate-200 ${
                  drag ? 'cursor-grabbing' : 'cursor-grab'
                }`}
                title={t('runSheet.drag')}
                onPointerDown={(event) => startDrag(event, entry.item.id, index)}
                onPointerMove={moveDrag}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
              >
                <Icon name="grip" className="h-4 w-4" />
              </span>
            )}
            <span className="w-5 shrink-0 text-right text-xs text-slate-500">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.song.title || t('songs.untitled')}</span>
              {entry.song.removedAt && (
                <span className="text-xs text-amber-400">{t('songs.removedBadge')}</span>
              )}
            </span>
            {editable && (
              <span className="flex shrink-0">
                <button
                  className="btn btn-ghost btn-sm"
                  title={t('runSheet.moveUp')}
                  disabled={index === 0}
                  onClick={() => void session.moveItem(entry.item.id, index - 1)}
                >
                  ↑
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title={t('runSheet.moveDown')}
                  disabled={index === entries.length - 1}
                  onClick={() => void session.moveItem(entry.item.id, index + 1)}
                >
                  ↓
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title={t('common.remove')}
                  onClick={() => setRemovingId(entry.item.id)}
                >
                  ✕
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {editable && (
        <div className="flex min-h-40 flex-1 flex-col gap-1 border-t border-slate-700 pt-3">
          <input
            className="field"
            type="search"
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('runSheet.addSong')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto">
            {songs?.length === 0 && (
              <li className="px-1 py-2 text-sm text-slate-500">{t('runSheet.noSongs')}</li>
            )}
            {songs?.map((song) => (
              <li key={song.id}>
                <SongPeek song={song}>
                  <div className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-700/50">
                    <span className="truncate">{song.title || t('songs.untitled')}</span>
                    <button
                      className="btn btn-sm shrink-0"
                      onClick={() => void session.addSong(date, song.id)}
                    >
                      + {t('runSheet.add')}
                    </button>
                  </div>
                </SongPeek>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editable && removing && (
        <ConfirmDialog
          title={t('runSheet.removeTitle', {
            title: removing.song.title || t('songs.untitled'),
          })}
          body={t('runSheet.removeBody')}
          confirmLabel={t('common.remove')}
          danger
          onCancel={() => setRemovingId(null)}
          onConfirm={() => {
            setRemovingId(null);
            void session.removeItem(removing.item.id);
          }}
        />
      )}
    </div>
  );
}
