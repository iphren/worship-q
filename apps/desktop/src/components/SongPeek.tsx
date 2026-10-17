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
      className="pointer-events-none fixed z-50 max-h-[80vh] overflow-hidden rounded-lg border border-slate-600 bg-slate-900 p-3 text-sm shadow-xl"
      style={{
        width: CARD_WIDTH,
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <p className="font-semibold text-slate-100">{song.title || t('songs.untitled')}</p>
      {song.author && <p className="mt-0.5 text-xs text-slate-300">{song.author}</p>}
      {song.copyright && <p className="text-xs text-slate-400">{song.copyright}</p>}
      {facts.length > 0 && <p className="text-xs text-slate-400">{facts.join(' · ')}</p>}
      <div className="mt-2 space-y-2 border-t border-slate-700 pt-2 text-slate-300">
        {shown.length === 0 && <p className="text-slate-500">{t('songs.noLyrics')}</p>}
        {shown.map((lines, index) => (
          <div key={index}>
            {lines.map((line, i) => (
              <div key={i} className="truncate">
                {line}
              </div>
            ))}
          </div>
        ))}
        {cut && <p className="text-slate-500">…</p>}
      </div>
    </div>,
    document.body,
  );
}
