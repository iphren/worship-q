import { useEffect, useRef, type CSSProperties } from 'react';
import type { BuiltinBackground as BuiltinName } from '@worship-q/protocol';
import { AURORA_SKY_CSS, auroraPhase, createAuroraPainter } from './aurora';

/** Light changes slowly, so a steady 30 drawings a second is plenty. */
const FRAME_MS = 1000 / 30;
/**
 * The canvas is drawn at most this wide and stretched to fit: everything in it is soft, so
 * a big screen looks the same, and previews drawn at the output's full size stay cheap.
 */
const MAX_WIDTH = 1280;
const MIN_WIDTH = 160;

/** A built-in background, filling its parent and moving while it is on screen. */
export function BuiltinBackgroundCanvas(props: { name: BuiltinName; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const paint = createAuroraPainter(context);

    // Its size on screen, after any scaling of a preview, at the screen's pixel density.
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const width = Math.round(
        Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rect.width * (window.devicePixelRatio || 1))),
      );
      const height = Math.round((width * rect.height) / rect.width);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(canvas);
    fit();

    let request = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      request = requestAnimationFrame(tick);
      if (now - last < FRAME_MS - 2) return;
      last = now;
      paint(auroraPhase());
    };
    paint(auroraPhase());
    request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      observer?.disconnect();
    };
  }, [props.name]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        background: AURORA_SKY_CSS,
        ...props.style,
      }}
    />
  );
}
