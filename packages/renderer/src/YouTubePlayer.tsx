/**
 * A YouTube video, filling its box, following the live state's clock as a video item does
 * (YouTube control D2, D6): it plays and pauses with the clock, is moved when a command moves
 * it, and otherwise only when far off. It uses YouTube's own IFrame Player API, the supported
 * way to control the player; the page showing it must be at a web address YouTube accepts
 * (`localhost` rather than `127.0.0.1`, see the spike notes).
 */
import { useEffect, useRef, useState } from 'react';
import type { OutputClock } from '@worship-q/protocol';
import { videoCorrection, videoTarget } from './Slide';

/** What a player tells the app about its video. */
export type YouTubeReport =
  /** The video's length, known once it has loaded or begun to play; never for a live stream. */
  | { kind: 'length'; id: string; seconds: number }
  /** The video is a live stream: it only plays and pauses (D4). */
  | { kind: 'live'; id: string }
  /** It played to its end. */
  | { kind: 'ended'; id: string }
  /** YouTube would not play it: 150 and 101 for a blocked or missing video, 2, 5 or 100. */
  | { kind: 'error'; id: string; code: number };

/** The part of YouTube's player used here. */
export interface YouTubeApiPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData?(): { isLive?: boolean };
  destroy(): void;
}

/** YouTube's player states. */
export const YT_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

/** How long after a seek another is left out, so a player that cannot move yet is not hammered. */
export const YOUTUBE_SEEK_PAUSE_MS = 3000;

/** What a player must do to follow the clock at one moment. */
export interface YouTubeStep {
  seekTo: number | null;
  play: boolean;
  pause: boolean;
}

/**
 * The step that makes a player follow `clock` at `nowMs`. A live stream only plays and
 * pauses: its positions are not the clock's (D4). Otherwise a jump (a command moved the
 * clock) is followed at once, and drift as for a video item (`videoCorrection`), but never
 * within `YOUTUBE_SEEK_PAUSE_MS` of the last seek unless it is a jump, as an ad or a slow
 * start leaves the player where it was.
 */
export function youtubeStep(input: {
  clock: OutputClock;
  nowMs: number;
  current: number;
  state: number;
  live: boolean;
  jumped: boolean;
  lastSeekMs: number;
}): YouTubeStep {
  const { clock, nowMs, current, state, live, jumped, lastSeekMs } = input;
  const target = videoTarget(clock, nowMs);
  const atEnd = clock.durationSeconds > 0 && target >= clock.durationSeconds;
  const playing = clock.playing && !atEnd;
  const running = state === YT_STATE.playing || state === YT_STATE.buffering;
  let seekTo: number | null = null;
  // An unstarted player can be moved too: it then starts there (spike M0.1).
  if (!live) {
    const correction = videoCorrection(current, target, playing, jumped);
    if (correction !== null && (jumped || nowMs - lastSeekMs >= YOUTUBE_SEEK_PAUSE_MS)) {
      seekTo = correction;
    }
  }
  return { seekTo, play: playing && !running, pause: !playing && running };
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      host: string;
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
        onAutoplayBlocked?: () => void;
      };
    },
  ) => YouTubeApiPlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let api: Promise<YouTubeApi> | null = null;

