import { parseBlocks } from '@worship-q/lyrics';
import type { Song } from '@worship-q/protocol';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';

/** How long the pointer rests on a song before its details show. */
const SHOW_DELAY_MS = 400;
/** Lyric lines shown before the rest is cut off. */
const MAX_LINES = 14;
const CARD_WIDTH = 320;
const GAP = 8;
const MARGIN = 8;

/**
 * Wraps a song in a list and shows its details in a card beside it while the pointer rests
 * on it, so songs with the same title can be told apart.
 */
export function SongPeek(props: { song: Song; children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const cancel = () => window.clearTimeout(timer.current);
  const hide = () => {
    cancel();
    setOpen(false);
  };
  useEffect(() => cancel, []);

  useEffect(() => {
    if (!open) return;
    // The card is placed once; anything that moves the row hides it instead.
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div
      ref={anchor}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        cancel();
        timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
    >
      {props.children}
      {open && anchor.current && <SongCard song={props.song} anchor={anchor.current} />}
    </div>
  );
}

function SongCard(props: { song: Song; anchor: HTMLElement }) {
  const { song, anchor } = props;
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Beside the row, on the side with room, kept inside the window.
  useLayoutEffect(() => {
    const row = anchor.getBoundingClientRect();
    const height = card.current?.offsetHeight ?? 0;
    const fitsRight = row.right + GAP + CARD_WIDTH <= window.innerWidth - MARGIN;
    const left = fitsRight ? row.right + GAP : Math.max(MARGIN, row.left - GAP - CARD_WIDTH);
    const top = Math.max(MARGIN, Math.min(row.top, window.innerHeight - MARGIN - height));
    setPosition({ left, top });
  }, [anchor]);

  const blocks = parseBlocks(song.lyrics);
  let remaining = MAX_LINES;
  const shown = blocks.flatMap((block) => {
    if (remaining <= 0) return [];
    const lines = block.slice(0, remaining);
    remaining -= lines.length;
    return [lines];
  });
  const cut = blocks.flat().length > MAX_LINES;
  const facts = [
    song.ccli && t('songs.ccliValue', { ccli: song.ccli }),
    song.year?.toString(),
  ].filter(Boolean);

  return createPortal(
    <div
      ref={card}
      role="tooltip"
      className="pointer-events-none fixed z-50 max-h-[80vh] overflow-hidden rounded-lg border border-sky-400/80 bg-slate-700 text-sm shadow-2xl ring-4 shadow-black/70 ring-sky-400/15"
      style={{
        width: CARD_WIDTH,
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <div className="bg-sky-800 px-3 py-2">
        <p className="font-semibold text-white">{song.title || t('songs.untitled')}</p>
        {song.author && <p className="mt-0.5 text-xs text-sky-100">{song.author}</p>}
        {song.copyright && <p className="text-xs text-sky-200/80">{song.copyright}</p>}
        {facts.length > 0 && <p className="text-xs text-sky-200/80">{facts.join(' · ')}</p>}
      </div>
      <div className="space-y-2 px-3 py-2 text-slate-100">
        {shown.length === 0 && <p className="text-slate-400">{t('songs.noLyrics')}</p>}
        {shown.map((lines, index) => (
          <div key={index}>
            {lines.map((line, i) => (
              <div key={i} className="truncate">
                {line}
              </div>
            ))}
          </div>
        ))}
        {cut && <p className="text-slate-400">…</p>}
      </div>
    </div>,
    document.body,
  );
}
