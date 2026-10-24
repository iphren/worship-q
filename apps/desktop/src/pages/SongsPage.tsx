import { open as openFile } from '@tauri-apps/plugin-dialog';
import type { IsoDate, Song } from '@worship-q/protocol';
import { useEffect, useRef, useState } from 'react';
import { useApp, useCloud, useQuery, useSession } from '../app/context';
import { ConfirmDialog } from '../components/Dialog';
import { SongForm } from '../components/SongForm';
import { SongPeek } from '../components/SongPeek';
import { formatDate, t } from '../i18n';
import { useScrollMemory } from '../lib/scrollMemory';

/** The library is listed in three tabs: ordinary songs, imported slide decks and websites. */
type Kind = 'songs' | 'slides' | 'web';
const KINDS: Kind[] = ['songs', 'slides', 'web'];

const kindOf = (song: Song): Kind => (song.website ? 'web' : song.deck ? 'slides' : 'songs');

/** The song being edited; `key` changes only when the operator picks another song. */
interface Editing {
  key: number;
  song: Song | null;
  /** With no song, a new website is being added instead of a song. */
  website?: boolean;
}

export function SongsPage() {
  const session = useSession();
  const [kind, setKind] = useState<Kind>('songs');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ song: Song | null; website?: boolean } | null>(null);
  const [removing, setRemoving] = useState<{ song: Song; usage: IsoDate[] } | null>(null);
  /** The `Editing.key` of a song just added to the run sheet; cleared after a moment. */
  const [added, setAdded] = useState<number | null>(null);
  useEffect(() => {
    if (added === null) return;
    const timer = setTimeout(() => setAdded(null), 2000);
    return () => clearTimeout(timer);
  }, [added]);
  const library = useQuery(() => session.store.listSongs(session.workspace.id, search), [search]);
  const songs = library?.filter((song) => kindOf(song) === kind);
  const listRef = useRef<HTMLUListElement>(null);
  useScrollMemory(listRef, `songs:${kind}:${search}`);

  const open = (song: Song | null, website?: boolean) => {
    setEditing((current) => ({ key: (current?.key ?? 0) + 1, song, website }));
    setDirty(false);
  };
  const select = (song: Song | null, website?: boolean) => {
    if (song && song.id === editing?.song?.id) return;
    if (dirty) setPending({ song, website });
    else open(song, website);
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
        <div role="tablist" className="-mx-3 -mt-3 mb-1 flex border-b border-slate-700 px-1">
          {KINDS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={kind === key}
              className={`-mb-px flex-1 border-b-2 px-1 py-2 text-xs font-medium tracking-wide uppercase ${
                kind === key
                  ? 'border-sky-500 text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setKind(key)}
            >
              {t(`library.${key}`)}
            </button>
          ))}
        </div>
        {kind === 'songs' && (
          <button className="btn btn-primary" onClick={() => select(null)}>
            + {t('songs.new')}
          </button>
        )}
        {kind === 'slides' && <ImportSlides onImported={(song) => select(song)} />}
        {kind === 'web' && (
          <button className="btn btn-primary" onClick={() => select(null, true)}>
            + {t('songs.newWebsite')}
          </button>
        )}
        <input
          className="field"
          type="search"
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          placeholder={t(`library.${kind}Search`)}
          title={t(`library.${kind}SearchHint`)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-auto">
          {songs?.length === 0 && (
            <li className="px-1 py-3 text-sm text-slate-500">
              {search.trim()
                ? t(`library.${kind}NoMatch`, { search: search.trim() })
                : t(`library.${kind}Empty`)}
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
            website={editing.website}
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
            open(pending.song, pending.website);
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

const DECK_EXTENSIONS = ['pptx', 'ppsx', 'pptm', 'potx', 'ppt', 'pps', 'odp', 'key', 'pdf'];

type ImportState =
  | { kind: 'idle' }
  | { kind: 'converting'; name: string }
  | { kind: 'fetching'; done: number; total: number }
  | { kind: 'failed'; message: string };

/** Imports a slide deck through the church server, which turns it into images. */
function ImportSlides(props: { onImported(song: Song): void }) {
  const { cloud } = useApp();
  const status = useCloud();
  const connected = !!status.state?.deviceToken && !!status.state.joinedAt;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  useEffect(() => {
    let active = true;
    void cloud.decksAvailable().then((value) => active && setAvailable(value));
    return () => {
      active = false;
    };
  }, [cloud, connected, status.state?.server]);

  async function choose() {
    const source = await openFile({
      multiple: false,
      filters: [{ name: t('songs.importSlides'), extensions: DECK_EXTENSIONS }],
    });
    if (typeof source !== 'string') return;
    const name = source.split(/[\\/]/).pop() ?? source;
    try {
      const song = await cloud.importDeck(source, (stage, done, total) =>
        setState(
          stage === 'converting' ? { kind: 'converting', name } : { kind: 'fetching', done, total },
        ),
      );
      setState({ kind: 'idle' });
      props.onImported(song);
    } catch (error) {
      setState({ kind: 'failed', message: String(error) });
    }
  }

  const busy = state.kind === 'converting' || state.kind === 'fetching';
  const hint = !connected
    ? t('songs.importNeedsServer')
    : available === false
      ? t('songs.importUnavailable')
      : t('songs.importHint');
  return (
    <div className="space-y-1">
      <button
        className="btn btn-primary w-full"
        disabled={!connected || !available || busy}
        title={hint}
        onClick={() => void choose()}
      >
        + {t('songs.importSlides')}…
      </button>
      {state.kind === 'converting' && (
        <p className="text-xs text-slate-400">
          {t('songs.importConverting', { name: state.name })}
        </p>
      )}
      {state.kind === 'fetching' && (
        <p className="text-xs text-slate-400">
          {t('songs.importFetching', { done: state.done, total: state.total })}
        </p>
      )}
      {state.kind === 'failed' && (
        <p className="text-xs text-rose-300">
          {t('songs.importFailed', { message: state.message })}
        </p>
      )}
      {(!connected || available === false) && state.kind === 'idle' && (
        <p className="text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}
