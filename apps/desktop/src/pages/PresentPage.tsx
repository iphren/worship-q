import { nextMeetingDate } from '@worship-q/calendar';
import type { Presented, Song } from '@worship-q/protocol';
import { SUBTITLE_BAR_FRACTION } from '@worship-q/renderer';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deviceSettings } from '../app/deviceSettings';
import { useCloud, useQuery, useSession, useUpdates } from '../app/context';
import { Icon } from '../components/Icon';
import { ObsLiveMonitor, ObsSection } from '../components/Obs';
import { OutputPanel, useOutputStatus } from '../components/OutputPanel';
import { RunSheetEditor } from '../components/RunSheetEditor';
import { UpdateBanner } from '../components/UpdateBanner';
import { SlidePreview, SubtitlePreview } from '../components/SlidePreview';
import { ItemEditDialog } from '../components/ItemEditDialog';
import { ItemSlides } from '../components/ItemSlides';
import { VideoControls } from '../components/VideoStatus';
import { formatDate, t } from '../i18n';
import { AudioPanel } from '../components/AudioListen';
import {
  presentLayoutFor,
  scrollAlong,
  scroller,
  scrollToCentre,
  scrollToFocus,
  remPx,
  scrollToNearest,
  scrollToStart,
  span,
} from '../lib/presentLayout';
import { useScrollMemory } from '../lib/scrollMemory';
import { presentAction, runPresentAction, videoKeys } from '../lib/shortcuts';

/** Live dates whose "kept too long" notice was dismissed since the app opened. */
const dismissedNotices = new Set<string>();

/** A button's name with the key that does the same, for its tooltip. */
function withKey(label: string, key: string): string {
  return `${label} (${key})`;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function PresentPage() {
  const session = useSession();
  if (session.isViewer) return <Live viewOnly />;
  if (!session.isLive) return <NotLive />;
  return <Live />;
}

function NotLive() {
  const session = useSession();
  const today = session.today();
  const dates = [...new Set([session.openDate, today])];
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <div className="panel space-y-3 p-6 text-center">
          <h1 className="text-xl font-semibold">{t('present.nothingLive')}</h1>
          <p className="text-sm text-slate-400">{t('present.nothingLiveBody')}</p>
          <div className="flex flex-col gap-2">
            {dates.map((date, index) => (
              <button
                key={date}
                className={`btn ${index === 0 ? 'btn-live' : ''}`}
                onClick={() => void session.goLive(date)}
              >
                {t('present.goLiveWith', { date: formatDate(date) })}
                {date === today ? ` (${t('common.today')})` : ''}
              </button>
            ))}
          </div>
        </div>
        <section className="panel p-3">
          <h2 className="label">{t('output.title')}</h2>
          <OutputPanel />
        </section>
        <ObsSection watch />
      </div>
    </div>
  );
}

/**
 * The live run sheet and its slides. In viewer mode (decision D16) the same layout shows what
 * is presented, read-only: no search, no controls, no editing, and the column follows the
 * presented slide. Before anything is live, a viewer waits here too.
 */
