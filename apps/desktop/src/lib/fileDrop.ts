/**
 * Files dragged onto the window from Finder or Explorer (media uploads plan, M0.4, M4.4).
 * Tauri reports where the pointer is in its own units: CSS pixels measured from the top of
 * the webview on macOS, which reaches under the title bar, and physical pixels from the top
 * of the page on Windows. `pagePoint` turns either into the page's coordinates.
 */
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef } from 'react';

export interface Point {
  x: number;
  y: number;
}

/**
 * Where a dropped item lands among rows, by their vertical extent on screen: before the
 * first row whose middle is below the pointer, or after the last. The gaps between rows and
 * the space under the last one count too, so the nearest place is always found.
 */
export function dropIndex(rows: readonly { top: number; bottom: number }[], y: number): number {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    if (y < (row.top + row.bottom) / 2) return index;
  }
  return rows.length;
}

/**
 * The page point of a native drag position. `titleBar` is the strip of the webview the page
 * does not cover on macOS (`webview height − page height`, 0 elsewhere).
 */
export function pagePoint(
  raw: Point,
  platform: 'macos' | 'other',
  scale: number,
  titleBar: number,
): Point {
  if (platform === 'macos') return { x: raw.x, y: raw.y - titleBar };
  return { x: raw.x / scale, y: raw.y / scale };
}

/** Whether a point is inside an element's box on screen. */
export function inside(element: Element | null, point: Point): boolean {
  if (!element) return false;
  const box = element.getBoundingClientRect();
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

export interface FileDropHandlers {
  /** The pointer moved, carrying files, to `point`; null when it left or dropped. */
  over?(point: Point | null): void;
  /** Files were dropped at `point`, in the order they were selected. */
  drop(paths: string[], point: Point): void;
}

const platform = (): 'macos' | 'other' =>
  typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? 'macos' : 'other';

/**
 * Calls `handlers` while files are dragged over the window and when they are dropped. Each
 * caller decides from the point whether the files are over its own area. Repeated `over`
 * events at the same position are left out.
 */
export function useFileDrop(handlers: FileDropHandlers, enabled = true): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    let titleBar = 0;
    let last: Point | null = null;
    const toPage = (raw: Point) =>
      pagePoint(raw, platform(), window.devicePixelRatio || 1, titleBar);
    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const payload = event.payload;
        if (payload.type === 'enter') {
          // Measured on each enter: the window may have been resized or moved to a display
          // with another scale since.
          if (platform() === 'macos') {
            const window_ = getCurrentWindow();
            const [size, scale] = await Promise.all([window_.innerSize(), window_.scaleFactor()]);
            titleBar = Math.max(0, size.height / scale - window.innerHeight);
          }
          last = null;
        }
        if (payload.type === 'enter' || payload.type === 'over') {
          const point = toPage(payload.position);
          if (last && last.x === point.x && last.y === point.y) return;
          last = point;
          latest.current.over?.(point);
        } else if (payload.type === 'drop') {
          last = null;
          latest.current.over?.(null);
          latest.current.drop(payload.paths, toPage(payload.position));
        } else {
          last = null;
          latest.current.over?.(null);
        }
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [enabled]);
}
