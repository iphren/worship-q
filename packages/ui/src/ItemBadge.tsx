/**
 * The badge marking an item's kind (U12), the same on the desktop, on phones and on the admin
 * pages. Its classes are Tailwind's: each app using it adds this folder with `@source`.
 */
import type { ItemBadge } from '@worship-q/protocol';
import type { ReactNode } from 'react';

/** Each kind's icon, drawn in a 24 by 24 box with a 2-pixel stroke. */
export const ITEM_ICON_SHAPES: Record<ItemBadge, ReactNode> = {
  slides: <path d="M2 3h20M3 3v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V3M12 16v5M8 21h8" />,
  pdf: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m10 9 5 3-5 3z" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  // An open book.
  bible: (
    <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  ),
};

/**
 * Full class names, so Tailwind finds them. Sky and amber are left out: they already mean
 * selected and removed.
 */
export const ITEM_BADGE_COLOURS: Record<ItemBadge, string> = {
  slides: 'bg-orange-500/20 text-orange-300',
  pdf: 'bg-rose-500/20 text-rose-300',
  image: 'bg-emerald-500/20 text-emerald-300',
  video: 'bg-violet-500/20 text-violet-300',
  website: 'bg-fuchsia-500/20 text-fuchsia-300',
  bible: 'bg-[#00E6FF]/20 text-[#00E6FF]',
};

/** English names of the kinds, for pages without translations. */
export const ITEM_BADGE_LABELS: Record<ItemBadge, string> = {
  slides: 'Slides',
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  website: 'Web',
  bible: 'Bible',
};

/** A kind's icon on its own, in the current text colour. */
export function ItemIcon(props: { badge: ItemBadge; className?: string }) {
  return (
    <svg
      className={props.className ?? 'h-3 w-3'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ITEM_ICON_SHAPES[props.badge]}
    </svg>
  );
}

/**
 * A kind's coloured badge, labelled for screen readers and on hover. It is `relative` so its
 * `sr-only` label, which is absolutely positioned, stays inside a scrolling list.
 */
export function ItemBadgeMark(props: { badge: ItemBadge; label?: string; className?: string }) {
  const label = props.label ?? ITEM_BADGE_LABELS[props.badge];
  return (
    <span
      className={`relative inline-flex shrink-0 rounded p-0.5 align-middle ${ITEM_BADGE_COLOURS[props.badge]} ${props.className ?? ''}`}
      title={label}
    >
      <ItemIcon badge={props.badge} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