function Live(props: { viewOnly?: boolean }) {
  const { viewOnly = false } = props;
  const session = useSession();
  const { live: link } = useCloud();
  // Only a viewer comes here without a live run sheet.
  const liveDate = session.liveDate;
  const live = session.isLive ? session.live : null;
  const view = useQuery(() => session.viewLive(), [liveDate]);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [, setDismissed] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);
  const slidesRef = useRef<HTMLElement>(null);
  const shownItemRef = useRef<string | null>(null);
  // Set when a click on a slide moves to another item, so the column stays where it was.
  const clickedItemRef = useRef(false);
  // Until when a change of the presented slide counts as made here, so the column follows
  // it. Changes made from phones leave the column where it is; the locate button finds them.
  // The column follows on opening the page too.
  const followUntilRef = useRef(Infinity);
  // The item a run sheet click scrolled to; the count restarts the flash on a repeat click.
  const [flash, setFlash] = useState<{ itemId: string; count: number } | null>(null);
  const [activeInView, setActiveInView] = useState(true);
  // Kept on this computer, so a viewer reopens as it was left.
  const [simpleView, setSimpleView] = useState(() => deviceSettings.get().simpleView);
  // Set in Settings, which this page is reopened from.
  const [swapArrows] = useState(() => deviceSettings.get().swapArrows);
  // Items side by side as columns, unless chosen otherwise or too few columns fit (H4).
  const [layoutSetting] = useState(() => deviceSettings.get().presentLayout);
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => setAreaWidth(area.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const horizontal = presentLayoutFor(areaWidth, layoutSetting, remPx()) === 'horizontal';
  // The axis the slides area scrolls along: across the columns, or down the stacked items.
  const axis = horizontal ? 'x' : 'y';
  function chooseSimpleView(on: boolean) {
    deviceSettings.set({ simpleView: on });
    setSimpleView(on);
  }

  const previous = session.presentingPreviousContent;
  const presented = previous ? null : (live?.presented ?? null);
  const entries = view && view.date === liveDate ? view.entries : [];
  // The video the control bar is for, when a video item is live (M6.4).
  const presentedVideoFile =
    entries.find((entry) => entry.item.id === session.video?.itemId)?.song.video?.file ?? null;
  // The item the slide keys act on: the one moved to with left and right, else the presented
  // one, or the first before anything is.
  const browsedItemId =
    !viewOnly && entries.some((entry) => entry.item.id === session.browsedItemId)
      ? session.browsedItemId
      : null;
  // A viewer has no slide keys.
  const keyedItemId = viewOnly
    ? null
    : (browsedItemId ?? presented?.itemId ?? entries[0]?.item.id ?? null);
  const showKeptTooLong =
    !viewOnly && !!liveDate && session.keptTooLong && !dismissedNotices.has(liveDate);
  const blankStyle = live?.blank ? 'border-amber-400 bg-amber-700 hover:bg-amber-600' : '';
  const nextDate = nextMeetingDate(session.today(), session.workspace.meetingDays);
  useScrollMemory(slidesRef, `present.slides:${liveDate}:${axis}`, axis);

  useEffect(() => {
    if (viewOnly) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector('[data-dialog]')) return;
      const action = presentAction(event, { video: videoKeys(session), swapArrows });
      if (!action) return;
      follow();
      runPresentAction(session, action);
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, viewOnly, swapArrows]);

  // Whether the presented slide is in the column yet: the run sheet can load after it is known.
  const presentedShown = entries.some((entry) => entry.item.id === presented?.itemId);

  useEffect(() => {
    const active = activeRef.current;
    // A viewer, or the page just opened, follows once the presented slide has loaded.
    if (!active && (viewOnly || followUntilRef.current === Infinity)) return;
    const itemChanged = (presented?.itemId ?? null) !== shownItemRef.current;
    const clicked = clickedItemRef.current;
    shownItemRef.current = presented?.itemId ?? null;
    clickedItemRef.current = false;
    // A viewer always follows the presented slide.
    const following = viewOnly || performance.now() < followUntilRef.current;
    followUntilRef.current = 0;
    if (!active || !following) return;

    // Moving to another item by keyboard or the controls brings its title to the top, as long
    // as the presented slide stays in view, or its column to the middle of the row.
    const section = active.closest('section');
    if (!horizontal) {
      if (
        itemChanged &&
        !clicked &&
        section &&
        scrollToItem(slidesRef.current, 'y', section, active)
      )
        return;
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const row = slidesRef.current;
    const column = active.closest<HTMLElement>('[data-item-slides]');
    if (column) scrollAlong(column, 'y', scrollToNearest(scroller(column, 'y'), span(active, 'y')));
    if (!row || !section || (itemChanged && !clicked && scrollToItem(row, 'x', section))) return;
    scrollAlong(row, 'x', scrollToNearest(scroller(row, 'x'), span(section, 'x')));
  }, [presented?.itemId, presented?.pieceId, presentedShown, viewOnly, horizontal]);

  /** Lets the column follow the move about to be made here. */
  function follow() {
    followUntilRef.current = performance.now() + 1000;
  }

  // Offer the locate button while the presented slide is scrolled out of view: out of the
  // slides area, or out of its own column, which an observer of the area also sees (M0.4).
  useEffect(() => {
    const active = activeRef.current;
    const slides = slidesRef.current;
    setActiveInView(true);
    if (!active || !slides) return;
    const observer = new IntersectionObserver(
      ([entry]) => setActiveInView(entry!.intersectionRatio >= 0.5),
      { root: slides, threshold: [0, 0.5, 1] },
    );
    observer.observe(active);
    return () => observer.disconnect();
  }, [presented?.itemId, presented?.pieceId, view, horizontal]);

  // Moving to another item with the keys brings it to the top, or its column to the middle of
  // the row, without the flash.
  useEffect(() => {
    const slides = slidesRef.current;
    const section = slides?.querySelector(`section[data-item-id="${browsedItemId}"]`);
    if (browsedItemId && section) scrollToItem(slides, axis, section);
  }, [browsedItemId, axis]);

  // A mouse wheel over a column's title bar, or the row's scroll bar, scrolls the row across;
  // over a column's slides it scrolls that column. Mostly sideways movement, as a trackpad
  // makes, is left as it is (H5).
  useEffect(() => {
    const row = slidesRef.current;
    if (!row || !horizontal) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if ((event.target as Element).closest('[data-item-slides]')) return;
      row.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    row.addEventListener('wheel', onWheel, { passive: false });
    return () => row.removeEventListener('wheel', onWheel);
  }, [horizontal]);

  /** Brings the presented slide back into view, in the middle. */
  function locate() {
    const active = activeRef.current;
    const row = slidesRef.current;
    if (!active || !row) return;
    if (!horizontal) return active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const section = active.closest('section');
    const column = active.closest<HTMLElement>('[data-item-slides]');
    if (section) scrollAlong(row, 'x', scrollToCentre(scroller(row, 'x'), span(section, 'x')));
    if (column) scrollAlong(column, 'y', scrollToCentre(scroller(column, 'y'), span(active, 'y')));
  }

  function showItem(itemId: string) {
    if (!viewOnly) void session.browseTo(itemId);
    const section = slidesRef.current?.querySelector(`section[data-item-id="${itemId}"]`);
    if (!section) return;
    scrollToItem(slidesRef.current, axis, section);
    setFlash((last) => ({ itemId, count: (last?.count ?? 0) + 1 }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 px-4 pt-3 empty:hidden">
        {viewOnly && (
          <div className="notice border-slate-600 bg-slate-800/70 text-slate-300">
            <span className="rounded bg-slate-600 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-slate-100 uppercase ring-1 ring-slate-400/60">
              {t('viewer.label')}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {session.isLive && link?.coordinatorName
                ? t('viewer.following', { name: link.coordinatorName })
                : t('viewer.waiting')}
            </span>
            {liveDate && (
              <span className="shrink-0 text-xs text-slate-400">{formatDate(liveDate)}</span>
            )}
            <button className="btn btn-live btn-sm shrink-0" onClick={() => chooseSimpleView(true)}>
              {t('viewer.simpleView')}
            </button>
          </div>
        )}
        {viewOnly && simpleView && (
          <SimpleView
            title={presentedTitle(entries, presented)}
            onLeave={() => chooseSimpleView(false)}
          />
        )}
        {showKeptTooLong && (
          <div className="notice border-amber-500 bg-amber-900/40 text-amber-100">
            <span className="flex-1">
              {t('present.keptTooLong', { date: formatDate(liveDate!) })}
            </span>
            <button className="btn btn-sm" onClick={() => void session.goLive(nextDate)}>
              {t('present.keptTooLongAction', { next: formatDate(nextDate) })}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                dismissedNotices.add(liveDate!);
                setDismissed((n) => n + 1);
              }}
            >
              {t('present.dismiss')}
            </button>
          </div>
        )}
        {previous && !viewOnly && (
          <div className="notice border-sky-600 bg-sky-900/40 text-sky-100">
            <strong>{t('present.previousContent')}</strong>
            <span className="flex-1">{t('present.previousContentBody')}</span>
            <button className="btn btn-sm" onClick={() => void session.clear()}>
              {t('present.clear')}
            </button>
          </div>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 gap-3 overflow-hidden p-4">
        <aside className="panel flex w-80 shrink-0 flex-col p-3">
          <AudioPanel />
          <div className="flex min-h-0 flex-1 flex-col">
            {!liveDate ? (
              <p className="px-1 py-2 text-sm text-slate-500">{t('viewer.waiting')}</p>
            ) : viewOnly ? (
              <RunSheetEditor
                date={liveDate}
                activeItemId={presented?.itemId ?? null}
                onSelectItem={showItem}
                live
                readOnly
                footer={
                  // A viewer moves no slides, but opens and places its own output.
                  <div className="grid auto-cols-fr grid-flow-col gap-1 border-t border-slate-700 pt-2">
                    <OutputPanel compact />
                  </div>
                }
              />
            ) : (
              <RunSheetEditor
                date={liveDate}
                activeItemId={presented?.itemId ?? null}
                keyedItemId={browsedItemId !== presented?.itemId ? browsedItemId : null}
                onSelectItem={showItem}
                live
                idleBelowSearch={<SlidePreview />}
                footer={
                  <div className="grid auto-cols-fr grid-flow-col gap-1 border-t border-slate-700 pt-2">
                    <button
                      className="btn px-0 py-2"
                      title={withKey(t('present.previous'), swapArrows ? '←' : '↑')}
                      aria-label={t('present.previous')}
                      onClick={() => {
                        follow();
                        void session.previous();
                      }}
                    >
                      <Icon name="previous" />
                    </button>
                    <button
                      className="btn btn-primary px-0 py-2"
                      title={withKey(t('present.next'), swapArrows ? '→' : '↓')}
                      aria-label={t('present.next')}
                      onClick={() => {
                        follow();
                        void session.next();
                      }}
                    >
                      <Icon name="next" />
                    </button>
                    <button
                      className={`btn px-0 py-2 ${blankStyle}`}
                      title={withKey(live?.blank ? t('present.unblank') : t('present.blank'), '.')}
                      aria-label={live?.blank ? t('present.unblank') : t('present.blank')}
                      onClick={() => void session.setBlank(!live?.blank)}
                    >
                      <Icon name="blank" />
                    </button>
                    <button
                      className="btn px-0 py-2"
                      title={withKey(t('present.clear'), 'Del')}
                      aria-label={t('present.clear')}
                      disabled={!live?.presented}
                      onClick={() => void session.clear()}
                    >
                      <Icon name="clear" />
                    </button>
                    <OutputPanel compact />
                  </div>
                }
              />
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <ObsLiveMonitor />
          <div ref={areaRef} className="relative min-h-0 flex-1">
            <main
              ref={slidesRef}
              className={
                horizontal
                  ? 'present-row flex h-full gap-3 overflow-x-auto overflow-y-hidden pb-1'
                  : 'h-full space-y-4 overflow-auto pr-1'
              }
            >
              {!liveDate && <p className="p-6 text-center text-slate-500">{t('viewer.waiting')}</p>}
              {liveDate && view && entries.length === 0 && (
                <p className="p-6 text-slate-500">{t('present.emptyRunSheet')}</p>
              )}
              {entries.map((entry, index) => (
                <ItemSlides
                  key={entry.item.id}
                  entry={entry}
                  number={index + 1}
                  arrangement={horizontal ? 'column' : 'grid'}
                  keyed={entry.item.id === keyedItemId}
                  viewOnly={viewOnly}
                  live={live}
                  presented={presented}
                  activeRef={activeRef}
                  onPlay={(pieceId) => {
                    if (entry.item.id !== presented?.itemId) clickedItemRef.current = true;
                    follow();
                    void session.play(entry.item.id, pieceId);
                  }}
                  onEdit={() => setEditingSong(entry.song)}
                  flash={flash?.itemId === entry.item.id ? flash.count : null}
                  onFlashEnd={() => setFlash(null)}
                />
              ))}
            </main>
            {presented && !activeInView && (
              <button
                // Clear of the row's scroll bar in columns.
                className={`absolute right-4 ${horizontal ? 'bottom-10' : 'bottom-4'} z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 bg-slate-900/90 shadow-lg shadow-black/50 hover:bg-slate-800 ${
                  live?.blank
                    ? 'border-amber-400 text-amber-300'
                    : 'border-emerald-500 text-emerald-300'
                }`}
                title={t('present.locate')}
                aria-label={t('present.locate')}
                onClick={locate}
              >
                <Icon name="locate" />
              </button>
            )}
          </div>
          {!viewOnly && <VideoControls file={presentedVideoFile} />}
        </div>
      </div>

      {editingSong && <ItemEditDialog song={editingSong} onClose={() => setEditingSong(null)} />}
    </div>
  );
}

/**
 * Brings an item into view: its title to the top of the stacked items, unless `keep` would
 * leave view, or its column to the middle of a row less than three columns wide, else second
 * from the left. False when it stays put.
 */
function scrollToItem(
  slides: HTMLElement | null,
  axis: 'x' | 'y',
  section: Element,
  keep?: Element,
): boolean {
  if (!slides) return false;
  const to =
    axis === 'x'
      ? scrollToFocus(scroller(slides, 'x'), span(section, 'x'), remPx())
      : scrollToStart(scroller(slides, 'y'), span(section, 'y'), keep && span(keep, 'y'));
  scrollAlong(slides, axis, to);
  return to !== null;
}

/** The title of the presented item, as the run sheet names it, or null when nothing is. */
function presentedTitle(
  entries: readonly { item: { id: string }; song: { title: string } }[],
  presented: Presented | null,
): string | null {
  if (!presented) return null;
  const song = entries.find((entry) => entry.item.id === presented.itemId)?.song;
  return song ? song.title || t('songs.untitled') : null;
}

/**
 * A viewer's screen with everything else covered: the slideshow and subtitle overlay as they
 * are shown, for a computer that only watches. Dialogs still open above it, and it carries its
 * own offer to restart into a downloaded update, which the cover would otherwise hide. The previews
 * are as wide as fits the window's height beside the headings, message, button and that offer,
 * so nothing scrolls.
 */
function SimpleView(props: { title: string | null; onLeave: () => void }) {
  const status = useOutputStatus();
  const updateReady = useUpdates().kind === 'ready';
  const monitor = status.decision.kind === 'open' ? status.decision.monitor : null;
  // Height over width of the slideshow, then of the subtitle bar (fitted at 1920 by 1080).
  const slideRatio = monitor ? monitor.height / monitor.width : 9 / 16;
  const barRatio = (SUBTITLE_BAR_FRACTION * 9) / 16;
  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-slate-950">
      <UpdateBanner />
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div
          className="flex flex-col items-center gap-3"
          // 15rem holds the two headings, the message, the button, the gaps and the padding; 3rem
          // more holds the update banner while it shows.
          style={{
            width: `min(100%, 48rem, (100vh - ${updateReady ? 18 : 15}rem) / ${slideRatio + barRatio})`,
          }}
        >
          <section className="w-full space-y-1.5">
            <h2 className="label flex min-w-0 gap-1">
              <span className="shrink-0">{t('viewer.onScreen')}</span>
              {props.title && (
                <span className="min-w-0 truncate font-normal tracking-normal normal-case">
                  · {props.title}
                </span>
              )}
            </h2>
            <SlidePreview />
          </section>
          <section className="w-full space-y-1.5">
            <h2 className="label">{t('subtitle.preview')}</h2>
            <SubtitlePreview frame={status.subtitle} />
          </section>
          <p className="mt-1 text-sm text-slate-400">{t('viewer.viewingOnly')}</p>
          <button
            className="btn bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={props.onLeave}
          >
            {t('viewer.fullView')}
          </button>
        </div>
      </div>
    </div>
  );
}
