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
import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  // A video plays muted, as previews do, until it is unmuted here. The choice holds for the
  // videos after it, until the page is left.
  const [sound, setSound] = useState(false);
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-lg border border-slate-700">
      {width > 0 && (
        <ScaledSlide
          frame={frame.website ? { ...frame, website: null } : frame}
          width={OUTPUT_WIDTH}
          height={OUTPUT_HEIGHT}
          displayWidth={width}
          transition
          sound={sound}
        />
      )}
      {frame.video && !frame.blank && (
        <button
          type="button"
          onClick={() => setSound((on) => !on)}
          aria-pressed={sound}
          title={sound ? 'Mute this preview' : 'Hear the video on this computer'}
          className="absolute right-2 bottom-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2.5 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-800"
        >
          <SpeakerIcon muted={!sound} />
          {sound ? 'Mute' : 'Unmute'}
        </button>
      )}
      {/* A website is shown by the screen itself (many refuse to be embedded); here it is
          offered as a link to open beside the page. */}
      {frame.website && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
          {webAddress(frame.website.url) ? (
            <a
              href={frame.website.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
            >
              Open website ↗
            </a>
          ) : null}
          <span className="max-w-full truncate text-xs text-slate-400">{frame.website.url}</span>
        </div>
      )}
    </div>
  );
}

function SpeakerIcon(props: { muted: boolean }) {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      {props.muted ? (
        <path d="m22 9-6 6M16 9l6 6" />
      ) : (
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
      )}
    </svg>
  );
}

/** Only an ordinary web address is linked: the address comes from the presenting computer. */
function webAddress(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** The subtitle overlay's band of text, over a pattern standing in for the video under it.
 * The text sits at the foot of its band and its height varies, so the bar's window is moved
 * to keep the drawn text in its middle. */
export function SubtitleBar(props: { view: LiveOn; workspaceId: string }) {
  const frame = useFrame(props.view, props.workspaceId, 'subtitle');
  const { ref, width } = useWidth();
  const slideRef = useRef<HTMLDivElement>(null);
  const centre = useTextCentre(slideRef, width);
  const factor = width / OUTPUT_WIDTH;
  const barHeight = OUTPUT_HEIGHT * BAR_FRACTION * factor;
  const offset =
    centre === null
      ? -OUTPUT_HEIGHT * (1 - BAR_FRACTION) * factor
      : barHeight / 2 - centre * factor;
  return (
    <div
      ref={ref}
      className="w-full overflow-hidden rounded-lg border border-slate-700"
      style={{ background: CHECKERBOARD, height: barHeight }}
    >
      {width > 0 && (
        <div
          ref={slideRef}
          className="transition-[margin] duration-300"
          style={{ marginTop: offset }}
        >
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
