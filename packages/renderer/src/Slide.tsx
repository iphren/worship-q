import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react';
import { EMPTY_FRAME, type OutputFrame } from '@worship-q/protocol';
import { contrastTextColor, fitSong, outputGeometry, type Measure } from './layout';

export { EMPTY_FRAME, type OutputFrame };

const FALLBACK_FONTS =
  'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_WEIGHT = 600;
/** How long one set of lyrics takes to fade into the next. */
const TRANSITION_MS = 300;

export function cssFontFamily(family: string | null): string {
  return family ? `"${family.replace(/"/g, '\\"')}", ${FALLBACK_FONTS}` : FALLBACK_FONTS;
}

/** Measures text with the browser's own font metrics, cached per font. */
export function createCanvasMeasure(fontFamily: string | null): Measure {
  const REFERENCE = 200;
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = `${FONT_WEIGHT} ${REFERENCE}px ${cssFontFamily(fontFamily)}`;
  const cache = new Map<string, number>();
  return (text) => {
    let width = cache.get(text);
    if (width === undefined) {
      width = context.measureText(text).width / REFERENCE;
      cache.set(text, width);
    }
    return width;
  };
}

export interface SlideProps {
  frame: OutputFrame;
  /** Size of the output in pixels. The slide is drawn at exactly this size. */
  width: number;
  height: number;
  /** Supplied in tests; defaults to canvas measurement. */
  measure?: Measure;
  /** Fade between pieces, and into and out of blank, instead of cutting. */
  transition?: boolean;
}

interface Layer {
  /** Changes whenever the layer shows something else, which is what a transition fades across. */
  key: string;
}

interface Lyrics extends Layer {
  lines: string[];
  style: CSSProperties;
}

interface Background extends Layer {
  color: string;
  media: OutputFrame['background']['media'];
}

const CAN_ANIMATE = typeof Element !== 'undefined' && 'animate' in Element.prototype;

/** Animates opacity to `to`, from `from` or else from wherever it is now. */
function fade(element: HTMLElement | undefined, from: number | null, to: number) {
  if (!element || !CAN_ANIMATE) return undefined;
  const start = from ?? Number(getComputedStyle(element).opacity);
  for (const animation of element.getAnimations()) animation.cancel();
  return element.animate([{ opacity: start }, { opacity: to }], {
    duration: TRANSITION_MS,
    easing: 'ease-in-out',
    fill: 'forwards',
  });
}

/**
 * Crossfades a layer: what it showed before stays on screen, under the new content, until that
 * has faded in. The old content keeps its element, so a video plays on while it fades. With
 * `fadeOut` the old content also fades away as the new arrives; without it, it is covered.
 */
function useCrossfade<T extends Layer>(current: T | null, enabled: boolean, fadeOut: boolean) {
  const [leaving, setLeaving] = useState<T[]>([]);
  const [last, setLast] = useState(current);
  const key = current?.key ?? null;
  if (last !== current) {
    setLast(current);
    if (enabled && CAN_ANIMATE && last && last.key !== key) {
      setLeaving([...leaving.filter((layer) => layer.key !== last.key && layer.key !== key), last]);
    }
  }

  const elements = useRef(new Map<string, HTMLElement>());
  const started = useRef(new WeakSet<HTMLElement>());
  const shownKey = useRef(key);

  useLayoutEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    if (!enabled || key === null) return;
    const element = elements.current.get(key);
    // Content coming back mid-fade picks up from where it had faded to.
    const returning = element !== undefined && started.current.delete(element);
    fade(element, returning ? null : 0, 1);
  }, [key, enabled]);

  useLayoutEffect(() => {
    for (const layer of leaving) {
      const element = elements.current.get(layer.key);
      if (!element || started.current.has(element)) continue;
      started.current.add(element);
      const animation = fade(element, null, fadeOut ? 0 : 1);
      if (animation) {
        animation.onfinish = () =>
          setLeaving((list) => list.filter((item) => item.key !== layer.key));
      }
    }
  }, [leaving, fadeOut]);

  const layers = leaving.filter((layer) => layer.key !== key);
  if (current) layers.push(current);
  const ref = (layerKey: string) => (element: HTMLElement | null) => {
    if (element) elements.current.set(layerKey, element);
    else elements.current.delete(layerKey);
  };
  return { layers, ref };
}

