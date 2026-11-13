/**
 * One line of text that rolls when it is wider than its box: it waits, slides gradually to
 * show the end, waits, and slides back. Text that fits stays still, and so does all text
 * for anyone who asks for reduced motion (it is then cut off with an ellipsis).
 */
import { useEffect, useRef, type ReactNode } from 'react';

const PAUSE_MS = 1500;
const MS_PER_PIXEL = 35;

export function Marquee(props: { children: ReactNode; className?: string; title?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const outer = box.current;
    const inner = text.current;
    if (!outer || !inner) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let animation: Animation | null = null;
    const measure = () => {
      animation?.cancel();
      animation = null;
      inner.style.display = still ? 'inline' : 'inline-block';
      if (still || typeof inner.animate !== 'function') return;
      const overflow = Math.ceil(inner.scrollWidth - outer.clientWidth);
      if (overflow <= 1) return;
      const roll = overflow * MS_PER_PIXEL;
      const total = roll + 2 * PAUSE_MS;
      const end = `translateX(-${overflow}px)`;
      animation = inner.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: PAUSE_MS / total },
          { transform: end, offset: (PAUSE_MS + roll) / total },
          { transform: end, offset: 1 },
        ],
        { duration: total, iterations: Infinity, direction: 'alternate', easing: 'linear' },
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(outer);
    observer?.observe(inner);
    return () => {
      observer?.disconnect();
      animation?.cancel();
    };
  });
  return (
    <span
      ref={box}
      title={props.title}
      className={`block overflow-hidden text-ellipsis whitespace-nowrap ${props.className ?? ''}`}
    >
      <span ref={text}>{props.children}</span>
    </span>
  );
}
