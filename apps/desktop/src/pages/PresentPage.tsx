import { nextMeetingDate } from '@worship-q/calendar';
import type { Song } from '@worship-q/protocol';
import { useEffect, useRef, useState } from 'react';
import { useApp, useQuery, useSession } from '../app/context';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { OutputPanel, outputNeedsAttention, useOutputStatus } from '../components/OutputPanel';
import { RunSheetEditor } from '../components/RunSheetEditor';
import { SlidePreview } from '../components/SlidePreview';
import { SongForm } from '../components/SongForm';
import { formatDate, t } from '../i18n';
import { presentAction, runPresentAction, slideKeyLabel } from '../lib/shortcuts';

/** Live dates whose "kept too long" notice was dismissed since the app opened. */
const dismissedNotices = new Set<string>();

/** Whether the slideshow drawer is open; closed each time the app opens. */
let drawerOpen = false;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function PresentPage() {
  const session = useSession();
  const status = useOutputStatus();
  const outputPanel = (
    <section className="panel p-3">
      <h2 className="label">{t('output.title')}</h2>
      <OutputPanel />
    </section>
  );

  if (!session.isLive) return <NotLive outputPanel={outputPanel} />;
  return <Live outputPanel={outputPanel} attention={outputNeedsAttention(status)} />;
}

function NotLive(props: { outputPanel: React.ReactNode }) {
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
        {props.outputPanel}
      </div>
    </div>
  );
}

