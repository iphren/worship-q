/**
 * The live view's drawings of a workspace's outputs, made by the renderer the slideshow and
 * the subtitle overlay use, from the snapshot and the workspace's output looks. Fonts are the
 * browser's: one this computer lacks is drawn in the renderer's fallback.
 */
import type { AdminLiveView, OutputFrame, OutputKind } from '@worship-q/protocol';
import {
  SUBTITLE_BOTTOM,
  SUBTITLE_HEIGHT,
  ScaledSlide,
  buildFrame,
  fontAvailable,
} from '@worship-q/renderer';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

type LiveOn = Extract<AdminLiveView, { live: true }>;

/** The size the outputs are fitted for, so text wraps and sizes as on a common screen. */
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
/** The part of the overlay shown in the bar: its text band, with a little room above. */
const BAR_FRACTION = SUBTITLE_HEIGHT + SUBTITLE_BOTTOM + 0.04;

const CHECKERBOARD = 'repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%) 50% / 16px 16px';

/** The frame an output draws now. Polling brings an equal snapshot every few seconds; the
 * frame keeps its identity then, so the renderer does not lay the text out again. */
function useFrame(view: LiveOn, workspaceId: string, kind: OutputKind): OutputFrame {
  const look = view.looks[kind];
  const next = buildFrame({
    kind,
    snapshot: view.snapshot,
    look,
    fontAvailable: fontAvailable(look?.fontFamily ?? null),
    songBackground: view.songBackground,
    fileUrl: (fileName) => api.workspaceFileUrl(workspaceId, fileName),
  });
  const key = JSON.stringify(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the frame
  return useMemo(() => next, [key]);
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

/** The slideshow as its screen shows it. */
export function SlideshowPreview(props: { view: LiveOn; workspaceId: string }) {
  const frame = useFrame(props.view, props.workspaceId, 'slideshow');
  const { ref, width } = useWidth();
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-lg border border-slate-700">
      {width > 0 && (
        <ScaledSlide
          frame={frame.website ? { ...frame, website: null } : frame}
          width={OUTPUT_WIDTH}
          height={OUTPUT_HEIGHT}
          displayWidth={width}
          transition
        />
      )}
      {/* A website is shown by the screen itself; here it is named by its address. */}
      {frame.website && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <span className="truncate text-sm text-slate-300">Website: {frame.website.url}</span>
        </div>
      )}
    </div>
  );
}

/** The subtitle overlay's band of text, over a pattern standing in for the video under it. */
export function SubtitleBar(props: { view: LiveOn; workspaceId: string }) {
  const frame = useFrame(props.view, props.workspaceId, 'subtitle');
  const { ref, width } = useWidth();
  const factor = width / OUTPUT_WIDTH;
  return (
    <div
      ref={ref}
      className="w-full overflow-hidden rounded-lg border border-slate-700"
      style={{ background: CHECKERBOARD, height: OUTPUT_HEIGHT * BAR_FRACTION * factor }}
    >
      {width > 0 && (
        <div style={{ marginTop: -OUTPUT_HEIGHT * (1 - BAR_FRACTION) * factor }}>
          <ScaledSlide
            frame={frame}
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
