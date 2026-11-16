import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Scroll positions by key, kept while the app is open. */
const positions = new Map<string, number>();

/** Stops putting back a remembered position once the user moves the element themselves. */
const USER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/** The axis an element scrolls along: down (`y`), or across (`x`). */
export type ScrollAxis = 'x' | 'y';

/**
 * Remembers where an element was scrolled to under `key`, and puts it back when the element is
 * shown again: after a page switch remounts it, or a tab switch hides and shows it. A position
 * that its content is not yet tall (or wide) enough for is put back once the content has
 * loaded.
 */
export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  key: string,
  axis: ScrollAxis = 'y',
) {
  // The position still to put back, until the element can scroll that far.
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let shown = isShown(element);
    pending.current = positions.get(key) ?? 0;
    restore(element, pending, axis);

    const onScroll = () => {
      if (pending.current === null && isShown(element)) positions.set(key, position(element, axis));
    };
    const onInput = () => {
      pending.current = null;
    };
    // A hidden tab has no size; showing it again resizes it from nothing.
    const observer = new ResizeObserver(() => {
      const nowShown = isShown(element);
      if (nowShown && !shown) pending.current = positions.get(key) ?? 0;
      shown = nowShown;
      restore(element, pending, axis);
    });
    observer.observe(element);
    element.addEventListener('scroll', onScroll, { passive: true });
    for (const type of USER_INPUT) element.addEventListener(type, onInput, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', onScroll);
      for (const type of USER_INPUT) element.removeEventListener(type, onInput);
    };
  }, [ref, key, axis]);

  // Content arrives in later renders; each one may make room for the remembered position.
  useLayoutEffect(() => {
    if (ref.current) restore(ref.current, pending, axis);
  });
}

function isShown(element: HTMLElement) {
  return element.clientHeight > 0;
}

function position(element: HTMLElement, axis: ScrollAxis) {
  return axis === 'x' ? element.scrollLeft : element.scrollTop;
}

function restore(element: HTMLElement, pending: { current: number | null }, axis: ScrollAxis) {
  const target = pending.current;
  if (target === null || !isShown(element)) return;
  if (axis === 'x') element.scrollLeft = target;
  else element.scrollTop = target;
  if (Math.abs(position(element, axis) - target) < 1) pending.current = null;
}
