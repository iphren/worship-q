import {
  OBS_SNAPSHOT_EVERY_MS,
  OBS_SNAPSHOT_STALE_MS,
  liveFavourite,
  outputElapsed,
  switchTarget,
  type ObsCommand,
  type ObsOutput,
  type ObsResult,
  type RemoteObsView,
  type RemoteSongResult,
  type RemoteView,
} from '@worship-q/protocol';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RemoteConnection } from './connection';

const connection = new RemoteConnection(window.location);

export function RemoteApp() {
  const state = useSyncExternalStore(connection.subscribe, () => connection.state);
  useEffect(() => {
    connection.start();
    return () => connection.stop();
  }, []);

  switch (state.kind) {
    case 'name':
      return <NameForm />;
    case 'connecting':
      return <Message title="Connecting…" />;
    case 'pending':
      return (
        <Message title="Waiting for approval">
          <p>Ask the operator to approve this phone. They will see this code:</p>
          <p className="my-6 font-mono text-5xl tracking-[0.3em] text-white">{state.code}</p>
        </Message>
      );
    case 'offline':
      return (
        <Message title="Waiting for presentation">
          <p>The presenting computer is not connected right now. This page reconnects by itself.</p>
        </Message>
      );
    case 'denied':
      return (
        <Message title={state.reason === 'denied' ? 'Not approved' : 'Scan the QR code again'}>
          <p>
            {state.reason === 'denied'
              ? 'The operator did not approve this phone.'
              : state.reason === 'revoked'
                ? 'This phone was disconnected by the operator.'
                : 'This link has expired or was already used. Scan the QR code shown on the presenting computer.'}
          </p>
        </Message>
      );
    case 'no-workspace':
      return (
        <Message title="Presentation not found">This link does not lead to a presentation.</Message>
      );
    case 'update-needed':
      return (
        <Message title="Update needed">
          The presenting computer runs a different version of Worship Q. Update it, then reload.
        </Message>
      );
    case 'live':
      return <Live view={state.view} />;
  }
}

function Message(props: { title: string; children?: ReactNode }) {
  return (
    <main className="flex h-full flex-col items-center justify-center p-8 text-center">
      <h1 className="mb-3 text-xl font-semibold text-white">{props.title}</h1>
      <div className="max-w-sm text-sm text-slate-400">{props.children}</div>
    </main>
  );
}

function NameForm() {
  const [name, setName] = useState('');
  return (
    <main className="flex h-full flex-col items-center justify-center p-8">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) connection.start(name);
        }}
      >
        <h1 className="text-xl font-semibold text-white">Remote control</h1>
        <p className="text-sm text-slate-400">
          Enter your name. The operator sees it when approving this phone.
        </p>
        <input
          autoFocus
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-lg"
          value={name}
          maxLength={40}
          placeholder="Your name"
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className="w-full rounded-lg bg-sky-600 py-3 text-lg font-semibold text-white disabled:opacity-40"
          disabled={!name.trim()}
        >
          Continue
        </button>
      </form>
    </main>
  );
}

