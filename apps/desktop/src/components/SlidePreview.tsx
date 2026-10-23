import type { OutputFrame } from '@worship-q/protocol';
import { ScaledSlide } from '@worship-q/renderer';
import { useLayoutEffect, useRef, useState } from 'react';
import { useOutputStatus } from './OutputPanel';

/** The slideshow as the output draws it, scaled to the width available here. */
export function SlidePreview(props: { frame?: OutputFrame }) {
  const status = useOutputStatus();
  const holder = useRef<HTMLDivElement>(null);
  const [displayWidth, setDisplayWidth] = useState(0);

  useLayoutEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setDisplayWidth(element.clientWidth));
    observer.observe(element);
    setDisplayWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Fit for the real output's size, so the preview wraps and sizes text exactly as it does.
  const monitor = status.decision.kind === 'open' ? status.decision.monitor : null;
  const width = monitor?.width ?? 1920;
  const height = monitor?.height ?? 1080;

  return (
    <div
      ref={holder}
      className="w-full overflow-hidden rounded-md border border-slate-600 bg-black"
    >
      {displayWidth > 0 && (
        <ScaledSlide
          frame={props.frame ?? status.frame}
          width={width}
          height={height}
          displayWidth={displayWidth}
          transition
        />
      )}
    </div>
  );
}
