import type { IsoDate } from '@worship-q/protocol';
import { useState } from 'react';
import { useQuery, useSession } from '../app/context';
import { t } from '../i18n';
import { ConfirmDialog } from './Dialog';

/** The songs planned for a date. Editable only when the session has the date open. */
export function RunSheetEditor(props: { date: IsoDate; activeItemId?: string | null }) {
  const session = useSession();
  const { date } = props;
  const editable = session.canEdit(date);
  const [search, setSearch] = useState('');
  const view = useQuery(() => session.viewDate(date), [date]);
  const songs = useQuery(
    () => (editable ? session.store.listSongs(session.workspace.id, search) : Promise.resolve([])),
    [search, editable],
  );
  const entries = view?.date === date ? view.entries : [];
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removing = entries.find((entry) => entry.item.id === removingId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ol className="min-h-0 shrink space-y-1 overflow-auto">
        {view && entries.length === 0 && (
          <li className="px-1 py-2 text-sm text-slate-500">
            {editable ? t('runSheet.empty') : t('calendar.nothingPlanned')}
          </li>
        )}
        {entries.map((entry, index) => (
          <li
            key={entry.item.id}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              entry.item.id === props.activeItemId ? 'bg-sky-900/60' : 'bg-slate-900/60'
            }`}
          >
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
                <button
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-700"
                  onClick={() => void session.addSong(date, song.id)}
                >
                  <span className="truncate">{song.title || t('songs.untitled')}</span>
                  <span className="shrink-0 text-xs text-sky-400">+ {t('runSheet.add')}</span>
                </button>
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
