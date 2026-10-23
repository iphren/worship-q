import type { IsoDate, Song } from '@worship-q/protocol';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useSession } from '../app/context';
import { ConfirmDialog } from '../components/Dialog';
import { SongForm } from '../components/SongForm';
import { SongPeek } from '../components/SongPeek';
import { formatDate, t } from '../i18n';
import { useScrollMemory } from '../lib/scrollMemory';

/** The song being edited; `key` changes only when the operator picks another song. */
interface Editing {
  key: number;
  song: Song | null;
}

export function SongsPage() {
  const session = useSession();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ song: Song | null } | null>(null);
  const [removing, setRemoving] = useState<{ song: Song; usage: IsoDate[] } | null>(null);
  /** The `Editing.key` of a song just added to the run sheet; cleared after a moment. */
  const [added, setAdded] = useState<number | null>(null);
  useEffect(() => {
    if (added === null) return;
    const timer = setTimeout(() => setAdded(null), 2000);
    return () => clearTimeout(timer);
  }, [added]);
  const songs = useQuery(() => session.store.listSongs(session.workspace.id, search), [search]);
  const listRef = useRef<HTMLUListElement>(null);
  useScrollMemory(listRef, `songs:${search}`);

  const open = (song: Song | null) => {
    setEditing((current) => ({ key: (current?.key ?? 0) + 1, song }));
    setDirty(false);
  };
  const select = (song: Song | null) => {
    if (song && song.id === editing?.song?.id) return;
    if (dirty) setPending({ song });
    else open(song);
  };

  async function addToRunSheet(song: Song, key: number) {
    // Ignore repeat clicks while the check is showing.
    if (added === key) return;
    setAdded(key);
    await session.addSong(session.openDate, song.id);
  }

  async function askRemove(song: Song) {
    setRemoving({ song, usage: await session.store.songUsage(song.id) });
  }

  async function remove(song: Song) {
    await session.removeSong(song.id);
    setRemoving(null);
    setEditing(null);
    setDirty(false);
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-52 shrink-0 flex-col gap-2 border-r border-slate-700 p-3">
        <button className="btn btn-primary" onClick={() => select(null)}>
          + {t('songs.new')}
        </button>
        <input
          className="field"
          type="search"
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('songs.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-auto">
          {songs?.length === 0 && (
            <li className="px-1 py-3 text-sm text-slate-500">
              {search.trim() ? t('songs.noMatch', { search: search.trim() }) : t('songs.empty')}
            </li>
          )}
          {songs?.map((song) => (
            <li key={song.id}>
              <SongPeek song={song}>
                <button
                  className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                    song.id === editing?.song?.id ? 'bg-sky-900/60' : 'hover:bg-slate-700'
                  }`}
                  onClick={() => select(song)}
                >
                  {song.title || t('songs.untitled')}
                </button>
              </SongPeek>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 flex-1 p-4">
        {editing ? (
          <SongForm
            key={editing.key}
            song={editing.song}
            onDirtyChange={setDirty}
            onSaved={(song) => setEditing((current) => current && { ...current, song })}
            actions={
              editing.song && (
                <>
                  <button
                    type="button"
                    className="btn btn-danger mr-auto"
                    onClick={() => void askRemove(editing.song!)}
                  >
                    {t('common.remove')}
                  </button>
                  <button
                    type="button"
                    className="btn grid justify-items-center"
                    onClick={() => void addToRunSheet(editing.song!, editing.key)}
                  >
                    {/* The label keeps its space under the check, so the layout stays put. */}
                    <span
                      className={`col-start-1 row-start-1 ${added === editing.key ? 'invisible' : ''}`}
                    >
                      + {t('songs.addToRunSheet', { date: formatDate(session.openDate) })}
                    </span>
                    {added === editing.key && (
                      <span
                        className="col-start-1 row-start-1 text-emerald-300"
                        aria-label={t('songs.addedToRunSheet')}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                </>
              )
            }
          />
        ) : (
          <p className="p-6 text-slate-500">{t('songs.select')}</p>
        )}
      </section>

      {pending && (
        <ConfirmDialog
          title={t('songs.discardTitle')}
          body={t('songs.discardBody')}
          confirmLabel={t('songs.discard')}
          danger
          onCancel={() => setPending(null)}
          onConfirm={() => {
            open(pending.song);
            setPending(null);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t('songs.removeTitle', { title: removing.song.title || t('songs.untitled') })}
          body={
            removing.usage.length === 0
              ? t('songs.removeUnused')
              : t('songs.removeUsed', {
                  count: removing.usage.length,
                  dates:
                    removing.usage
                      .slice(-3)
                      .map((date) => formatDate(date))
                      .join(', ') + (removing.usage.length > 3 ? ', …' : ''),
                })
          }
          confirmLabel={t('common.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing.song)}
        />
      )}
    </div>
  );
}
