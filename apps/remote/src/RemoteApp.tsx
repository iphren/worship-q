import {
  formatReference,
  itemBadge,
  songSearchReference,
  typedWebsiteUrl,
  OBS_SNAPSHOT_EVERY_MS,
  OBS_SNAPSHOT_STALE_MS,
  OBS_TRANSITION_LOCK_MS,
  outputElapsed,
  switchTarget,
  type ItemBadge,
  type ObsCommand,
  type ObsOutput,
  type ObsResult,
  type RemoteItemView,
  type RemoteObsView,
  type RemoteSongResult,
  type RemoteView,
} from '@worship-q/protocol';
import { ControlIcon, ItemBadgeMark, Marquee } from '@worship-q/ui';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PassageColumns, PhoneBible } from './Bible';
import { PhoneListen, phoneDelayText, phoneListenText } from './audio';
import { RemoteConnection } from './connection';
import { LanguageButton } from './Language';
import { formatDate, t, type MessageKey } from '@worship-q/i18n/remote';

const connection = new RemoteConnection(window.location);
const listen = new PhoneListen(connection);

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
      return <Message title={t('connect.connecting')} />;
    case 'pending':
      return (
        <Message title={t('connect.pendingTitle')}>
          <p>{t('connect.pending')}</p>
          <p className="my-6 font-mono text-5xl tracking-[0.3em] text-white">{state.code}</p>
        </Message>
      );
    case 'offline':
      return (
        <Message title={t('connect.offlineTitle')}>
          <p>{t('connect.offline')}</p>
        </Message>
      );
    case 'denied':
      return (
        <Message
          title={t(state.reason === 'denied' ? 'connect.deniedTitle' : 'connect.expiredTitle')}
        >
          <p>
            {t(
              state.reason === 'denied'
                ? 'connect.denied'
                : state.reason === 'revoked'
                  ? 'connect.revoked'
                  : 'connect.expired',
            )}
          </p>
        </Message>
      );
    case 'no-workspace':
      return <Message title={t('connect.notFoundTitle')}>{t('connect.notFound')}</Message>;
    case 'update-needed':
      return <Message title={t('connect.updateTitle')}>{t('connect.update')}</Message>;
    case 'full':
      return (
        <Message title={t('connect.fullTitle')}>
          <p>{t('connect.full', { limit: state.limit })}</p>
        </Message>
      );
    case 'live':
      return <Live view={state.view} />;
  }
}

/**
 * A slide's small image sent by the desktop (public server S7): asked for only once it is
 * on screen, holding its space meanwhile; the slide's text when the desktop has none.
 */
