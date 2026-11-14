import type { OutputFrame } from '@worship-q/protocol';
import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { SUBTITLE_BOTTOM, SUBTITLE_HEIGHT } from './layout';
import { ScaledSlide } from './Slide';

/** The size the overlay is fitted for, so text wraps and sizes as on a common stream. */
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
/** The part of the overlay shown in the bar: its text band, with a little room above. */
export const SUBTITLE_BAR_FRACTION = SUBTITLE_HEIGHT + SUBTITLE_BOTTOM + 0.04;

const CHECKERBOARD = 'repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%) 50% / 16px 16px';

/** The subtitle overlay's band of text, over a pattern standing in for the video under it.
 * The text sits at the foot of its band and its height varies, so the bar's window is moved
 * to keep the drawn text in its middle. */
export function SubtitleBar(props: { frame: OutputFrame; className?: string }) {
  const { ref, width } = useWidth();
  const slideRef = useRef<HTMLDivElement>(null);
  const centre = useTextCentre(slideRef, width);
  const factor = width / OUTPUT_WIDTH;
  const barHeight = OUTPUT_HEIGHT * SUBTITLE_BAR_FRACTION * factor;
  const offset =
    centre === null
      ? -OUTPUT_HEIGHT * (1 - SUBTITLE_BAR_FRACTION) * factor
      : barHeight / 2 - centre * factor;
  return (
    <div
      ref={ref}
      className={props.className}
      style={{ width: '100%', overflow: 'hidden', background: CHECKERBOARD, height: barHeight }}
    >
      {width > 0 && (
        <div ref={slideRef} style={{ marginTop: offset, transition: 'margin-top 300ms' }}>
          <ScaledSlide
            frame={props.frame}
            width={OUTPUT_WIDTH}
            height={OUTPUT_HEIGHT}
            displayWidth={width}
            transition
          />
        </div>
      )}
    </div>
  );
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** The middle of the text drawn in `slideRef`, in output pixels from the slide's top, or
 * null while there is none. Measured again whenever the drawing changes. */
function useTextCentre(slideRef: RefObject<HTMLDivElement | null>, width: number) {
  const [centre, setCentre] = useState<number | null>(null);
  useLayoutEffect(() => {
    const slide = slideRef.current;
    if (!slide || width <= 0) return;
    const factor = width / OUTPUT_WIDTH;
    let frameId = 0;
    const measure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const origin = slide.getBoundingClientRect().top;
        let top = Infinity;
        let bottom = -Infinity;
        const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (rect.height === 0) continue;
          top = Math.min(top, rect.top);
          bottom = Math.max(bottom, rect.bottom);
        }
        setCentre(top < bottom ? ((top + bottom) / 2 - origin) / factor : null);
      });
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(slide, {
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ['style'],
    });
    void document.fonts.ready.then(measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, [slideRef, width]);
  return centre;
}
