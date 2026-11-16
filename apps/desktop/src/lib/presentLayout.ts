/**
 * The Present page's slides layout: run sheet items stacked down the page (`vertical`), or side
 * by side as columns whose slides stack down each column (`horizontal`, the default). Pure, so
 * the choice and the scrolling arithmetic can be tested.
 */

export type PresentLayout = 'vertical' | 'horizontal';

/** A column's width, one slide card wide (spike M0.1). */
export const COLUMN_REM = 16;
/** The gap between columns, in pixels (Tailwind `gap-3`). */
export const COLUMN_GAP_PX = 12;
/** Fewer columns than this fit: the slides stack down the page instead (H4). */
export const MIN_COLUMNS = 2;

/** How many columns fit across `width` pixels. */
export function columnsFit(width: number, remPx = 16): number {
  const column = COLUMN_REM * remPx;
  return Math.max(0, Math.floor((width + COLUMN_GAP_PX) / (column + COLUMN_GAP_PX)));
}

/** The layout shown: the chosen one, unless columns are chosen and too few fit (H4). */
export function presentLayoutFor(width: number, setting: PresentLayout, remPx = 16): PresentLayout {
  return setting === 'horizontal' && columnsFit(width, remPx) >= MIN_COLUMNS
    ? 'horizontal'
    : 'vertical';
}

/**
 * Whether the arrow keys go against the layout (H2), and how: with the items stacked down the
 * page, Up and Down should move between them (`vertical-default`, fixed by swapping the keys);
 * with the items side by side, Left and Right should (`horizontal-swapped`, fixed by not
 * swapping them). Null when they match.
 */
export function layoutKeysMismatch(
  layout: PresentLayout,
  swapArrows: boolean,
): 'vertical-default' | 'horizontal-swapped' | null {
  if (layout === 'vertical' && !swapArrows) return 'vertical-default';
  if (layout === 'horizontal' && swapArrows) return 'horizontal-swapped';
  return null;
}

/** Where something lies along one axis, in the same coordinates as its container's span. */
export interface Span {
  start: number;
  end: number;
}

/** A scroll container along one axis: where it lies, and how far it is scrolled. */
export interface Scroller extends Span {
  scroll: number;
  /** How far it can scroll: its content's size less its own. */
  max: number;
}

const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), max));

/**
 * The scroll position that brings `target` to the start of `container`, or null when that
 * would push `keep` past its end; like `scrollToTop` before, for either axis.
 */
export function scrollToStart(container: Scroller, target: Span, keep?: Span): number | null {
  if (keep && keep.end - target.start > container.end - container.start) return null;
  return clamp(container.scroll + target.start - container.start, container.max);
}

/** The scroll position that brings `target` into view, moving as little as it can. */
export function scrollToNearest(container: Scroller, target: Span): number {
  if (target.start < container.start)
    return clamp(container.scroll + target.start - container.start, container.max);
  if (target.end > container.end) {
    // Longer than the container: show its start.
    const by = Math.min(target.end - container.end, target.start - container.start);
    return clamp(container.scroll + by, container.max);
  }
  return clamp(container.scroll, container.max);
}

/** The scroll position that centres `target` in `container`, as far as it can scroll. */
export function scrollToCentre(container: Scroller, target: Span): number {
  const centre = (target.start + target.end) / 2 - (container.start + container.end) / 2;
  return clamp(container.scroll + centre, container.max);
}

/** Up to this many columns across, the focused column is centred; more, and it is second. */
export const CENTRE_UP_TO_COLUMNS = 2;

/**
 * The scroll position for the focused item's column in the row: in the middle while the row
 * is less than three columns wide, otherwise second from the left, so the column before it shows
 * too; as far as the row can scroll.
 */
export function scrollToFocus(container: Scroller, target: Span, remPx = 16): number {
  if (columnsFit(container.end - container.start, remPx) <= CENTRE_UP_TO_COLUMNS) {
    return scrollToCentre(container, target);
  }
  const slot = COLUMN_REM * remPx + COLUMN_GAP_PX;
  return clamp(container.scroll + target.start - container.start - slot, container.max);
}

/** The root font size in pixels, which `rem` widths are measured in. */
export function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** An element's span and scroll along an axis, read from the page. */
export function scroller(element: HTMLElement, axis: 'x' | 'y'): Scroller {
  const rect = element.getBoundingClientRect();
  return axis === 'x'
    ? {
        start: rect.left,
        end: rect.left + element.clientWidth,
        scroll: element.scrollLeft,
        max: element.scrollWidth - element.clientWidth,
      }
    : {
        start: rect.top,
        end: rect.top + element.clientHeight,
        scroll: element.scrollTop,
        max: element.scrollHeight - element.clientHeight,
      };
}

/** An element's span along an axis, read from the page. */
export function span(element: Element, axis: 'x' | 'y'): Span {
  const rect = element.getBoundingClientRect();
  return axis === 'x'
    ? { start: rect.left, end: rect.right }
    : { start: rect.top, end: rect.bottom };
}

/** Scrolls `element` smoothly to `position` along an axis. */
export function scrollAlong(element: HTMLElement, axis: 'x' | 'y', position: number | null): void {
  if (position === null) return;
  element.scrollTo({ [axis === 'x' ? 'left' : 'top']: position, behavior: 'smooth' });
}
