import type { IsoDate, Song } from '@worship-q/protocol';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useApp, useCloud, useQuery, useSession } from '../app/context';
import { t } from '../i18n';
import { useEdgeScroll } from '../lib/edgeScroll';
import { dropIndex, inside, useFileDrop, type Point } from '../lib/fileDrop';
import { native } from '../platform/native';
import { ItemEditDialog } from './ItemEditDialog';
import { canReplace, downloadOriginal, originalNotKept, uploadNewVersion } from './MediaActions';
import { Menu, type MenuItem } from './Menu';
import { itemActions, mergeRows } from './runSheetRows';
import {
  chooseMediaFiles,
  refusedMessage,
  UploadBar,
  useMediaBlocked,
  useUploads,
} from './UploadProgress';
import { KindBadge } from './DeckBadge';
import { VideoCopyState } from './VideoStatus';
import { useScrollMemory } from '../lib/scrollMemory';
import { useSearchShortcut } from '../lib/searchShortcut';
import { ConfirmDialog } from './Dialog';
import { Icon } from './Icon';
import { SongPeek } from './SongPeek';
import { DeckBadge, PinnedMark } from './DeckBadge';

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
  /** The item moved to without presenting it, which the slide keys now act on. */
  keyedItemId?: string | null;
  /** Makes the rows clickable; the grip and the row's buttons keep their own actions. */
  onSelectItem?: (itemId: string) => void;
  /** Lists songs only once searched for, instead of all of them while the search is empty. */
  searchOnly?: boolean;
  /** Kept at the bottom, under the song search. */
  footer?: ReactNode;
  /** Shows the song search for its `/` shortcut when it is on a tab that is not shown. */
  onRevealSearch?: () => void;
}) {
  const { onSelectItem } = props;
  const session = useSession();
  const { date } = props;
  const editable = session.canEdit(date);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef, props.onRevealSearch);
  const idle = props.searchOnly === true && search.trim() === '';
  const view = useQuery(() => session.viewDate(date), [date]);
  const songs = useQuery(
    () =>
      editable && !idle
        ? session.store.listSongs(session.workspace.id, search)
        : Promise.resolve([]),
    [search, editable, idle],
  );
  const pinned = useQuery(() => session.store.pinnedSongIds(session.workspace.id), []);
  const showPins = search.trim() === '';
  const saved = view?.date === date ? view.entries : [];
  // A dropped item shows in its new place straight away, until the reloaded view replaces it.
  const [moved, setMoved] = useState<{ view: typeof view; ids: string[] } | null>(null);
  const entries =
    moved && moved.view === view && moved.ids.length === saved.length
      ? moved.ids.flatMap((id) => saved.find((entry) => entry.item.id === id) ?? [])
      : saved;
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const songsRef = useRef<HTMLUListElement>(null);
  const mode = props.searchOnly ? 'live' : 'plan';
  useScrollMemory(listRef, `runSheet:${mode}:${date}`);
  useScrollMemory(songsRef, `runSheet.songs:${mode}:${search}`);
  const grab = useRef<{
    y: number;
    scroll: number;
    rows: { top: number; bottom: number }[];
  } | null>(null);

  // A long run sheet scrolls while a row is held near its top or bottom edge.
  const dragEdgeScroll = useEdgeScroll(listRef, dragTo);

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
    const point = { x: event.clientX, y: event.clientY };
    dragEdgeScroll(drag ? point : null);
    dragTo(point);
  }

  function dragTo(point: Point) {
    const start = grab.current;
    const list = listRef.current;
    if (!drag || !start || !list) return;
    const dy = point.y - start.y + list.scrollTop - start.scroll;
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
    dragEdgeScroll(null);
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

  // ── Media (media uploads plan, U16, U17, U26, U27) ──
  const { cloud } = useApp();
  const status = useCloud();
  const connected = !!status.state?.deviceToken && !!status.state.joinedAt;
  const blocked = useMediaBlocked();
  const uploads = useUploads();
  const aimed = uploads.filter(
    (upload) => upload.target.kind === 'runSheet' && upload.target.date === date,
  );
  const rows = mergeRows(
    entries,
    aimed.filter((upload) => upload.stage.kind !== 'done'),
  );
  const notes = aimed.filter((upload) => upload.stage.kind === 'done' && upload.stage.note);
  // A ready upload becomes the ordinary item: its row is no longer needed.
  useEffect(() => {
    for (const upload of aimed) {
      if (upload.stage.kind === 'done' && !upload.stage.note) cloud.uploads.dismiss(upload.id);
    }
  }, [aimed, cloud]);
  const localVideos = useQuery(
    () =>
      native
        .listVideos()
        .then((files) => new Set(files))
        .catch(() => new Set<string>()),
    [uploads.length],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const itemRects = () =>
    [...(listRef.current?.querySelectorAll('li[data-item]') ?? [])].map((row) => {
      const { top, bottom } = row.getBoundingClientRect();
      return { top, bottom };
    });
  const showDropAt = (point: Point) => setDropAt(dropIndex(itemRects(), point.y));
  // A long run sheet scrolls while files are held near its top or bottom edge.
  const edgeScroll = useEdgeScroll(listRef, showDropAt);
  useFileDrop(
    {
      over: (point) => {
        const over = point && inside(rootRef.current, point) ? point : null;
        edgeScroll(over);
        if (over) showDropAt(over);
        else setDropAt(null);
      },
      drop: (paths, point) => {
        if (!inside(rootRef.current, point)) return;
        const index = dropIndex(itemRects(), point.y);
        const afterItemId = index === 0 ? null : (entries[index - 1]?.item.id ?? undefined);
        void addMedia(paths, afterItemId);
      },
    },
    editable,
  );

  async function addMedia(paths: string[], afterItemId?: string | null) {
    if (paths.length === 0) return;
    if (blocked) return setMessage(blocked);
    setMessage(
      refusedMessage(await cloud.addMedia(paths, { kind: 'runSheet', date, afterItemId })),
    );
  }

  function menuItems(song: Song, itemId: string): MenuItem[] {
    const labels = {
      edit: `${t('runSheet.edit')}…`,
      download: t('media.downloadOriginal'),
      replace: `${t('media.uploadNewVersion')}…`,
      remove: t('common.remove'),
    };
    return itemActions(song, {
      editable,
      connected,
      localVideo: !!song.video && !!localVideos?.has(song.video.file),
      canReplace: canReplace(session, song),
      notKept: originalNotKept(song.id),
      messages: { needsServer: t('media.needsServer'), notKept: t('media.notKept') },
    }).map(({ action, disabled }) => ({
      key: action,
      label: labels[action],
      disabled,
      danger: action === 'remove',
      separated: action === 'remove',
      onSelect: () => {
        if (action === 'edit') setEditingSong(song);
        else if (action === 'remove') setRemovingId(itemId);
        else if (action === 'download') {
          void downloadOriginal(cloud, song).then(setMessage);
        } else void uploadNewVersion(cloud, song).then(setMessage);
      },
    }));
  }

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col gap-3">
      {(message || notes.length > 0) && (
        <div className="space-y-1">
          {message && <Note text={message} onDismiss={() => setMessage(null)} />}
          {notes.map((upload) => (
            <Note
              key={upload.id}
              text={`${upload.name}: ${(upload.stage as { note: string }).note}`}
              onDismiss={() => cloud.uploads.dismiss(upload.id)}
            />
          ))}
        </div>
      )}
      <ol ref={listRef} className="min-h-0 shrink space-y-1 overflow-auto">
        {view && entries.length === 0 && rows.length === 0 && (
          <li className="px-1 py-2 text-sm text-slate-500">
            {editable ? t('runSheet.empty') : t('calendar.nothingPlanned')}
          </li>
        )}
        {rows.map((row) => {
          if (row.kind === 'upload') {
            const { upload } = row;
            return (
              <li
                key={upload.id}
                className="rounded-md border border-dashed border-slate-600 bg-slate-900/40 px-2 py-1.5 text-sm"
              >
                <span className="mb-1 flex min-w-0 items-center">
                  <span className="w-5 shrink-0" />
                  <KindBadge kind={upload.kind} />
                  <span className="truncate text-slate-300">{upload.name}</span>
                </span>
                <UploadBar upload={upload} compact={upload.stage.kind === 'uploading'} />
              </li>
            );
          }
          const { entry, index } = row;
          const versions = uploads.filter(
            (upload) =>
              upload.target.kind === 'newVersion' &&
              upload.target.songId === entry.song.id &&
              upload.stage.kind !== 'done',
          );
          const actions = menuItems(entry.song, entry.item.id);
          return (
            <DropLine key={entry.item.id} show={dropAt === index}>
              <li
                data-item
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  entry.item.id === drag?.id
                    ? 'relative z-10 bg-slate-700 shadow-lg ring-1 ring-sky-500'
                    : entry.item.id === props.activeItemId
                      ? 'bg-sky-900/60'
                      : 'bg-slate-900/60'
                } ${entry.item.id === props.keyedItemId && !drag ? 'ring-2 ring-sky-400 ring-inset' : ''} ${drag && entry.item.id !== drag.id ? 'transition-transform duration-150' : ''} ${
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
                  <span className="block truncate">
                    <DeckBadge song={entry.song} />
                    {entry.song.title || t('songs.untitled')}
                  </span>
                  {entry.song.removedAt && (
                    <span className="text-xs text-amber-400">{t('songs.removedBadge')}</span>
                  )}
                  {entry.song.video && <VideoCopyState file={entry.song.video.file} />}
                  {versions.map((upload) => (
                    <span key={upload.id} className="mt-1 block">
                      <UploadBar upload={upload} compact={upload.stage.kind === 'uploading'} />
                    </span>
                  ))}
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
                  </span>
                )}
                {actions.length > 0 && <Menu label={t('runSheet.itemMenu')} items={actions} />}
              </li>
            </DropLine>
          );
        })}
        {dropAt !== null && dropAt >= entries.length && <DropMark />}
      </ol>
      {editable && (
        <div
          className={`flex flex-col gap-1.5 border-t border-slate-700 pt-3 ${idle ? '' : 'min-h-40 flex-1'}`}
        >
          <div className="flex gap-1">
            <input
              ref={searchRef}
              className="field min-w-0 flex-1"
              type="search"
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('runSheet.addSong')}
              title={t('common.searchShortcut')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              className="btn shrink-0 px-2"
              disabled={!!blocked}
              title={blocked ?? t('media.addTitle')}
              aria-label={t('media.addTitle')}
              onClick={() => void chooseMediaFiles().then((paths) => addMedia(paths))}
            >
              <Icon name="addMedia" />
            </button>
          </div>
          {!idle && (
            <ul ref={songsRef} className="min-h-0 flex-1 space-y-1.5 overflow-auto">
              {songs?.length === 0 && (
                <li className="px-1 py-2 text-sm text-slate-500">{t('runSheet.noSongs')}</li>
              )}
              {songs?.map((song) => (
                <li key={song.id}>
                  <SongPeek song={song}>
                    <div
                      className="flex w-full cursor-default items-stretch gap-2 rounded-md pr-2 text-sm hover:bg-slate-700/50"
                      onDoubleClick={(event) => {
                        // A double click on the button has already added the song twice.
                        if ((event.target as Element).closest('button')) return;
                        void session.addSong(date, song.id);
                      }}
                    >
                      <button
                        className="btn shrink-0 px-2 py-0"
                        title={t('runSheet.addHint')}
                        aria-label={t('runSheet.add')}
                        onClick={() => void session.addSong(date, song.id)}
                      >
                        <Icon name="add" className="h-4 w-4" />
                      </button>
                      <span className="truncate py-1.5">
                        {showPins && pinned?.has(song.id) && <PinnedMark />}
                        <DeckBadge song={song} />
                        {song.title || t('songs.untitled')}
                      </span>
                    </div>
                  </SongPeek>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {props.footer && <div className="mt-auto">{props.footer}</div>}
      {editingSong && <ItemEditDialog song={editingSong} onClose={() => setEditingSong(null)} />}
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

/** Where dropped files will land: a line above the row it wraps. */
function DropLine(props: { show: boolean; children: ReactNode }) {
  return (
    <>
      {props.show && <DropMark />}
      {props.children}
    </>
  );
}

function DropMark() {
  return <li aria-hidden className="h-0.5 rounded-full bg-sky-400" />;
}

/** A short message over the run sheet, with a button to close it. */
function Note(props: { text: string; onDismiss(): void }) {
  return (
    <p
      className="flex items-start gap-1 rounded-md bg-slate-900/60 px-2 py-1 text-xs text-amber-200"
      role="status"
    >
      <span className="flex-1">{props.text}</span>
      <button
        type="button"
        className="text-slate-400 hover:text-slate-100"
        aria-label={t('media.dismiss')}
        onClick={props.onDismiss}
      >
        ✕
      </button>
    </p>
  );
}