/** Draws one frame at the output's own pixel size. */
export function Slide({ frame, width, height, measure, transition = false }: SlideProps) {
  const [mediaFailed, setMediaFailed] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => !cancelled && setFontsReady((n) => n + 1));
    return () => {
      cancelled = true;
    };
  }, [frame.fontFamily]);

  const fitted = useMemo(() => {
    if (!frame.song || width <= 0 || height <= 0) return null;
    const geometry = outputGeometry(width, height, { wrap: frame.wrap, scale: frame.scale });
    const song = fitSong(
      frame.song.pieces.map((piece) => piece.lines),
      geometry,
      measure ?? createCanvasMeasure(frame.fontFamily),
    );
    return { geometry, song };
    // fontsReady: measure again once fonts have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.song, frame.wrap, frame.scale, frame.fontFamily, width, height, measure, fontsReady]);

  const pieceIndex = frame.song?.pieces.findIndex((piece) => piece.id === frame.pieceId) ?? -1;
  const piece = !frame.blank && fitted && pieceIndex >= 0 ? fitted.song.pieces[pieceIndex] : null;

  const media = frame.background.media;
  const shownMedia = media && mediaFailed !== media.url ? media : null;
  const onMedia = shownMedia !== null;
  const backgroundColor = frame.background.color;
  const color = onMedia ? '#ffffff' : contrastTextColor(backgroundColor);
  const songId = frame.song?.id;
  const pieceId = frame.pieceId;
  const fontFamily = frame.fontFamily;

  const background = useMemo<Background>(
    () => ({
      key: `${backgroundColor}|${shownMedia?.url ?? ''}`,
      color: backgroundColor,
      media: shownMedia,
    }),
    [backgroundColor, shownMedia],
  );

  const lyrics = useMemo<Lyrics | null>(
    () =>
      piece && fitted
        ? {
            key: `${songId}:${pieceId}`,
            lines: piece.lines,
            style: {
              left: fitted.geometry.marginX,
              top: fitted.geometry.marginY,
              width: fitted.geometry.width,
              height: fitted.geometry.height,
              fontFamily: cssFontFamily(fontFamily),
              fontSize: piece.fontSize,
              lineHeight: fitted.geometry.lineHeight,
              color,
              textShadow: onMedia
                ? '0 0 0.12em rgba(0,0,0,0.9), 0 0.04em 0.08em rgba(0,0,0,0.8)'
                : 'none',
            },
          }
        : null,
    [piece, fitted, songId, pieceId, fontFamily, color, onMedia],
  );

  const backgrounds = useCrossfade(background, transition, false);
  const lyricLayers = useCrossfade(lyrics, transition, true);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        background: backgroundColor,
      }}
    >
      {backgrounds.layers.map((layer) => (
        <BackgroundBlock
          key={layer.key}
          ref={backgrounds.ref(layer.key)}
          background={layer}
          onMediaError={setMediaFailed}
        />
      ))}
      {lyricLayers.layers.map((layer) => (
        <LyricsBlock key={layer.key} ref={lyricLayers.ref(layer.key)} lyrics={layer} />
      ))}
    </div>
  );
}

function BackgroundBlock(props: {
  background: Background;
  ref: Ref<HTMLDivElement>;
  onMediaError: (url: string) => void;
}) {
  const { color, media } = props.background;
  const fill: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };
  return (
    <div ref={props.ref} style={{ position: 'absolute', inset: 0, background: color }}>
      {media?.kind === 'image' && (
        <img
          src={media.url}
          alt=""
          draggable={false}
          style={fill}
          onError={() => props.onMediaError(media.url)}
        />
      )}
      {media?.kind === 'video' && (
        <video
          src={media.url}
          style={fill}
          autoPlay
          loop
          muted
          playsInline
          onError={() => props.onMediaError(media.url)}
        />
      )}
    </div>
  );
}

function LyricsBlock(props: { lyrics: Lyrics; ref: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={props.ref}
      style={{
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: FONT_WEIGHT,
        textAlign: 'center',
        ...props.lyrics.style,
      }}
    >
      {props.lyrics.lines.map((line, index) => (
        <div key={index} style={{ whiteSpace: 'pre' }}>
          {line}
        </div>
      ))}
    </div>
  );
}

/** A slide drawn at the output's size and scaled down to `displayWidth`. */
export function ScaledSlide(props: SlideProps & { displayWidth: number }) {
  const { displayWidth, ...slide } = props;
  const factor = slide.width > 0 ? displayWidth / slide.width : 0;
  return (
    <div style={{ width: displayWidth, height: slide.height * factor, overflow: 'hidden' }}>
      <div style={{ transform: `scale(${factor})`, transformOrigin: 'top left' }}>
        <Slide {...slide} />
      </div>
    </div>
  );
}
