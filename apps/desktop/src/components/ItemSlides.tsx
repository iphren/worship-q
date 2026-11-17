import type { LiveState, Presented } from '@worship-q/protocol';
import type { RunSheetEntry } from '@worship-q/session';
import type { Ref } from 'react';
import { t } from '../i18n';
import { COLUMN_REM } from '../lib/presentLayout';
import { slideKeyLabel } from '../lib/shortcuts';
import { DeckBadge } from './DeckBadge';
import { PassageWarnings } from './PassageWarnings';
import { SlideImage } from './SlideImage';
import { VideoTile } from './VideoStatus';

/** A song of lyrics, as opposed to a deck, PDF, image, video or website. */
function isLyrics(song: { deck: unknown; video: unknown; website: unknown }): boolean {
  return !song.deck && !song.video && !song.website;
}

/**
 * True for the slide an item last showed, so operators see where they left off. Not on the
 * item on screen, which has its own highlight, nor on an item with only one slide.
 */
function isLastShown(
  live: LiveState | null,
  presented: Presented | null | undefined,
  entry: { item: { id: string }; pieces: readonly unknown[] },
  pieceId: string,
): boolean {
  if (!live || entry.pieces.length < 2 || presented?.itemId === entry.item.id) return false;
  return live.lastShown[entry.item.id]?.pieceId === pieceId;
}

function LastShownChip() {
  return (
    <span className="pointer-events-none absolute -top-0.5 -right-0.5 z-10 rounded-tr-md rounded-bl-md bg-slate-600 px-1.5 font-sans text-[10px] leading-4 font-semibold text-slate-100">
      {t('present.lastShown')}
    </span>
  );
}

/**
 * One run sheet item on the Present page: its title bar and its slides. In the vertical layout
 * (`grid`) the slides fill the width; in the horizontal one (`column`) the item is a fixed-width
 * column whose slides stack down it and scroll on their own, under a title bar that stays.
 */
export function ItemSlides(props: {
  entry: RunSheetEntry;
  /** Its number in the run sheet, from 1. */
  number: number;
  arrangement: 'grid' | 'column';
  /** The item the slide keys act on: an indigo title bar and slide key labels. */
  keyed: boolean;
  viewOnly: boolean;
  live: LiveState | null;
  presented: Presented | null;
  /** Set on the presented slide's button. */
  activeRef: Ref<HTMLButtonElement>;
  onPlay(pieceId: string): void;
  onEdit(): void;
  /** Set to flash the item, a new count restarting it; null for no flash. */
  flash: number | null;
  onFlashEnd(): void;
}) {
  const { entry, keyed, viewOnly, live, presented } = props;
  const column = props.arrangement === 'column';
  const slides = (
    <>
      <PassageWarnings song={entry.song} className="mb-2 px-2" />
      {entry.pieces.length === 0 && (
        <p className="text-sm text-slate-500">{t('present.noLyrics')}</p>
      )}
      <div
        className={
          column
            ? 'grid grid-cols-1 gap-2'
            : 'grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2'
        }
      >
        {entry.pieces.map((piece, pieceIndex) => {
          const keyLabel = keyed ? slideKeyLabel(pieceIndex) : null;
          // A lyrics song's second, fourth… block; its slides and key labels shade.
          const shaded = isLyrics(entry.song) && piece.blockIndex % 2 === 1;
          const active = presented?.itemId === entry.item.id && presented.pieceId === piece.id;
          return (
            <button
              key={piece.id}
              ref={active ? props.activeRef : undefined}
              // A viewer sees the slides but cannot present them.
              disabled={viewOnly}
              // A click leaves the focus where it was. On Windows, WebView2 would otherwise focus
              // the slide and, at the next key press, ring it over the presented slide's border.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onPlay(piece.id)}
              className={`relative rounded-md border-2 text-center ${piece.image ? 'p-0.5' : 'min-h-16 px-2 py-2'} text-sm leading-snug ${
                active
                  ? live?.blank
                    ? 'border-amber-400 bg-amber-900/30'
                    : 'border-emerald-500 bg-emerald-900/40'
                  : // Alternate a lyrics song's styles by block so its slides read as
                    // groups; decks, PDFs, images, videos and websites keep one style.
                    shaded
                    ? `border-sky-700 bg-sky-900/60 ${viewOnly ? '' : 'hover:border-sky-500'}`
                    : `border-slate-700 bg-slate-800 ${viewOnly ? '' : 'hover:border-slate-500'}`
              } ${piece.indexInBlock === 0 ? '' : 'opacity-95'}`}
            >
              {keyLabel && (
                <kbd
                  className={`absolute -top-0.5 -left-0.5 rounded-tl-md rounded-br-md px-1 font-sans text-[10px] leading-4 font-semibold ${shaded ? 'bg-indigo-300 text-indigo-950' : 'bg-indigo-600 text-slate-100'}`}
                >
                  {keyLabel}
                </kbd>
              )}
              {isLastShown(live, presented, entry, piece.id) && <LastShownChip />}
              {entry.song.video ? (
                <VideoTile video={entry.song.video} />
              ) : piece.image && entry.song.deck ? (
                <SlideImage
                  image={piece.image}
                  className="w-full rounded-sm"
                  style={{
                    aspectRatio: `${entry.song.deck.width} / ${entry.song.deck.height}`,
                  }}
                />
              ) : (
                piece.lines.map((line) => (
                  <span key={line.id} className="block truncate whitespace-pre">
                    {line.text}
                  </span>
                ))
              )}
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <section
      data-item-id={entry.item.id}
      aria-current={keyed || undefined}
      className={column ? 'relative flex h-full shrink-0 flex-col' : 'relative'}
      style={column ? { width: `${COLUMN_REM}rem` } : undefined}
    >
      <header
        // In a column, the title bar is where a mouse wheel scrolls the row sideways.
        data-column-header={column || undefined}
        className={`mb-2 flex shrink-0 items-center gap-2 rounded-t-md border-b px-2 pt-1.5 pb-1.5 ${
          keyed ? 'border-indigo-400 bg-indigo-500/25' : 'border-slate-700'
        }`}
      >
        <h3 className="min-w-0 truncate text-lg text-slate-50">
          <span className={`mr-2 ${keyed ? 'text-indigo-300' : 'text-slate-400'}`}>
            {props.number}
          </span>
          <DeckBadge song={entry.song} />
          {entry.song.title || t('songs.untitled')}
        </h3>
        {entry.song.removedAt && (
          <span className="shrink-0 text-xs text-amber-400">{t('songs.removedBadge')}</span>
        )}
        <span className="flex-1" />
        {!entry.song.removedAt && !viewOnly && (
          <button
            className="btn btn-ghost btn-sm shrink-0 whitespace-nowrap"
            title={t('present.edit')}
            aria-label={t('present.edit')}
            onClick={props.onEdit}
          >
            ✎{column ? '' : ` ${t('present.edit')}`}
          </button>
        )}
      </header>
      {column ? (
        <div data-item-slides className="min-h-0 flex-1 overflow-y-auto pr-1 pb-1">
          {slides}
        </div>
      ) : (
        slides
      )}
      {/* Last, so it paints over the slides. */}
      {props.flash !== null && (
        <div
          key={props.flash}
          className="item-flash pointer-events-none absolute inset-0 rounded-md"
          onAnimationEnd={props.onFlashEnd}
        />
      )}
    </section>
  );
}
