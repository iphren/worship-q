/**
 * The page the slideshow window shows a YouTube video on (YouTube control D6). YouTube plays
 * a video only inside a page with a web address, which the app's own pages lack, so the app
 * serves this one at `localhost` (`youtube_page`), where YouTube accepts it. It follows the
 * live state's clock in the slideshow frames, and tells the app the video's length, its end
 * and any error over the same connection (D7). Nothing here may use the Tauri interface.
 */
import { YOUTUBE_ID, youtubeVideo, type OutputClock, type OutputFrame } from '@worship-q/protocol';
import { applyPreference, t } from '@worship-q/i18n/desktop';
import { YouTubePlayer, type YouTubeReport } from '@worship-q/renderer';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const RETRY_MS = 1000;

applyPreference('auto');

const params = new URLSearchParams(location.search);
/** The video: from the address `/youtube/{id}`, or `v=` where the page comes from Vite. */
const id = [location.pathname.split('/').pop(), params.get('v')].find(
  (value): value is string => !!value && YOUTUBE_ID.test(value),
);

function socketUrl(): string {
  // In development the page comes from Vite and is told where the app's server is.
  const port = params.get('port');
  return port ? `ws://127.0.0.1:${port}/ws/slideshow` : `ws://${location.host}/ws/slideshow`;
}

/** The clock in a frame for this video; null when the frame carries none (an older app). */
function clockFor(frame: OutputFrame, videoId: string): OutputClock | null | undefined {
  const website = frame.website;
  if (!website || youtubeVideo(website.url)?.id !== videoId) return undefined;
  return website.video ?? null;
}

function VideoApp(props: { id: string }) {
  // Undefined until a frame for this video arrives, so it never plays on its own meanwhile.
  const [clock, setClock] = useState<OutputClock | null | undefined>(undefined);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const connect = () => {
      const ws = new WebSocket(socketUrl());
      socket.current = ws;
      ws.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as OutputFrame | null;
        if (!frame) return;
        const next = clockFor(frame, props.id);
        // Another moment of the presentation: the window is about to close this page.
        if (next !== undefined) setClock(next);
      };
      ws.onclose = () => {
        if (!stopped) timer = window.setTimeout(connect, RETRY_MS);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket.current?.close();
    };
  }, [props.id]);

  const onReport = useCallback((report: YouTubeReport) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ youtube: report }));
  }, []);

  if (clock === undefined) return null;
  return (
    <YouTubePlayer
      id={props.id}
      clock={clock}
      startSeconds={0}
      sound
      soundLabel={t('video.clickForSound')}
      onReport={onReport}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{id ? <VideoApp id={id} /> : null}</StrictMode>,
);
