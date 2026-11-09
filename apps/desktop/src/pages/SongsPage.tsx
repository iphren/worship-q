import type { IsoDate, Song } from '@worship-q/protocol';
import type { RunSheetView } from '@worship-q/session';
import { useEffect, useRef, useState } from 'react';
import { useApp, useCloud, useQuery, useSession } from '../app/context';
import { ConfirmDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { RunSheetGlance } from '../components/RunSheetGlance';
import { SongForm } from '../components/SongForm';
import { SongPeek } from '../components/SongPeek';
import {
  chooseMediaFiles,
  refusedMessage,
  UploadRow,
  useMediaBlocked,
  useUploads,
} from '../components/UploadProgress';
import { formatDate, t } from '../i18n';
import { useFileDrop } from '../lib/fileDrop';
import { useScrollMemory } from '../lib/scrollMemory';
import { useSearchShortcut } from '../lib/searchShortcut';

/**
 * The library is listed in three tabs: ordinary songs, media (slide decks, PDFs, images and
 * videos, U12) and websites.
 */
type Kind = 'songs' | 'media' | 'web';
const KINDS: Kind[] = ['songs', 'media', 'web'];

const kindOf = (song: Song): Kind =>
  song.website ? 'web' : song.deck || song.video ? 'media' : 'songs';

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
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ song: Song | null; website?: boolean } | null>(null);
  const [removing, setRemoving] = useState<{ song: Song; usage: IsoDate[] } | null>(null);
  /** The pinned item the operator asked to unpin, waiting for them to confirm. */
  const [unpinning, setUnpinning] = useState<Song | null>(null);
  /** The `Editing.key` of a song just added to the run sheet; cleared after a moment. */
  const [added, setAdded] = useState<number | null>(null);
  useEffect(() => {
    if (added === null) return;
    const timer = setTimeout(() => setAdded(null), 3000);
    return () => clearTimeout(timer);
  }, [added]);
  /** The run sheet just added to, shown briefly since the library does not show it. */
  const [glance, setGlance] = useState<{ view: RunSheetView; itemId: string } | null>(null);
  useEffect(() => {
    if (!glance) return;
    const timer = setTimeout(() => setGlance(null), 3000);
    return () => clearTimeout(timer);
  }, [glance]);
  const library = useQuery(async () => {
    const workspaceId = session.workspace.id;
    return {
      songs: await session.store.listSongs(workspaceId, search),
      pinned: await session.store.pinnedSongIds(workspaceId),
    };
  }, [search]);
  const songs = library?.songs.filter((song) => kindOf(song) === kind);
  const pinned = library?.pinned ?? new Set<string>();
  // Pinned items lead the list only when nothing is searched; a line ends their group.
  const lastPinned = search.trim()
    ? -1
    : (songs?.findLastIndex((song) => pinned.has(song.id)) ?? -1);
  const listRef = useRef<HTMLUListElement>(null);
  useScrollMemory(listRef, `songs:${kind}:${search}`);

  // A file dropped anywhere on the library goes to the Media tab, never to a run sheet (M3.8).
  const { cloud } = useApp();
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  useFileDrop({
    drop: (paths) => {
      setKind('media');
      void cloud
        .addMedia(paths, { kind: 'library' })
        .then((refused) => setDropMessage(refusedMessage(refused)));
    },
  });

  // A finished upload opens in the editor, unless another item has unsaved changes (U16).
  const uploads = useUploads();
  useEffect(() => {
    for (const upload of uploads) {
      if (upload.target.kind !== 'library' || upload.stage.kind !== 'done') continue;
      const { songId } = upload.stage;
      cloud.uploads.dismiss(upload.id);
      if (!songId || dirty) continue;
      void session.store.getSong(songId).then((song) => song && open(song));
    }
  }, [uploads, dirty, cloud, session]);

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
    const date = session.openDate;
    const item = await session.addSong(date, song.id);
    setGlance({ view: await session.viewDate(date), itemId: item.id });
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
        {kind === 'media' && <AddMedia onRefused={setDropMessage} />}
        {kind === 'web' && (
          <button className="btn btn-primary" onClick={() => select(null, true)}>
            + {t('songs.newWebsite')}
          </button>
        )}
        <input
          ref={searchRef}
          className="field"
          type="search"
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          placeholder={t(`library.${kind}Search`)}
          title={`${t(`library.${kind}SearchHint`)}\n${t('common.searchShortcut')}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {kind === 'media' && (
          <LibraryUploads message={dropMessage} onDismiss={() => setDropMessage(null)} />
        )}
        <ul ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-auto">
          {songs?.length === 0 && (
            <li className="px-1 py-3 text-sm text-slate-500">
              {search.trim()
                ? t(`library.${kind}NoMatch`, { search: search.trim() })
                : t(`library.${kind}Empty`)}
            </li>
          )}
          {songs?.map((song, index) => {
            const isPinned = pinned.has(song.id);
            return (
              <li
                key={song.id}
                className={
                  index === lastPinned && index < songs.length - 1
                    ? 'mb-1 border-b border-slate-700 pb-1'
                    : undefined
                }
              >
                <SongPeek song={song}>
                  <div
                    className={`group flex items-center rounded-md ${
                      song.id === editing?.song?.id ? 'bg-sky-900/60' : 'hover:bg-slate-700'
                    }`}
                  >
                    <button
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                      onClick={() => select(song)}
                    >
                      {song.title || t('songs.untitled')}
                    </button>
                    <button
                      type="button"
                      className={`mr-1 shrink-0 rounded p-1 hover:bg-slate-600 hover:text-slate-100 focus-visible:opacity-100 ${
                        isPinned
                          ? 'text-sky-400'
                          : 'text-slate-400 opacity-0 group-hover:opacity-100'
                      }`}
                      aria-label={t(isPinned ? 'library.unpin' : 'library.pin')}
                      aria-pressed={isPinned}
                      title={t(isPinned ? 'library.unpin' : 'library.pin')}
                      onClick={() =>
                        isPinned ? setUnpinning(song) : void session.setSongPinned(song.id, true)
                      }
                    >
                      <Icon name="pin" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </SongPeek>
              </li>
            );
          })}
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

      {glance && (
        <RunSheetGlance key={glance.itemId} view={glance.view} addedItemId={glance.itemId} />
      )}

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
      {unpinning && (
        <ConfirmDialog
          title={t('library.unpinTitle', { title: unpinning.title || t('songs.untitled') })}
          body={t('library.unpinBody')}
          confirmLabel={t('library.unpin')}
          onCancel={() => setUnpinning(null)}
          onConfirm={() => {
            void session.setSongPinned(unpinning.id, false);
            setUnpinning(null);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t('songs.removeTitle', { title: removing.song.title || t('songs.untitled') })}
          body={
            // A church song is only hidden here (spec §5); the dialog says so.
            removing.usage.length === 0
              ? t(
                  removing.song.origin === 'church' &&
                    !session.store.managesChurch('song', removing.song)
                    ? 'songs.hideChurchBody'
                    : 'songs.removeUnused',
                )
              : t(
                  removing.song.origin === 'church' &&
                    !session.store.managesChurch('song', removing.song)
                    ? 'songs.hideChurchUsed'
                    : 'songs.removeUsed',
                  {
                    count: removing.usage.length,
                    dates:
                      removing.usage
                        .slice(-3)
                        .map((date) => formatDate(date))
                        .join(', ') + (removing.usage.length > 3 ? ', …' : ''),
                  },
                )
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

/** **Add media…** (U12): one button for slide decks, PDFs, images and videos. */
function AddMedia(props: { onRefused(message: string | null): void }) {
  const { cloud } = useApp();
  const blocked = useMediaBlocked();
  const status = useCloud();
  const offer = cloud.mediaOffer();
  const older = offer && !offer.current;

  async function choose() {
    const paths = await chooseMediaFiles();
    if (paths.length === 0) return;
    props.onRefused(refusedMessage(await cloud.addMedia(paths, { kind: 'library' })));
  }

  // Re-render when the server's info arrives.
  void status.server;
  return (
    <div className="space-y-1">
      <button
        className="btn btn-primary w-full"
        disabled={!!blocked}
        title={blocked ?? t('media.addTitle')}
        onClick={() => void choose()}
      >
        + {t('media.add')}…
      </button>
      {(blocked || older) && (
        <p className="text-xs text-slate-500">{blocked ?? t('media.needsServerUpdate')}</p>
      )}
    </div>
  );
}

/** The library's uploads, one row each, under the search box (U16). */
function LibraryUploads(props: { message: string | null; onDismiss(): void }) {
  const uploads = useUploads().filter(
    (upload) => upload.target.kind === 'library' && upload.stage.kind !== 'done',
  );
  if (uploads.length === 0 && !props.message) return null;
  return (
    <div className="space-y-1">
      {props.message && (
        <p className="flex items-start gap-1 text-xs text-rose-300" role="alert">
          <span className="flex-1">{props.message}</span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-100"
            aria-label={t('media.dismiss')}
            onClick={props.onDismiss}
          >
            ✕
          </button>
        </p>
      )}
      {uploads.map((upload) => (
        <UploadRow key={upload.id} upload={upload} />
      ))}
    </div>
  );
}