function Live(props: { outputPanel: React.ReactNode; attention: boolean }) {
  const { navigate } = useApp();
  const session = useSession();
  const liveDate = session.liveDate!;
  const live = session.live!;
  const view = useQuery(() => session.viewLive(), [liveDate]);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [, setDismissed] = useState(0);
  const [open, setOpen] = useState(drawerOpen);
  const activeRef = useRef<HTMLButtonElement>(null);
  const slidesRef = useRef<HTMLElement>(null);
  const shownItemRef = useRef<string | null>(null);
  // Set when a click on a slide moves to another item, so the column stays where it was.
  const clickedItemRef = useRef(false);
  // The item a run sheet click scrolled to; the count restarts the flash on a repeat click.
  const [flash, setFlash] = useState<{ itemId: string; count: number } | null>(null);

  const previous = session.presentingPreviousContent;
  const presented = previous ? null : live.presented;
  const entries = view?.date === liveDate ? view.entries : [];
  // The item the slide keys act on: the presented one, or the first before anything is.
  const keyedItemId = presented?.itemId ?? entries[0]?.item.id ?? null;
  const showKeptTooLong = session.keptTooLong && !dismissedNotices.has(liveDate);
  const nextDate = nextMeetingDate(session.today(), session.workspace.meetingDays);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector('[data-dialog]')) return;
      const action = presentAction(event);
      if (!action) return;
      runPresentAction(session, action);
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  useEffect(() => {
    const active = activeRef.current;
    const itemChanged = (presented?.itemId ?? null) !== shownItemRef.current;
    const clicked = clickedItemRef.current;
    shownItemRef.current = presented?.itemId ?? null;
    clickedItemRef.current = false;
    if (!active) return;

    // Moving to another item by keyboard or the controls brings its title to the top, as
    // long as the presented slide stays in view.
    const section = active.closest('section');
    if (itemChanged && !clicked && section && scrollToTop(section, active)) return;
    active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [presented?.itemId, presented?.pieceId]);

  /** Scrolls the slides column so `section` starts at the top, unless `keep` would leave view. */
  function scrollToTop(section: Element, keep?: Element): boolean {
    const slides = slidesRef.current;
    if (!slides) return false;
    const sectionTop = section.getBoundingClientRect().top;
    if (keep && keep.getBoundingClientRect().bottom - sectionTop > slides.clientHeight) {
      return false;
    }
    const offset = sectionTop - slides.getBoundingClientRect().top;
    slides.scrollTo({ top: slides.scrollTop + offset, behavior: 'smooth' });
    return true;
  }

  function showItem(itemId: string) {
    const section = slidesRef.current?.querySelector(`section[data-item-id="${itemId}"]`);
    if (!section) return;
    scrollToTop(section);
    setFlash((last) => ({ itemId, count: (last?.count ?? 0) + 1 }));
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-dialog]')) openDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function openDrawer(value: boolean) {
    drawerOpen = value;
    setOpen(value);
  }

  async function end() {
    setConfirmEnd(false);
    await session.endPresentation();
    navigate('calendar');
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 px-4 pt-3 empty:hidden">
        {showKeptTooLong && (
          <div className="notice border-amber-500 bg-amber-900/40 text-amber-100">
            <span className="flex-1">
              {t('present.keptTooLong', { date: formatDate(liveDate) })}
            </span>
            <button className="btn btn-sm" onClick={() => void end()}>
              {t('present.keptTooLongAction', { next: formatDate(nextDate) })}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                dismissedNotices.add(liveDate);
                setDismissed((n) => n + 1);
              }}
            >
              {t('present.dismiss')}
            </button>
          </div>
        )}
        {previous && (
          <div className="notice border-sky-600 bg-sky-900/40 text-sky-100">
            <strong>{t('present.previousContent')}</strong>
            <span>{t('present.previousContentBody')}</span>
          </div>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 gap-3 overflow-hidden p-4">
        <aside className="panel flex w-72 shrink-0 flex-col p-3">
          <h2 className="label">{t('runSheet.title', { date: formatDate(liveDate) })}</h2>
          <RunSheetEditor
            date={liveDate}
            activeItemId={presented?.itemId ?? null}
            onSelectItem={showItem}
          />
        </aside>

        <main ref={slidesRef} className="min-w-0 flex-1 space-y-4 overflow-auto pr-1">
          {view && entries.length === 0 && (
            <p className="p-6 text-slate-500">{t('present.emptyRunSheet')}</p>
          )}
          {entries.map((entry, index) => (
            <section key={entry.item.id} data-item-id={entry.item.id} className="relative">
              <header className="mb-1.5 flex items-center gap-2">
                <h3 className="min-w-0 truncate text-sm font-semibold">
                  <span className="mr-2 text-slate-500">{index + 1}</span>
                  {entry.song.title || t('songs.untitled')}
                </h3>
                {entry.song.removedAt && (
                  <span className="text-xs text-amber-400">{t('songs.removedBadge')}</span>
                )}
                <span className="flex-1" />
                {!entry.song.removedAt && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditingSong(entry.song)}
                  >
                    ✎ {t('present.editLyrics')}
                  </button>
                )}
              </header>
              {entry.pieces.length === 0 && (
                <p className="text-sm text-slate-500">{t('present.noLyrics')}</p>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
                {entry.pieces.map((piece, pieceIndex) => {
                  const keyLabel = entry.item.id === keyedItemId ? slideKeyLabel(pieceIndex) : null;
                  const active =
                    presented?.itemId === entry.item.id && presented.pieceId === piece.id;
                  return (
                    <button
                      key={piece.id}
                      ref={active ? activeRef : undefined}
                      onClick={() => {
                        if (entry.item.id !== presented?.itemId) clickedItemRef.current = true;
                        void session.play(entry.item.id, piece.id);
                      }}
                      className={`relative min-h-16 rounded-md border-2 px-2 py-2 text-center text-sm leading-snug ${
                        active
                          ? live.blank
                            ? 'border-amber-400 bg-amber-900/30'
                            : 'border-emerald-500 bg-emerald-900/40'
                          : // Alternate styles by block so slides from one block read as a group.
                            piece.blockIndex % 2 === 0
                            ? 'border-slate-700 bg-slate-800 hover:border-slate-500'
                            : 'border-sky-700 bg-sky-900/60 hover:border-sky-500'
                      } ${piece.indexInBlock === 0 ? '' : 'opacity-95'}`}
                    >
                      {keyLabel && (
                        <kbd className="absolute -top-0.5 -left-0.5 rounded-tl-md rounded-br-md bg-slate-600 px-1 font-sans text-[10px] leading-4 font-semibold text-slate-200">
                          {keyLabel}
                        </kbd>
                      )}
                      {piece.lines.map((line) => (
                        <span key={line.id} className="block truncate whitespace-pre">
                          {line.text}
                        </span>
                      ))}
                    </button>
                  );
                })}
              </div>
              {/* Last, so it paints over the slides. */}
              {flash?.itemId === entry.item.id && (
                <div
                  key={flash.count}
                  className="item-flash pointer-events-none absolute inset-0 rounded-md"
                  onAnimationEnd={() => setFlash(null)}
                />
              )}
            </section>
          ))}
        </main>

        <aside className="flex w-11 shrink-0 flex-col gap-2">
          <button
            className="btn btn-ghost px-0 py-2"
            title={t('present.expandPanel')}
            aria-label={t('present.expandPanel')}
            onClick={() => openDrawer(true)}
          >
            <Icon name="expand" />
          </button>
          <button
            className="btn px-0 py-2"
            title={t('present.previous')}
            aria-label={t('present.previous')}
            onClick={() => void session.previous()}
          >
            <Icon name="previous" />
          </button>
          <button
            className="btn btn-primary px-0 py-2"
            title={t('present.next')}
            aria-label={t('present.next')}
            onClick={() => void session.next()}
          >
            <Icon name="next" />
          </button>
          <button
            className={`btn px-0 py-2 ${live.blank ? 'border-amber-400 bg-amber-700 hover:bg-amber-600' : ''}`}
            title={live.blank ? t('present.unblank') : t('present.blank')}
            aria-label={live.blank ? t('present.unblank') : t('present.blank')}
            onClick={() => void session.setBlank(!live.blank)}
          >
            <Icon name="blank" />
          </button>
          <OutputPanel compact />
          <button
            className="btn btn-danger mt-auto px-0 py-2"
            title={t('present.end')}
            aria-label={t('present.end')}
            onClick={() => setConfirmEnd(true)}
          >
            <Icon name="stop" />
          </button>
        </aside>

        {open && (
          <aside className="drawer absolute inset-y-0 right-0 z-30 flex w-80 max-w-full flex-col gap-3 overflow-auto border-l border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <section className="panel space-y-2 p-3">
              <h2 className="label flex items-center gap-2">
                <span className="flex-1">{t('present.preview')}</span>
                {live.blank && <span className="text-amber-400">{t('present.blanked')}</span>}
                <button
                  className="btn btn-ghost btn-sm px-1"
                  title={t('present.collapsePanel')}
                  aria-label={t('present.collapsePanel')}
                  onClick={() => openDrawer(false)}
                >
                  <Icon name="collapse" className="h-4 w-4" />
                </button>
              </h2>
              <SlidePreview />
              <div className="grid grid-cols-2 gap-2">
                <button className="btn" onClick={() => void session.previous()}>
                  ← {t('present.previous')}
                </button>
                <button className="btn btn-primary" onClick={() => void session.next()}>
                  {t('present.next')} →
                </button>
                <button
                  className={`btn col-span-2 ${live.blank ? 'border-amber-400 bg-amber-700 hover:bg-amber-600' : ''}`}
                  onClick={() => void session.setBlank(!live.blank)}
                >
                  {live.blank ? t('present.unblank') : t('present.blank')}
                </button>
              </div>
              <p className="text-center text-xs text-slate-500">{t('present.shortcuts')}</p>
            </section>
            <div className={props.attention ? 'rounded-lg ring-2 ring-amber-400' : ''}>
              {props.outputPanel}
            </div>
            <button className="btn btn-danger mt-auto" onClick={() => setConfirmEnd(true)}>
              {t('present.end')}
            </button>
          </aside>
        )}
      </div>

      {editingSong && (
        <Dialog
          wide
          title={t('present.editLyricsTitle', { title: editingSong.title || t('songs.untitled') })}
          onClose={() => setEditingSong(null)}
          actions={null}
        >
          <div className="h-[65vh]">
            <SongForm
              key={editingSong.id}
              song={editingSong}
              lyricsOnly
              onSaved={() => setEditingSong(null)}
              actions={
                <button type="button" className="btn" onClick={() => setEditingSong(null)}>
                  {t('common.cancel')}
                </button>
              }
            />
          </div>
        </Dialog>
      )}
      {confirmEnd && (
        <ConfirmDialog
          title={t('present.endTitle')}
          body={t('present.endBody')}
          confirmLabel={t('present.end')}
          danger
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => void end()}
        />
      )}
    </div>
  );
}