/** YouTube's player script, loaded once per page. */
function loadApi(): Promise<YouTubeApi> {
  api ??= new Promise<YouTubeApi>((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      api = null;
      reject(new Error('YouTube’s player could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return api;
}

/** How long a player that YouTube says was blocked may take to start with sound on its own. */
const AUTOPLAY_GRACE_MS = 3000;

export function YouTubePlayer(props: {
  id: string;
  /** The live state's clock; null from an older sender, which plays from `startSeconds`. */
  clock: OutputClock | null;
  startSeconds?: number;
  /** False keeps it muted, as on a preview. */
  sound: boolean;
  soundLabel: string;
  onReport?: (report: YouTubeReport) => void;
}) {
  const { id, clock, sound } = props;
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubeApiPlayer | null>(null);
  const [ready, setReady] = useState(false);
  // A browser that will not start sound before the page is clicked plays it muted until then.
  const [blocked, setBlocked] = useState(false);
  const report = useRef(props.onReport);
  report.current = props.onReport;
  const live = useRef(false);
  const start = useRef(props.startSeconds ?? 0);
  // Whether the clock last said to play, for the autoplay check above.
  const clockPlaying = useRef(true);
  clockPlaying.current = clock?.playing ?? true;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let gone = false;
    let blockedTimer: number | undefined;
    const holder = document.createElement('div');
    element.appendChild(holder);
    setReady(false);
    live.current = false;
    // Each length is told once: the player gives it again on every change of state.
    let told = 0;
    const tell = () => {
      const p = player.current;
      if (!p) return;
      if (p.getVideoData?.().isLive) {
        if (!live.current) report.current?.({ kind: 'live', id });
        live.current = true;
        return;
      }
      const seconds = p.getDuration();
      if (seconds > 0 && Math.abs(seconds - told) > 0.5) {
        told = seconds;
        report.current?.({ kind: 'length', id, seconds });
      }
    };
    void loadApi()
      .then((YT) => {
        if (gone) return;
        player.current = new YT.Player(holder, {
          host: 'https://www.youtube-nocookie.com',
          videoId: id,
          playerVars: {
            playsinline: 1,
            rel: 0,
            controls: 0,
            disablekb: 1,
            iv_load_policy: 3,
            fs: 0,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              if (gone) return;
              setReady(true);
              tell();
            },
            onStateChange: (event) => {
              if (gone) return;
              tell();
              if (event.data === YT_STATE.ended) report.current?.({ kind: 'ended', id });
            },
            onError: (event) => report.current?.({ kind: 'error', id, code: event.data }),
            // The app's own windows still start it with sound a moment later (spike M0.1);
            // a browser that really refuses gets it muted, with a button for sound. Muted,
            // it is started by following the clock, which may meanwhile have paused it.
            onAutoplayBlocked: () => {
              window.clearTimeout(blockedTimer);
              blockedTimer = window.setTimeout(() => {
                const p = player.current;
                if (gone || !p) return;
                const state = p.getPlayerState();
                if (state === YT_STATE.playing || state === YT_STATE.buffering) return;
                if (state === YT_STATE.paused && !clockPlaying.current) return;
                p.mute();
                setBlocked(true);
              }, AUTOPLAY_GRACE_MS);
            },
          },
        });
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      gone = true;
      window.clearTimeout(blockedTimer);
      player.current?.destroy();
      player.current = null;
      // The player put its frame where the holder was.
      element.replaceChildren();
    };
  }, [id]);

  useEffect(() => {
    const p = player.current;
    if (!ready || !p) return;
    if (!sound || blocked) p.mute();
    else p.unMute();
  }, [ready, sound, blocked]);

  useEffect(() => {
    if (!blocked) return;
    // The click lets the page play sound; the video carries on, now heard.
    const unmute = () => setBlocked(false);
    window.addEventListener('pointerdown', unmute, true);
    window.addEventListener('keydown', unmute, true);
    return () => {
      window.removeEventListener('pointerdown', unmute, true);
      window.removeEventListener('keydown', unmute, true);
    };
  }, [blocked]);

  // The clock last followed, to tell a command from the same clock sent again.
  const last = useRef<OutputClock | null>(null);
  const lastSeek = useRef(0);
  useEffect(() => {
    const p = player.current;
    if (!ready || !p) return;
    if (!clock) {
      // An older sender: play from the link's start, as before.
      if (start.current > 0) p.seekTo(start.current, true);
      p.playVideo();
      return;
    }
    let jumped = clockJumped(last.current, clock, Date.now());
    last.current = clock;
    const follow = () => {
      const now = Date.now();
      const step = youtubeStep({
        clock,
        nowMs: now,
        current: p.getCurrentTime(),
        state: p.getPlayerState(),
        live: live.current,
        jumped,
        lastSeekMs: lastSeek.current,
      });
      jumped = false;
      if (step.seekTo !== null) {
        p.seekTo(step.seekTo, true);
        lastSeek.current = now;
      }
      if (step.play) p.playVideo();
      if (step.pause) p.pauseVideo();
    };
    follow();
    const timer = window.setInterval(follow, 1000);
    return () => window.clearInterval(timer);
  }, [ready, clock]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000000' }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} className="wq-youtube" />
      <style>
        {'.wq-youtube iframe{position:absolute;inset:0;width:100%;height:100%;border:0}'}
      </style>
      {blocked && (
        <button
          type="button"
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            padding: '8px 14px',
            border: 0,
            borderRadius: 6,
            background: 'rgba(15, 23, 42, 0.8)',
            color: '#fff',
            font: '14px system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          🔇 {props.soundLabel}
        </button>
      )}
    </div>
  );
}

/** Whether the clock moved between two records: played, paused or moved elsewhere. */
export function clockJumped(before: OutputClock | null, after: OutputClock, nowMs: number) {
  if (!before || before.playing !== after.playing) return true;
  return Math.abs(videoTarget(before, nowMs) - videoTarget(after, nowMs)) > 0.25;
}
