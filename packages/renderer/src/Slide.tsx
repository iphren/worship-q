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

interface Lyrics {
  /** Changes whenever different lyrics are shown, which is what a transition fades across. */
  key: string;
  lines: string[];
  style: CSSProperties;
}

function fade(element: HTMLElement | null, from: number, to: number) {
  return element?.animate?.([{ opacity: from }, { opacity: to }], {
    duration: TRANSITION_MS,
    easing: 'ease-in-out',
    fill: 'forwards',
  });
}

/** Draws one frame at the output's own pixel size. */
export function Slide({ frame, width, height, measure, transition }: SlideProps) {
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
  const showMedia = media && mediaFailed !== media.url;
  const onMedia = Boolean(showMedia);
  const color = onMedia ? '#ffffff' : contrastTextColor(frame.background.color);
  const fill: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };

  const lyrics: Lyrics | null =
    piece && fitted
      ? {
          key: `${frame.song!.id}:${frame.pieceId}`,
          lines: piece.lines,
          style: {
            left: fitted.geometry.marginX,
            top: fitted.geometry.marginY,
            width: fitted.geometry.width,
            height: fitted.geometry.height,
            fontFamily: cssFontFamily(frame.fontFamily),
            fontSize: piece.fontSize,
            lineHeight: fitted.geometry.lineHeight,
            color,
            textShadow: onMedia
              ? '0 0 0.12em rgba(0,0,0,0.9), 0 0.04em 0.08em rgba(0,0,0,0.8)'
              : 'none',
          },
        }
      : null;

  // The lyrics last drawn, so a change of lyrics can fade them out over the new ones.
  const shown = useRef(lyrics);
  const [outgoing, setOutgoing] = useState<Lyrics | null>(null);
  const incomingRef = useRef<HTMLDivElement>(null);
  const outgoingRef = useRef<HTMLDivElement>(null);
  const lyricsKey = lyrics?.key ?? null;

  useLayoutEffect(() => {
    const previous = shown.current;
    if (!transition || (previous?.key ?? null) === lyricsKey) return;
    setOutgoing(previous);
    fade(incomingRef.current, 0, 1);
  }, [lyricsKey, transition]);

  useLayoutEffect(() => {
    shown.current = lyrics;
  });

  useLayoutEffect(() => {
    if (!outgoing) return;
    const animation = fade(outgoingRef.current, 1, 0);
    if (!animation) return setOutgoing(null);
    animation.onfinish = () => setOutgoing(null);
    return () => animation.cancel();
  }, [outgoing]);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        background: frame.background.color,
      }}
    >
      {showMedia && media.kind === 'image' && (
        <img
          key={media.url}
          src={media.url}
          alt=""
          draggable={false}
          style={fill}
          onError={() => setMediaFailed(media.url)}
        />
      )}
      {showMedia && media.kind === 'video' && (
        <video
          key={media.url}
          src={media.url}
          style={fill}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setMediaFailed(media.url)}
        />
      )}
      {outgoing && <LyricsBlock ref={outgoingRef} lyrics={outgoing} />}
      {lyrics && <LyricsBlock key={lyrics.key} ref={incomingRef} lyrics={lyrics} />}
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
