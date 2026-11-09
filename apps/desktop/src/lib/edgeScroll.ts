/**
 * Scrolls a list while something is dragged near its top or bottom edge: files from the
 * desktop, or a row being reordered. Drags only report the pointer when it moves, so the
 * scrolling runs on animation frames for as long as the pointer rests in an edge zone.
 */
import { useEffect, useRef, type RefObject } from 'react';
import type { Point } from './fileDrop';

/** How tall the zone at each edge is, in CSS pixels. */
export const EDGE_ZONE = 40;
/** The fastest scroll, at the very edge, in CSS pixels per frame. */
export const EDGE_SPEED = 14;

/**
 * How far to scroll this frame for a pointer at `y` over a box: negative near the top,
 * positive near the bottom, faster the closer to the edge, and 0 in the middle or when the
 * pointer is outside the box sideways or beyond it vertically by more than one zone.
 */
export function edgeScrollStep(
  box: { top: number; bottom: number; left: number; right: number },
  point: Point,
  zone = EDGE_ZONE,
  speed = EDGE_SPEED,
): number {
  if (point.x < box.left || point.x > box.right) return 0;
  const zoneOf = Math.min(zone, (box.bottom - box.top) / 2);
  if (zoneOf <= 0) return 0;
  const fromTop = point.y - box.top;
  const fromBottom = box.bottom - point.y;
  if (fromTop < -zoneOf || fromBottom < -zoneOf) return 0;
  if (fromTop < zoneOf) return -Math.ceil(speed * Math.min(1, (zoneOf - fromTop) / zoneOf));
  if (fromBottom < zoneOf) return Math.ceil(speed * Math.min(1, (zoneOf - fromBottom) / zoneOf));
  return 0;
}

/**
 * Returns a function to call with the pointer during a drag (null when it ends). While the
 * pointer is in an edge zone of `ref`'s element, it scrolls that element and calls
 * `onScroll` with the pointer, so what depends on row positions can be worked out again.
 */
export function useEdgeScroll(
  ref: RefObject<HTMLElement | null>,
  onScroll?: (point: Point) => void,
): (point: Point | null) => void {
  const pointer = useRef<Point | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef(onScroll);
  latest.current = onScroll;

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => stop, []);

  const tick = () => {
    frame.current = null;
    const element = ref.current;
    const point = pointer.current;
    if (!element || !point) return;
    const step = edgeScrollStep(element.getBoundingClientRect(), point);
    if (step === 0) return;
    const before = element.scrollTop;
    element.scrollTop = before + step;
    if (element.scrollTop === before) return;
    latest.current?.(point);
    frame.current = requestAnimationFrame(tick);
  };

  return (point) => {
    pointer.current = point;
    if (!point) return stop();
    if (frame.current === null) tick();
  };
}