function Live({ view }: { view: RemoteView | null }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // Until when a change of the presented slide counts as this phone's Prev or Next, so the
  // page follows only its own moves. Following moves made elsewhere would scroll the page
  // away from what this phone is about to tap.
  const followUntilRef = useRef(0);
  const [activeInView, setActiveInView] = useState(true);
  const [mode, setMode] = useState<'present' | 'edit' | 'add' | 'obs'>('present');
  // The run sheet's items when the search opened; those added since are marked afterwards.
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);
  const connected = connection.connected;
  const presentedItem = view?.presented?.itemId;
  const presentedPiece = view?.presented?.pieceId;
  const loaded = view !== null;
  useEffect(() => {
    if (performance.now() < followUntilRef.current)
      activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    followUntilRef.current = 0;
  }, [presentedItem, presentedPiece]);

  // Offer the locate button while the presented slide is scrolled out of view. The slide list
  // is only there in present mode, so watch again on coming back to it: the slide may have
  // moved while the run sheet was open.
  useEffect(() => {
    const active = activeRef.current;
    const main = mainRef.current;
    setActiveInView(true);
    if (!active || !main) return;
    const observer = new IntersectionObserver(
      ([entry]) => setActiveInView(entry!.intersectionRatio >= 0.5),
      { root: main, threshold: [0, 0.5, 1] },
    );
    observer.observe(active);
    return () => observer.disconnect();
  }, [presentedItem, presentedPiece, loaded, mode]);

  function step(type: 'previous' | 'next') {
    followUntilRef.current = performance.now() + 3000;
    connection.send({ type });
  }

  // The OBS screen closes by itself when OBS stops being shared (O5).
  const hasObs = !!view?.obs;
  useEffect(() => {
    if (!hasObs && mode === 'obs') setMode('present');
  }, [hasObs, mode]);

  if (!view) return <Message title="Connecting…" />;
  const canEdit = view.editable === true;
  const editing = mode === 'edit' || mode === 'add';
  const control = `rounded-xl py-4 font-semibold active:scale-[0.98] disabled:opacity-40 ${
    canEdit ? 'text-base' : 'text-lg'
  }`;

  function openSearch() {
    if (mode !== 'add') setBefore(new Set(view!.items.map((item) => item.itemId)));
    setMode('add');
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-white">{view.workspaceName}</h1>
          <p className="text-xs text-slate-400">
            {view.status === 'live' && view.date ? runSheetName(view.date) : 'Presentation ended'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              connected ? 'bg-emerald-800 text-emerald-100' : 'bg-amber-800 text-amber-100'
            }`}
            title={
              connection.via === 'lan' ? 'On this network' : 'Connected through the church server'
            }
          >
            {connected ? 'Connected' : 'Reconnecting…'}
          </span>
          {mode === 'obs' && (
            <button
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white"
              onClick={() => setMode('present')}
            >
              Done
            </button>
          )}
          {(canEdit || editing) && mode !== 'obs' && (
            <button
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                editing ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200'
              }`}
              onClick={() => {
                setMode(editing ? 'present' : 'edit');
                setBefore(null);
              }}
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
      </header>

      {view.obs && (
        <ObsRow
          obs={view.obs}
          connected={connected}
          open={mode === 'obs'}
          onToggle={() => setMode(mode === 'obs' ? 'present' : 'obs')}
        />
      )}

      {view.previousContent && (
        <p className="border-b border-amber-700 bg-amber-900/40 px-4 py-2 text-xs text-amber-100">
          Still presenting previous content until you choose a slide.
        </p>
      )}

      {mode === 'obs' && view.obs ? (
        <ObsScreen obs={view.obs} connected={connected} />
      ) : mode === 'add' ? (
        <AddSongs view={view} connected={connected && canEdit} onDone={() => setMode('edit')} />
      ) : mode === 'edit' ? (
        <EditRunSheet
          view={view}
          connected={connected && canEdit}
          before={before}
          onAdd={openSearch}
        />
      ) : (
        <div className="relative min-h-0 flex-1">
          <main ref={mainRef} className="h-full space-y-9 overflow-y-auto px-3 py-4">
            {view.items.length === 0 && (
              <p className="p-6 text-center text-sm text-slate-400">
                The run sheet has no items yet.
              </p>
            )}
            {view.items.map((item) => (
              <section key={item.itemId}>
                <h2 className="mb-3 px-1 text-xl font-semibold text-white">
                  {item.title || 'Untitled'}
                </h2>
                <div
                  className={`grid gap-2 ${item.pieces.some((p) => p.thumbnail) ? 'grid-cols-2' : ''}`}
                >
                  {item.pieces.map((piece) => {
                    const active =
                      view.presented?.itemId === item.itemId && view.presented.pieceId === piece.id;
                    // Where the item left off; not on the item on screen or a one-slide item.
                    const lastShown =
                      item.pieces.length > 1 &&
                      view.presented?.itemId !== item.itemId &&
                      view.lastShown?.[item.itemId] === piece.id;
                    return (
                      <button
                        key={piece.id}
                        ref={active ? activeRef : undefined}
                        disabled={!connected}
                        onClick={() =>
                          connection.send({
                            type: 'playPiece',
                            itemId: item.itemId,
                            pieceId: piece.id,
                          })
                        }
                        className={`relative rounded-lg border text-left text-[15px] leading-snug ${piece.thumbnail ? 'p-1' : 'px-3 py-2'} ${
                          active
                            ? view.blank
                              ? 'border-amber-400 bg-amber-900/50'
                              : 'border-emerald-500 bg-emerald-900/50 text-white'
                            : // Alternate styles by block, as on the desktop.
                              (piece.block ?? 0) % 2 === 0
                              ? 'border-slate-700 bg-slate-900'
                              : 'border-sky-700 bg-sky-900/60'
                        }`}
                      >
                        {lastShown && (
                          <span className="pointer-events-none absolute -top-px -right-px z-10 rounded-tr-lg rounded-bl-lg bg-slate-600 px-2 text-[11px] leading-5 font-semibold text-slate-100">
                            Last shown
                          </span>
                        )}
                        {piece.thumbnail ? (
                          <img
                            src={`/api/v1/remote/files/${encodeURIComponent(connection.workspace)}/${encodeURIComponent(piece.thumbnail)}`}
                            alt={piece.lines.join(' ')}
                            loading="lazy"
                            // Hold the slide's space before the image loads, so a scroll to the
                            // presented slide is not thrown short by thumbnails loading on the way.
                            className="block aspect-video w-full rounded object-contain"
                          />
                        ) : (
                          piece.lines.map((line, index) => <div key={index}>{line || ' '}</div>)
                        )}
                      </button>
                    );
                  })}
                  {item.pieces.length === 0 && (
                    <p className="px-1 text-xs text-slate-500">This item has no content.</p>
                  )}
                </div>
              </section>
            ))}
          </main>
          {view.presented && !activeInView && (
            <button
              aria-label="Go to current slide"
              onClick={() =>
                activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }
              className={`absolute right-4 bottom-4 flex h-12 w-12 items-center justify-center rounded-full border bg-slate-900/90 shadow-lg shadow-black/50 active:scale-95 ${
                view.blank
                  ? 'border-amber-400 text-amber-300'
                  : 'border-emerald-500 text-emerald-300'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="7" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
            </button>
          )}
        </div>
      )}

      <LiveLine view={view} />

      <footer
        className={`grid gap-2 border-t ${canEdit ? 'grid-cols-5' : 'grid-cols-4'} border-slate-800 bg-slate-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}
      >
        <button
          className={`${control} bg-slate-800`}
          disabled={!connected}
          onClick={() => step('previous')}
        >
          ‹ Prev
        </button>
        <button
          className={`${control} ${view.blank ? 'bg-amber-600 text-white' : 'bg-slate-800'}`}
          disabled={!connected}
          onClick={() => connection.send({ type: view.blank ? 'unblank' : 'blank' })}
        >
          {view.blank ? 'Show' : 'Blank'}
        </button>
        <button
          className={`${control} bg-slate-800`}
          disabled={!connected || (!view.presented && !view.previousContent)}
          onClick={() => connection.send({ type: 'clear' })}
        >
          Clear
        </button>
        {canEdit && (
          <button
            className={`${control} ${mode === 'add' ? 'bg-violet-600 text-white' : 'bg-violet-900 text-violet-100'}`}
            disabled={!connected}
            onClick={openSearch}
          >
            + Add
          </button>
        )}
        <button
          className={`${control} bg-sky-600 text-white`}
          disabled={!connected}
          onClick={() => step('next')}
        >
          Next ›
        </button>
      </footer>
    </div>
  );
}

/**
 * Adding, removing and reordering the live run sheet's songs. Items missing from `before`
 * were added from the search just left, and are marked so the phone shows they arrived.
 */
/**
 * What is on screen, in one line: the lyrics or a slide's text, a slide's place and its
 * item's title when the slide has no text, and the title of anything else.
 */
function liveText(view: RemoteView): string | null {
  if (!view.presented) return null;
  const item = view.items.find((i) => i.itemId === view.presented!.itemId);
  const piece = item?.pieces.find((p) => p.id === view.presented!.pieceId);
  if (!item || !piece) return null;
  const title = item.title || 'Untitled';
  // Desktops that do not send the kind: a thumbnail marks a slide, and anything else is
  // read as lyrics.
  const kind = item.kind ?? (piece.thumbnail ? 'deck' : 'lyrics');
  const lines = piece.lines.join(' ').replace(/\s+/g, ' ').trim();
  if (kind === 'lyrics') return lines || title;
  if (kind === 'deck') {
    if (piece.textless || !lines) return `Slide ${(piece.block ?? 0) + 1} · ${title}`;
    return lines;
  }
  return title;
}

function LiveLine({ view }: { view: RemoteView }) {
  const text = liveText(view);
  // Coloured like the presented slide in the list, so it stands out on every page.
  const tone =
    text === null
      ? 'border-slate-600 bg-slate-800 text-slate-300'
      : view.blank
        ? 'border-amber-500 bg-amber-900 text-amber-100'
        : 'border-emerald-500 bg-emerald-800 text-white';
  return (
    <div className={`flex items-center gap-2 border-t px-4 py-2.5 text-[15px] font-medium ${tone}`}>
      {view.blank && (
        <span className="shrink-0 rounded bg-amber-500 px-1.5 text-[11px] font-semibold text-amber-950">
          Blank
        </span>
      )}
      <p className="min-w-0 flex-1 truncate">
        {text ??
          (view.previousContent ? 'A slide from the previous run sheet' : 'Nothing on screen')}
      </p>
    </div>
  );
}

function EditRunSheet(props: {
  view: RemoteView;
  connected: boolean;
  before: ReadonlySet<string> | null;
  onAdd(): void;
}) {
  const { view, connected, before } = props;
  const firstNewRef = useRef<HTMLLIElement>(null);
  // A remove waits for a second tap, so a slip of the finger does not take a song out.
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    if (!removing) return;
    const timer = setTimeout(() => setRemoving(null), 4000);
    return () => clearTimeout(timer);
  }, [removing]);

  const { items } = view;
  const isNew = (itemId: string) => before !== null && !before.has(itemId);
  const firstNew = items.find((item) => isNew(item.itemId))?.itemId;
  // Shows the added songs, also when the phone hears of them just after the search closed.
  useEffect(() => {
    if (firstNew) firstNewRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [firstNew]);
  const button =
    'h-10 w-10 shrink-0 rounded-lg bg-slate-800 text-lg active:scale-95 disabled:opacity-30';

  return (
    <main className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-indigo-950 px-3 py-4">
      {items.length === 0 && (
        <p className="p-6 text-center text-sm text-slate-400">The run sheet has no items yet.</p>
      )}
      <ol className="space-y-2">
        {items.map((item, index) => (
          <li
            key={item.itemId}
            ref={item.itemId === firstNew ? firstNewRef : undefined}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
              view.presented?.itemId === item.itemId
                ? 'border-emerald-500 bg-emerald-900/40'
                : isNew(item.itemId)
                  ? 'border-sky-500 bg-sky-900/40'
                  : 'border-slate-700 bg-slate-900'
            }`}
          >
            <span className="w-5 shrink-0 text-right text-xs text-slate-500">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[15px] text-white">
              {item.title || 'Untitled'}
            </span>
            {isNew(item.itemId) && (
              <span className="shrink-0 rounded bg-sky-700 px-1.5 text-[11px] font-semibold text-white">
                New
              </span>
            )}
            <button
              aria-label="Move up"
              className={button}
              disabled={!connected || index === 0}
              onClick={() =>
                connection.send({
                  type: 'moveItem',
                  itemId: item.itemId,
                  afterItemId: index >= 2 ? items[index - 2]!.itemId : null,
                })
              }
            >
              ↑
            </button>
            <button
              aria-label="Move down"
              className={button}
              disabled={!connected || index === items.length - 1}
              onClick={() =>
                connection.send({
                  type: 'moveItem',
                  itemId: item.itemId,
                  afterItemId: items[index + 1]!.itemId,
                })
              }
            >
              ↓
            </button>
            {removing === item.itemId ? (
              <button
                className="h-10 shrink-0 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white active:scale-95"
                disabled={!connected}
                onClick={() => {
                  setRemoving(null);
                  connection.send({ type: 'removeItem', itemId: item.itemId });
                }}
              >
                Remove
              </button>
            ) : (
              <button
                aria-label="Remove"
                className={button}
                disabled={!connected}
                onClick={() => setRemoving(item.itemId)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ol>
      <button
        className="w-full rounded-lg border border-dashed border-violet-700 py-3 text-[15px] font-semibold text-violet-300 active:scale-[0.98] disabled:opacity-40"
        disabled={!connected}
        onClick={props.onAdd}
      >
        + Add an item
      </button>
    </main>
  );
}

const KIND_LABEL: Record<RemoteSongResult['kind'], string | null> = {
  lyrics: null,
  deck: 'Slides',
  website: 'Website',
};

/** The library search, as on the presenting computer, adding songs to the live run sheet. */
function AddSongs(props: { view: RemoteView; connected: boolean; onDone(): void }) {
  const { view, connected } = props;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; songs: RemoteSongResult[] } | null>(null);
  // Titles of the songs added from this search, so the phone shows each one worked.
  const [added, setAdded] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const search = query.trim();
    if (!search) return setResults(null);
    let current = true;
    const timer = setTimeout(() => {
      void connection.search(search).then((songs) => {
        if (current) setResults({ query: search, songs });
      });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, connected]);

  // Results for an earlier query stay shown, dimmed, until the answer for this one comes.
  const searching = query.trim() !== '' && results?.query !== query.trim();
  const presented = view.presented?.itemId;
  function add(song: RemoteSongResult, next: boolean) {
    connection.send(
      next && presented
        ? { type: 'addItem', songId: song.id, afterItemId: presented }
        : { type: 'addItem', songId: song.id },
    );
    setAdded((list) => [...list, song.title || 'Untitled']);
    // Ready for the next song. Focusing while handling the tap keeps the phone's keyboard up.
    setQuery('');
    inputRef.current?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 border-b border-slate-800 p-3">
        <input
          ref={inputRef}
          autoFocus
          type="search"
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base"
          placeholder="Search library to add"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="rounded-lg bg-slate-800 px-3 text-sm font-semibold"
          onClick={props.onDone}
        >
          Back
        </button>
      </div>
      {searching && (
        <p
          role="status"
          className="flex items-center gap-2 border-b border-slate-800 px-4 py-2 text-sm text-slate-300"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin text-sky-400" fill="none">
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="3"
            />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          Searching the library…
        </p>
      )}
      <ul
        className={`min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 transition-opacity ${
          searching ? 'opacity-50' : ''
        }`}
      >
        {!query.trim() && added.length > 0 && (
          <li role="status" className="p-6 text-center text-sm text-emerald-300">
            Added “{added[added.length - 1]}” to the run sheet.
            {added.length > 1 && (
              <span className="mt-1 block text-xs text-slate-400">
                {added.length} items added. Search for another, or tap Back to see the run sheet.
              </span>
            )}
          </li>
        )}
        {results?.songs.length === 0 && !searching && (
          <li className="p-6 text-center text-sm text-slate-400">Nothing found.</li>
        )}
        {results?.songs.map((song) => {
          const label = KIND_LABEL[song.kind];
          return (
            <li key={song.id} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="mb-1 flex items-baseline gap-2">
                {label && (
                  <span className="shrink-0 rounded bg-slate-700 px-1.5 text-[11px] text-slate-200">
                    {label}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">
                  {song.title || 'Untitled'}
                </span>
              </div>
              {song.preview.length > 0 && (
                <p className="mb-2 line-clamp-2 text-xs text-slate-400">
                  {song.preview.join(' / ')}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-40"
                  disabled={!connected}
                  onClick={() => add(song, false)}
                >
                  Add to end
                </button>
                {presented && (
                  <button
                    className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-40"
                    disabled={!connected}
                    onClick={() => add(song, true)}
                  >
                    Add after current
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ORDINAL_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });

/** A run sheet's name, such as "Sunday 1st Nov". */
function runSheetName(date: string): string {
  const day = Number(date.slice(8, 10));
  const name = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en', { timeZone: 'UTC', ...options }).format(
      new Date(`${date}T00:00:00Z`),
    );
  return `${name({ weekday: 'long' })} ${day}${ORDINAL_SUFFIX[ordinalRules.select(day)]} ${name({ month: 'short' })}`;
}

// ── OBS (OBS control plan M4, M5.2) ─────────────────────────────────────────

const OBS_ERROR_TEXT: Record<string, string> = {
  'no-obs': 'No computer controls OBS.',
  'not-connected': 'OBS is not connected.',
  timeout: 'OBS did not answer.',
  'owner-left': 'The OBS computer left before answering.',
};

function obsError(result: ObsResult): string {
  return (result.error && OBS_ERROR_TEXT[result.error]) || `OBS: ${result.error ?? result.code}`;
}

function obsStatusText(obs: RemoteObsView): string {
  if (!obs.reachable) return 'OBS cannot be reached from here';
  switch (obs.status) {
    case 'connected':
      return 'OBS connected';
    case 'connecting':
      return 'Connecting to OBS…';
    case 'not-running':
      return 'OBS is not running';
    case 'refused':
      return 'OBS refused the connection';
  }
}

function ObsDot({ obs }: { obs: RemoteObsView }) {
  const color = !obs.reachable
    ? 'bg-slate-500'
    : obs.status === 'connected'
      ? 'bg-emerald-400'
      : obs.status === 'refused'
        ? 'bg-rose-500'
        : obs.status === 'connecting'
          ? 'bg-amber-400'
          : 'bg-slate-500';
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />;
}

/** Runs one OBS command at a time, keeping its failure to show for a while. */
function useObsCommand() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (command: ObsCommand) => {
    setPending(true);
    setError(null);
    const result = await connection.obsCommand(command);
    setPending(false);
    if (!result.ok) {
      setError(obsError(result));
      setTimeout(() => setError(null), 6000);
    }
  };
  return { pending, error, run };
}

/**
 * The switch button (O4) in a slim row of its own under the header, which exists only while
 * OBS is shared, so the slide controls keep their places; with the way to the OBS screen
 * beside it.
 */
function ObsRow(props: {
  obs: RemoteObsView;
  connected: boolean;
  open: boolean;
  onToggle(): void;
}) {
  const { obs } = props;
  const command = useObsCommand();
  const target = switchTarget(obs);
  const live = liveFavourite(obs);
  const usable = props.connected && obs.reachable && obs.status === 'connected';
  return (
    <div className="border-b border-slate-800 bg-slate-950 px-3 py-1.5">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          className={`flex min-w-0 items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-semibold active:scale-[0.98] disabled:opacity-40 ${
            live !== null ? 'bg-sky-900 text-sky-100' : 'bg-slate-800'
          }`}
          disabled={!usable || !target || command.pending}
          onClick={() => target && void command.run({ type: 'setScene', scene: target })}
        >
          <ObsDot obs={obs} />
          <span className="truncate">
            {target ? `⇄ ${target}` : 'Choose scenes on the OBS computer'}
          </span>
        </button>
        <button
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold active:scale-[0.98] ${
            props.open ? 'bg-sky-600 text-white' : 'bg-slate-800'
          }`}
          onClick={props.onToggle}
        >
          OBS
        </button>
      </div>
      {command.error && <p className="pt-1 text-xs text-rose-300">{command.error}</p>}
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(total % 60)}` : `${m}:${two(total % 60)}`;
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

const OUTPUTS = [
  { kind: 'stream', label: 'Stream', start: 'startStream', stop: 'stopStream' },
  { kind: 'record', label: 'Record', start: 'startRecord', stop: 'stopRecord' },
  { kind: 'virtualCam', label: 'Virtual camera', start: 'startVirtualCam', stop: 'stopVirtualCam' },
] as const;

function outputText(output: ObsOutput, elapsed: number | null): string {
  if (output.phase === 'starting') return 'Starting…';
  if (output.phase === 'stopping') return 'Stopping…';
  if (output.phase === 'reconnecting') return 'Reconnecting…';
  if (!output.active) return 'Off';
  const time = elapsed !== null ? formatDuration(elapsed) : 'On';
  return output.paused ? `${time} · Paused` : time;
}

/** The OBS screen (M4.2): the live monitor, the scenes and the outputs. */
function ObsScreen(props: { obs: RemoteObsView; connected: boolean }) {
  const { obs } = props;
  const command = useObsCommand();
  const [confirming, setConfirming] = useState<string | null>(null);
  const image = useSyncExternalStore(connection.subscribeImage, () => connection.obsImage);
  const now = useNow(1000);
  const usable = props.connected && obs.reachable && obs.status === 'connected';

  // Images come only while this screen is open (O6).
  useEffect(() => {
    connection.obsWatch(true);
    return () => connection.obsWatch(false);
  }, []);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const age = image ? now - image.receivedAt : null;
  const stale = age !== null && age > OBS_SNAPSHOT_STALE_MS;

  return (
    <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <ObsDot obs={obs} />
        <span className="flex-1 truncate">{obsStatusText(obs)}</span>
        <span className="truncate text-xs text-slate-500">{obs.ownerName}</span>
      </div>

      <figure>
        <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
          {image ? (
            <img
              src={image.image}
              alt="Program"
              className={`h-full w-full object-contain ${stale ? 'opacity-50' : ''}`}
            />
          ) : (
            <p className="flex h-full items-center justify-center text-xs text-slate-500">
              {usable ? 'Waiting for an image…' : ''}
            </p>
          )}
          {/* Sweeps in from the left and out to the right between images. */}
          {image && !stale && (
            <span
              key={image.receivedAt}
              className="monitor-refresh pointer-events-none absolute bottom-0 left-0 h-1 w-1/3 bg-sky-400/80"
              style={{ animationDuration: `${OBS_SNAPSHOT_EVERY_MS}ms` }}
              aria-hidden="true"
            />
          )}
        </div>
        {stale && (
          <figcaption className="pt-1 text-right text-xs text-amber-300">
            From {Math.round((age ?? 0) / 1000)} s ago
          </figcaption>
        )}
      </figure>

      <section className="space-y-2">
        {OUTPUTS.map(({ kind, label, start, stop }) => {
          const output = obs[kind];
          const running = output.active && output.phase !== 'stopping';
          const elapsed = outputElapsed(output, connection.viewReceivedAt, now);
          // Stopping a stream or recording asks for a second tap; the camera does not.
          const needsConfirm = kind !== 'virtualCam';
          return (
            <div
              key={kind}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${output.active ? 'bg-rose-500' : 'bg-slate-600'}`}
              />
              <span className="flex-1">
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-slate-400 tabular-nums">
                  {outputText(output, elapsed)}
                </span>
              </span>
              <button
                className={`rounded-lg px-4 py-2 text-sm font-semibold active:scale-[0.98] disabled:opacity-40 ${
                  running ? 'bg-rose-700 text-white' : 'bg-slate-700'
                }`}
                disabled={!usable || command.pending || output.phase !== null}
                onClick={() => {
                  if (!running) return void command.run({ type: start });
                  if (needsConfirm && confirming !== kind) return setConfirming(kind);
                  setConfirming(null);
                  void command.run({ type: stop });
                }}
              >
                {running ? (confirming === kind ? 'Tap to stop' : 'Stop') : 'Start'}
              </button>
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Scenes
        </h2>
        {obs.scenes.length === 0 && (
          <p className="text-sm text-slate-500">The scenes appear once OBS is connected.</p>
        )}
        <ul className="space-y-2">
          {obs.scenes.map((scene) => {
            const live = scene === obs.currentScene;
            return (
              <li key={scene}>
                <button
                  className={`flex w-full items-center gap-2 rounded-xl border-2 px-4 py-3 text-left active:scale-[0.99] disabled:opacity-60 ${
                    live ? 'border-emerald-500 bg-emerald-900/40' : 'border-slate-800 bg-slate-900'
                  }`}
                  disabled={!usable || command.pending || live}
                  onClick={() => void command.run({ type: 'setScene', scene })}
                >
                  <span className="min-w-0 flex-1 truncate">{scene}</span>
                  {live && <span className="text-xs font-semibold text-emerald-300">Live</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {command.error && <p className="text-sm text-rose-300">{command.error}</p>}
    </main>
  );
}