function HostThumbnail(props: { name: string; alt: string; fallback: string[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    let cancelled = false;
    const ask = () =>
      void connection.thumbnail(props.name).then((answer) => {
        if (!cancelled) setUrl(answer);
      });
    if (typeof IntersectionObserver === 'undefined') {
      ask();
      return () => void (cancelled = true);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        ask();
      }
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [props.name]);
  if (url === null) {
    return (
      <div className="px-2 py-1">
        {props.fallback.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    );
  }
  return (
    <div ref={holder} className="block aspect-video w-full rounded">
      {url && <img src={url} alt={props.alt} className="h-full w-full rounded object-contain" />}
    </div>
  );
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
        <h1 className="text-xl font-semibold text-white">{t('name.title')}</h1>
        <p className="text-sm text-slate-400">{t('name.hint')}</p>
        <input
          autoFocus
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-lg"
          value={name}
          maxLength={40}
          placeholder={t('name.placeholder')}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className="w-full rounded-lg bg-sky-600 py-3 text-lg font-semibold text-white disabled:opacity-40"
          disabled={!name.trim()}
        >
          {t('name.continue')}
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
  const [mode, setMode] = useState<'present' | 'edit' | 'add' | 'bible'>('present');
  // A reference typed into the library search, which the Bible screen opens on.
  const [bibleFrom, setBibleFrom] = useState<string | undefined>(undefined);
  // The OBS screen opens over whichever of the others was showing, which stays as it was
  // underneath (its search, its scroll) and comes back when the screen closes.
  const [obsOpen, setObsOpen] = useState(false);
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
    if (!hasObs) setObsOpen(false);
  }, [hasObs]);

  if (!view) return <Message title={t('connect.connecting')} />;
  const canEdit = view.editable === true;
  const editing = mode === 'edit' || mode === 'add' || mode === 'bible';
  const control =
    'flex items-center justify-center rounded-xl py-4 font-semibold active:scale-[0.98] disabled:opacity-40';
  const controlIcon = 'h-6 w-6';

  function openSearch() {
    if (mode !== 'add') setBefore(new Set(view!.items.map((item) => item.itemId)));
    setMode('add');
    setObsOpen(false);
  }

  return (
    // Upright, everything is one column; on a phone on its side (`land`), the slides take the
    // left and the controls a rail on the right. The two halves are `contents` when upright, so
    // their parts sit in the one column, the slides' parts (order-1) between the rail's rows at
    // the top and its controls (order-2) at the bottom. Nothing remounts on turning the phone.
    <div className="flex h-full flex-col land:flex-row">
      <div className="contents land:flex land:min-w-0 land:flex-1 land:flex-col land:pl-[env(safe-area-inset-left)]">
        {view.previousContent && (
          <p className="order-1 border-b border-amber-700 bg-amber-900/40 px-4 py-2 text-xs text-amber-100">
            {t('live.previousContent')}
          </p>
        )}

        {/* The OBS screen covers the others rather than replacing them, so they keep their
            search and scroll position underneath. */}
        <div className="relative order-1 flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col" inert={obsOpen && !!view.obs}>
            {mode === 'bible' ? (
              <PhoneBible
                connection={connection}
                connected={connected && canEdit}
                initial={bibleFrom}
                onDone={() => setMode('edit')}
              />
            ) : mode === 'add' ? (
              <AddSongs
                view={view}
                connected={connected && canEdit}
                onDone={() => setMode('edit')}
                onOpenBible={(text) => {
                  setBibleFrom(text);
                  setMode('bible');
                }}
              />
            ) : mode === 'edit' ? (
              <EditRunSheet
                view={view}
                connected={connected && canEdit}
                before={before}
                onAdd={openSearch}
                onBible={() => {
                  setBefore(new Set(view.items.map((item) => item.itemId)));
                  setBibleFrom(undefined);
                  setMode('bible');
                  setObsOpen(false);
                }}
              />
            ) : (
              <div className="relative min-h-0 flex-1">
                <main
                  ref={mainRef}
                  className="h-full space-y-9 overflow-y-auto px-3 py-4 land:space-y-6 land:py-3"
                >
                  {view.items.length === 0 && (
                    <p className="p-6 text-center text-sm text-slate-400">{t('live.empty')}</p>
                  )}
                  {view.items.map((item) => (
                    <section key={item.itemId}>
                      <h2 className="mb-3 flex items-center gap-2 px-1 text-xl font-semibold text-white">
                        <ItemMark item={item} />
                        <span className="min-w-0">{item.title || t('live.untitled')}</span>
                      </h2>
                      <div
                        className={`grid gap-2 ${item.pieces.some((p) => p.thumbnail) ? 'grid-cols-2 land:grid-cols-3' : 'land:grid-cols-2'}`}
                      >
                        {item.pieces.map((piece) => {
                          const active =
                            view.presented?.itemId === item.itemId &&
                            view.presented.pieceId === piece.id;
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
                                  : // A song's blocks alternate, as on the desktop; slides,
                                    // passages and the rest are drawn alike.
                                    !shadesBlocks(item) || (piece.block ?? 0) % 2 === 0
                                    ? 'border-slate-700 bg-slate-900'
                                    : 'border-sky-700 bg-sky-900/60'
                              }`}
                            >
                              {lastShown && (
                                <span className="pointer-events-none absolute -top-px -right-px z-10 rounded-tr-lg rounded-bl-lg bg-slate-600 px-2 text-[11px] leading-5 font-semibold text-slate-100">
                                  {t('live.lastShown')}
                                </span>
                              )}
                              {piece.thumbnail && view?.thumbnailVia === 'host' ? (
                                <HostThumbnail
                                  name={piece.thumbnail}
                                  alt={piece.lines.join(' ')}
                                  fallback={piece.lines}
                                />
                              ) : piece.thumbnail ? (
                                <img
                                  src={`/api/v1/remote/files/${encodeURIComponent(connection.workspace)}/${encodeURIComponent(piece.thumbnail)}`}
                                  alt={piece.lines.join(' ')}
                                  loading="lazy"
                                  // Hold the slide's space before the image loads, so a scroll to the
                                  // presented slide is not thrown short by thumbnails loading on the way.
                                  className="block aspect-video w-full rounded object-contain"
                                />
                              ) : item.kind === 'video' ? (
                                <div>▶ {t('live.video', { title: piece.lines[0] ?? '' })}</div>
                              ) : piece.passage ? (
                                <PassageColumns columns={piece.passage.columns} />
                              ) : (
                                piece.lines.map((line, index) => (
                                  <div key={index}>{line || ' '}</div>
                                ))
                              )}
                            </button>
                          );
                        })}
                        {item.pieces.length === 0 && (
                          <p className="px-1 text-xs text-slate-500">{t('live.noContent')}</p>
                        )}
                      </div>
                    </section>
                  ))}
                </main>
                {view.presented && !activeInView && (
                  <button
                    aria-label={t('live.goToCurrent')}
                    onClick={() =>
                      activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                    }
                    className={`absolute right-4 bottom-4 z-10 flex h-12 w-12 items-center justify-center rounded-full border bg-slate-900/90 shadow-lg shadow-black/50 active:scale-95 ${
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
          </div>
          {obsOpen && view.obs && (
            <div className={`absolute inset-0 z-20 flex flex-col ${OBS_BACKGROUND}`}>
              <ObsScreen obs={view.obs} connected={connected} />
            </div>
          )}
        </div>

        {/* While a video is live, its controls stand in for the line of what is on screen. */}
        <div className="order-1">
          {view.video ? (
            <VideoBar video={view.video} connected={connected} view={view} />
          ) : (
            <LiveLine view={view} />
          )}
        </div>
      </div>

      <div className="contents land:flex land:w-[300px] land:shrink-0 land:flex-col land:gap-1.5 land:border-l land:border-slate-800 land:py-2 land:pr-[max(0.625rem,env(safe-area-inset-right))] land:pb-[max(0.5rem,env(safe-area-inset-bottom))] land:pl-2.5">
        <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-3 land:border-0 land:p-0">
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-white land:text-sm">{view.workspaceName}</h1>
            <p className="text-xs text-slate-400 land:text-[11px]">
              {view.status === 'live' && view.date ? formatDate(view.date) : t('live.ended')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* On a phone on its side, a dot that says the same. */}
            <span
              className={`rounded-full px-2 py-0.5 text-xs land:h-2.5 land:w-2.5 land:p-0 ${
                connected
                  ? 'bg-emerald-800 text-emerald-100 land:bg-emerald-400'
                  : 'bg-amber-800 text-amber-100 land:bg-amber-400'
              }`}
              title={t(connection.via === 'lan' ? 'live.viaLan' : 'live.viaServer')}
            >
              <span className="land:sr-only">
                {t(connected ? 'live.connected' : 'live.reconnecting')}
              </span>
            </span>
            <LanguageButton />
            {/* Disabled while the OBS screen covers the run sheet; it closes from the OBS button. */}
            {(canEdit || editing) && (
              <button
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-40 ${
                  editing ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200'
                }`}
                disabled={obsOpen}
                onClick={() => {
                  setMode(editing ? 'present' : 'edit');
                  setBefore(null);
                }}
              >
                {t(editing ? 'live.done' : 'live.edit')}
              </button>
            )}
          </div>
        </header>

        <div className="contents land:flex land:gap-1.5">
          <AudioRow audio={view.audio ?? null} beside={!!view.obs} />
          {view.obs && (
            <ObsRow
              obs={view.obs}
              connected={connected}
              open={obsOpen}
              onToggle={() => setObsOpen(!obsOpen)}
            />
          )}
        </div>

        {/* On a phone on its side: Blank, Clear and Add in a row, and Previous and Next under
          them, big, where the right thumb rests. */}
        <footer
          className={`order-2 grid gap-2 border-t ${canEdit ? 'grid-cols-5 land:grid-cols-3' : 'grid-cols-4 land:grid-cols-2'} border-slate-800 bg-slate-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] land:flex-1 land:grid-rows-[3rem_1fr] land:gap-1.5 land:border-0 land:bg-transparent land:p-0`}
        >
          <button
            className={`${control} bg-slate-800 land:col-start-1 land:row-start-2`}
            disabled={!connected}
            title={t('controls.previous')}
            aria-label={t('controls.previous')}
            onClick={() => step('previous')}
          >
            <ControlIcon name="previous" className={`${controlIcon} land:h-8 land:w-8`} />
          </button>
          <button
            className={`${control} land:row-start-1 ${view.blank ? 'bg-amber-600 text-white' : 'bg-slate-800'}`}
            disabled={!connected}
            title={t(view.blank ? 'controls.show' : 'controls.blank')}
            aria-label={t(view.blank ? 'controls.show' : 'controls.blank')}
            aria-pressed={view.blank}
            onClick={() => connection.send({ type: view.blank ? 'unblank' : 'blank' })}
          >
            <ControlIcon name="blank" className={controlIcon} />
          </button>
          <button
            className={`${control} bg-slate-800 land:row-start-1`}
            disabled={!connected || (!view.presented && !view.previousContent)}
            title={t('controls.clear')}
            aria-label={t('controls.clear')}
            onClick={() => connection.send({ type: 'clear' })}
          >
            <ControlIcon name="clear" className={controlIcon} />
          </button>
          {canEdit && (
            <button
              className={`${control} land:row-start-1 ${mode === 'add' && !obsOpen ? 'bg-violet-600 text-white' : 'bg-violet-900 text-violet-100'}`}
              disabled={!connected}
              title={t('controls.add')}
              aria-label={t('controls.add')}
              onClick={openSearch}
            >
              <ControlIcon name="addToList" className={controlIcon} />
            </button>
          )}
          <button
            className={`${control} bg-sky-600 text-white land:row-start-2 ${canEdit ? 'land:col-span-2' : ''}`}
            disabled={!connected}
            title={t('controls.next')}
            aria-label={t('controls.next')}
            onClick={() => step('next')}
          >
            <ControlIcon name="next" className={`${controlIcon} land:h-8 land:w-8`} />
          </button>
        </footer>
      </div>
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
  const title = item.title || t('live.untitled');
  // Desktops that do not send the kind: a thumbnail marks a slide, and anything else is
  // read as lyrics.
  const kind = item.kind ?? (piece.thumbnail ? 'deck' : 'lyrics');
  const lines = piece.lines.join(' ').replace(/\s+/g, ' ').trim();
  if (kind === 'lyrics') return lines || title;
  if (kind === 'deck') {
    if (piece.textless || !lines) return t('live.slide', { number: (piece.block ?? 0) + 1, title });
    return lines;
  }
  return title;
}

/** Seconds as `m:ss`. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The phone's control bar while a video item is live (media uploads M6.6), in place of the
 * line of what is on screen: play or pause, 10 s jumps, the video's title and a scrubber, sent
 * to the operator's computer like any other command.
 */
function VideoBar(props: {
  video: NonNullable<RemoteView['video']>;
  connected: boolean;
  view: RemoteView;
}) {
  const { video, connected, view } = props;
  const [now, setNow] = useState(() => Date.now());
  const [dragging, setDragging] = useState<number | null>(null);
  useEffect(() => {
    if (!video.playing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [video.playing]);
  const elapsed = video.playing ? Math.max(0, (now - Date.parse(video.at)) / 1000) : 0;
  const position = dragging ?? Math.min(video.durationSeconds, video.position + elapsed);
  const seek = (seconds: number) =>
    connection.send({ type: 'videoSeek', itemId: video.itemId, seconds });
  const button =
    'flex h-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 px-2.5 active:scale-95 disabled:opacity-40';
  return (
    <div className="flex items-center gap-1.5 border-t border-violet-800 bg-violet-950 px-3 py-2 text-violet-50 land:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <button
        className={button}
        disabled={!connected}
        aria-label={t('video.back')}
        onClick={() => seek(position - 10)}
      >
        <ControlIcon name="back10" className="h-6 w-6" />
      </button>
      <button
        className={`${button} min-w-14 bg-violet-600 text-white`}
        disabled={!connected}
        aria-label={t(video.playing ? 'video.pause' : 'video.play')}
        onClick={() =>
          connection.send({
            type: video.playing ? 'videoPause' : 'videoPlay',
            itemId: video.itemId,
          })
        }
      >
        <ControlIcon name={video.playing ? 'pause' : 'play'} className="h-6 w-6" />
      </button>
      <button
        className={button}
        disabled={!connected}
        aria-label={t('video.forward')}
        onClick={() => seek(position + 10)}
      >
        <ControlIcon name="forward10" className="h-6 w-6" />
      </button>
      <div className="ml-1.5 min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          {view.blank && (
            <span className="shrink-0 rounded bg-amber-500 px-1.5 text-[11px] font-semibold text-amber-950">
              {t('controls.blankBadge')}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{liveText(view) ?? t('video.title')}</span>
          <span className="shrink-0 text-xs text-violet-200 tabular-nums">
            {clock(position)} / {clock(video.durationSeconds)}
          </span>
        </div>
        <input
          type="range"
          aria-label={t('video.position')}
          className="block h-5 w-full accent-violet-400"
          min={0}
          max={video.durationSeconds || 1}
          step={0.5}
          disabled={!connected}
          value={Math.min(position, video.durationSeconds)}
          onChange={(event) => setDragging(Number(event.target.value))}
          onPointerUp={() => {
            if (dragging !== null) seek(dragging);
            setDragging(null);
          }}
        />
      </div>
    </div>
  );
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
    <div
      className={`flex items-center gap-2 border-t px-4 py-2.5 text-[15px] font-medium land:pb-[max(0.625rem,env(safe-area-inset-bottom))] ${tone}`}
    >
      {view.blank && (
        <span className="shrink-0 rounded bg-amber-500 px-1.5 text-[11px] font-semibold text-amber-950">
          {t('controls.blankBadge')}
        </span>
      )}
      <p className="min-w-0 flex-1 truncate">
        {text ?? t(view.previousContent ? 'live.previousSlide' : 'live.nothing')}
      </p>
    </div>
  );
}

function EditRunSheet(props: {
  view: RemoteView;
  connected: boolean;
  before: ReadonlySet<string> | null;
  onAdd(): void;
  onBible(): void;
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
    <main className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-indigo-950 px-3 py-4 land:py-3">
      {items.length === 0 && (
        <p className="p-6 text-center text-sm text-slate-400">{t('live.empty')}</p>
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
            <ItemMark item={item} />
            <span className="min-w-0 flex-1 truncate text-[15px] text-white">
              {item.title || t('live.untitled')}
            </span>
            {isNew(item.itemId) && (
              <span className="shrink-0 rounded bg-sky-700 px-1.5 text-[11px] font-semibold text-white">
                {t('edit.new')}
              </span>
            )}
            <button
              aria-label={t('edit.moveUp')}
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
              aria-label={t('edit.moveDown')}
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
                {t('edit.remove')}
              </button>
            ) : (
              <button
                aria-label={t('edit.remove')}
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
      <div className="space-y-2 land:grid land:grid-cols-2 land:gap-2 land:space-y-0">
        <button
          className="w-full rounded-lg border border-dashed border-violet-700 py-3 text-[15px] font-semibold text-violet-300 active:scale-[0.98] disabled:opacity-40"
          disabled={!connected}
          onClick={props.onAdd}
        >
          + {t('edit.addItem')}
        </button>
        <button
          className="w-full rounded-lg border border-dashed border-teal-700 py-3 text-[15px] font-semibold text-teal-300 active:scale-[0.98] disabled:opacity-40"
          disabled={!connected}
          onClick={props.onBible}
        >
          📖 {t('edit.addPassage')}
        </button>
      </div>
    </main>
  );
}

/**
 * Whether an item's blocks are shaded in turn: a song's verses are, as on the desktop.
 * Desktops from before kinds were sent leave the kind out; their items are taken as songs.
 */
function shadesBlocks(item: { kind?: RemoteItemView['kind'] }): boolean {
  return item.kind === undefined || item.kind === 'lyrics';
}

/** An item's badge, as the desktop marks it; nothing for an ordinary song. */
function ItemMark(props: { item: { kind?: RemoteItemView['kind']; badge?: ItemBadge } }) {
  const badge = itemBadge(props.item);
  return badge ? <ItemBadgeMark badge={badge} /> : null;
}

/** The library search, as on the presenting computer, adding songs to the live run sheet. */
function AddSongs(props: {
  view: RemoteView;
  connected: boolean;
  onDone(): void;
  /** Opens the Bible screen on a reference typed here (B9). */
  onOpenBible(text: string): void;
}) {
  const { view, connected } = props;
  const [query, setQuery] = useState('');
  // A reference typed into the search, found on the phone alone; songs are still listed.
  const reference = songSearchReference(query);
  // A web address typed into the search, added as a website when the desktop can.
  const website = view.websites ? typedWebsiteUrl(query) : null;
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
    setAdded((list) => [...list, song.title || t('live.untitled')]);
    // Ready for the next song. Focusing while handling the tap keeps the phone's keyboard up.
    setQuery('');
    inputRef.current?.focus();
  }
  function addWebsite(url: string) {
    connection.send({ type: 'addWebsite', url });
    setAdded((list) => [...list, new URL(url).hostname]);
    setQuery('');
    inputRef.current?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 border-b border-slate-800 p-3 land:py-2">
        <input
          ref={inputRef}
          autoFocus
          type="search"
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base"
          placeholder={t('add.placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="rounded-lg bg-slate-800 px-3 text-sm font-semibold"
          onClick={props.onDone}
        >
          {t('add.back')}
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
          {t('add.searching')}
        </p>
      )}
      <ul
        className={`min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 transition-opacity land:grid land:grid-cols-2 land:content-start land:gap-2 land:space-y-0 land:py-2 ${
          searching ? 'opacity-50' : ''
        }`}
      >
        {!query.trim() && added.length > 0 && (
          <li role="status" className="p-6 text-center text-sm text-emerald-300 land:col-span-2">
            {t('add.added', { title: added[added.length - 1]! })}
            {added.length > 1 && (
              <span className="mt-1 block text-xs text-slate-400">
                {t('add.addedMany', { count: added.length })}
              </span>
            )}
          </li>
        )}
        {reference && (
          <li className="land:col-span-2">
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-[#00E6FF]/40 bg-slate-900 p-3 text-left text-[15px] font-semibold text-[#00E6FF] active:scale-[0.98] disabled:opacity-40"
              disabled={!connected}
              onClick={() => props.onOpenBible(query.trim())}
            >
              <ItemBadgeMark badge="bible" />
              {t('add.openBible', { reference: formatReference(reference) })}
            </button>
          </li>
        )}
        {website && (
          <li className="land:col-span-2">
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-fuchsia-500/40 bg-slate-900 p-3 text-left text-[15px] font-semibold text-fuchsia-300 active:scale-[0.98] disabled:opacity-40"
              disabled={!connected}
              onClick={() => addWebsite(website)}
            >
              <ItemBadgeMark badge="website" />
              <span className="min-w-0 flex-1">
                {t('add.website')}
                <span className="block truncate text-xs font-normal text-slate-400">{website}</span>
              </span>
            </button>
          </li>
        )}
        {results?.songs.length === 0 && !searching && !reference && !website && (
          <li className="p-6 text-center text-sm text-slate-400 land:col-span-2">
            {t('add.nothing')}
          </li>
        )}
        {results?.songs.map((song) => {
          return (
            <li
              key={song.id}
              className="rounded-lg border border-slate-700 bg-slate-900 p-3 land:p-2.5"
            >
              <div className="mb-1 flex items-center gap-2">
                <ItemMark item={song} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">
                  {song.title || t('live.untitled')}
                </span>
              </div>
              {song.preview.length > 0 && (
                <p className="mb-2 line-clamp-2 text-xs text-slate-400">
                  {song.preview.join(' / ')}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-semibold whitespace-nowrap text-white active:scale-[0.98] disabled:opacity-40 land:text-[13px]"
                  disabled={!connected}
                  onClick={() => add(song, false)}
                >
                  {t('add.toEnd')}
                </button>
                {presented && (
                  <button
                    className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-semibold whitespace-nowrap text-white active:scale-[0.98] disabled:opacity-40 land:text-[13px]"
                    disabled={!connected}
                    onClick={() => add(song, true)}
                  >
                    {t('add.afterCurrent')}
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

// ── OBS (OBS control plan M4, M5.2) ─────────────────────────────────────────

const OBS_ERROR_TEXT: Record<string, MessageKey> = {
  'no-obs': 'obs.error.noObs',
  'not-connected': 'obs.error.notConnected',
  timeout: 'obs.error.timeout',
  'owner-left': 'obs.error.ownerLeft',
};

/** Behind the OBS bar and the OBS screen alike, set apart from the home page and run sheet. */
const OBS_BACKGROUND = 'bg-neutral-800';

function obsError(result: ObsResult): string {
  const known = result.error ? OBS_ERROR_TEXT[result.error] : undefined;
  return known ? t(known) : t('obs.error.other', { code: String(result.error ?? result.code) });
}

function obsStatusText(obs: RemoteObsView): string {
  if (!obs.reachable) return t('obs.unreachable');
  switch (obs.status) {
    case 'connected':
      return t('obs.connected');
    case 'connecting':
      return t('obs.connecting');
    case 'not-running':
      return t('obs.notRunning');
    case 'refused':
      return t('obs.refused');
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
/**
 * Live audio (M4.4): shown only while a desktop of the workspace broadcasts, or while this
 * phone still listens. The tap starts playback.
 */
/**
 * Listening on this phone. On a phone on its side, `beside` the OBS row, it is the button
 * alone, its status in the button's title.
 */
function AudioRow({
  audio,
  beside,
}: {
  audio: NonNullable<RemoteView['audio']> | null;
  beside: boolean;
}) {
  const state = useSyncExternalStore(listen.subscribe, () => listen.state);
  const key = audio ? `${audio.ownerId}|${audio.activatedAt}|${audio.status}` : '';
  useEffect(() => listen.follow(audio), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = state.status.kind !== 'off';
  if (!audio && !on) return null;
  const line = [
    t('listen.title'),
    on ? phoneListenText(state.status) : null,
    on ? phoneDelayText(state.delay) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      className={`border-b border-slate-800 px-3 py-1.5 land:border-0 land:p-0 ${beside ? '' : 'land:flex-1'}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
            audio?.status === 'live' ? 'bg-emerald-400' : 'bg-amber-400'
          }`}
          aria-hidden="true"
        />
        <Marquee className={`min-w-0 flex-1 text-sm ${beside ? 'land:hidden' : ''}`}>
          {line}
        </Marquee>
        <button
          className={`rounded-lg px-4 py-1.5 active:scale-[0.98] land:px-3 ${
            on ? 'bg-sky-600 text-white' : 'bg-slate-800'
          }`}
          title={line}
          aria-label={t(on ? 'listen.stop' : 'listen.title')}
          aria-pressed={on}
          onClick={() => (on ? listen.stop() : listen.start())}
        >
          <ControlIcon name={on ? 'stop' : 'listen'} className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Whether the scene buttons wait for OBS to finish a transition: until it ends, and never
 * longer than `OBS_TRANSITION_LOCK_MS` from when this phone saw it start.
 */
function useTransitionLock(transitioning: boolean): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!transitioning) return;
    const timer = setTimeout(() => setExpired(true), OBS_TRANSITION_LOCK_MS);
    return () => clearTimeout(timer);
  }, [transitioning]);
  return transitioning && !expired;
}

function ObsRow(props: {
  obs: RemoteObsView;
  connected: boolean;
  open: boolean;
  onToggle(): void;
}) {
  const { obs } = props;
  const command = useObsCommand();
  const locked = useTransitionLock(obs.transitioning === true);
  const target = switchTarget(obs);
  const usable = props.connected && obs.reachable && obs.status === 'connected';
  return (
    <div
      className={`border-b border-slate-800 px-3 py-1.5 ${OBS_BACKGROUND} land:min-w-0 land:flex-1 land:border-0 land:bg-transparent land:p-0`}
    >
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          className="flex min-w-0 items-center justify-center gap-2 rounded-lg bg-yellow-800 py-1.5 text-sm font-semibold text-yellow-50 active:scale-[0.98] disabled:opacity-40"
          disabled={!usable || !target || command.pending || locked}
          onClick={() => target && void command.run({ type: 'setScene', scene: target })}
        >
          <ObsDot obs={obs} />
          <span className="truncate">
            {/* While OBS is not connected, that is the problem to show, not the scenes. */}
            {!obs.reachable || obs.status !== 'connected'
              ? obsStatusText(obs)
              : target
                ? `⇄ ${target}`
                : t('obs.chooseScenes')}
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
  { kind: 'stream', label: 'obs.stream', start: 'startStream', stop: 'stopStream' },
  { kind: 'record', label: 'obs.record', start: 'startRecord', stop: 'stopRecord' },
  { kind: 'virtualCam', label: 'obs.camera', start: 'startVirtualCam', stop: 'stopVirtualCam' },
] as const;

function outputText(output: ObsOutput, elapsed: number | null): string {
  if (output.phase === 'starting') return t('obs.starting');
  if (output.phase === 'stopping') return t('obs.stopping');
  if (output.phase === 'reconnecting') return t('live.reconnecting');
  if (!output.active) return t('obs.off');
  const time = elapsed !== null ? formatDuration(elapsed) : t('obs.on');
  return output.paused ? t('obs.paused', { time }) : time;
}

/** The OBS screen (M4.2): the live monitor, the scenes and the outputs. */
function ObsScreen(props: { obs: RemoteObsView; connected: boolean }) {
  const { obs } = props;
  const command = useObsCommand();
  const [confirming, setConfirming] = useState<string | null>(null);
  const locked = useTransitionLock(obs.transitioning === true);
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
    // On a phone on its side, the monitor on the left and the outputs and scenes beside it.
    <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 land:grid land:grid-cols-2 land:items-start land:gap-3 land:space-y-0 land:py-2.5">
      <div className="space-y-2">
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
                alt={t('obs.program')}
                className={`h-full w-full object-contain ${stale ? 'opacity-50' : ''}`}
              />
            ) : (
              <p className="flex h-full items-center justify-center text-xs text-slate-500">
                {usable ? t('obs.waitingImage') : ''}
              </p>
            )}
            {/* Sweeps in from the left and out to the right between images. */}
            {image && !stale && (
              <span
                key={image.receivedAt}
                className="monitor-refresh pointer-events-none absolute bottom-0 left-0 h-1 w-1/3 bg-neutral-400/80"
                style={{ animationDuration: `${OBS_SNAPSHOT_EVERY_MS}ms` }}
                aria-hidden="true"
              />
            )}
          </div>
          {stale && (
            <figcaption className="pt-1 text-right text-xs text-amber-300">
              {t('obs.imageAge', { seconds: Math.round((age ?? 0) / 1000) })}
            </figcaption>
          )}
        </figure>
      </div>

      <div className="space-y-4 land:space-y-3">
        <section className="space-y-2 land:space-y-1.5">
          {OUTPUTS.map(({ kind, label, start, stop }) => {
            const output = obs[kind];
            const running = output.active && output.phase !== 'stopping';
            const elapsed = outputElapsed(output, connection.viewReceivedAt, now);
            // Stopping a stream or recording asks for a second tap; the camera does not.
            const needsConfirm = kind !== 'virtualCam';
            return (
              <div
                key={kind}
                className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 land:py-1.5"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${output.active ? 'bg-rose-500' : 'bg-slate-600'}`}
                />
                <span className="flex-1">
                  <span className="block font-medium">{t(label)}</span>
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
                  {t(running ? (confirming === kind ? 'obs.tapToStop' : 'obs.stop') : 'obs.start')}
                </button>
              </div>
            );
          })}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            {t('obs.scenes')}
          </h2>
          {obs.scenes.length === 0 && (
            <p className="text-sm text-slate-500">{t('obs.scenesLater')}</p>
          )}
          <ul className="space-y-2 land:grid land:grid-cols-2 land:gap-1.5 land:space-y-0">
            {obs.scenes.map((scene) => {
              const live = scene === obs.currentScene;
              return (
                <li key={scene}>
                  <button
                    className={`flex w-full items-center gap-2 rounded-xl border-2 px-4 py-3 text-left land:px-3 land:py-2 active:scale-[0.99] disabled:opacity-60 ${
                      live
                        ? 'border-emerald-500 bg-emerald-900/40'
                        : 'border-slate-800 bg-slate-900'
                    }`}
                    disabled={!usable || command.pending || locked || live}
                    onClick={() => void command.run({ type: 'setScene', scene })}
                  >
                    <span className="min-w-0 flex-1 truncate">{scene}</span>
                    {live && (
                      <span className="text-xs font-semibold text-emerald-300">
                        {t('obs.live')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {command.error && <p className="text-sm text-rose-300 land:col-span-2">{command.error}</p>}
    </main>
  );
}
