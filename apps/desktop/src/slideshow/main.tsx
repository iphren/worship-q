/**
 * The localhost slideshow page, for OBS Browser Source and browsers on this computer (plan
 * M7.7; spec §10 localhost exception). It is served by the app and draws whatever slideshow
 * frame it is sent, so a streaming computer running the app shows the full slideshow
 * without internet. It runs in an ordinary browser, so nothing here may use the Tauri
 * interface.
 */
import { EMPTY_FRAME, type OutputFrame } from '@worship-q/protocol';
import { Slide } from '@worship-q/renderer';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const RETRY_MS = 1000;

function socketUrl(): string {
  // In development the page comes from Vite and is told where the app's server is.
  const port = new URLSearchParams(location.search).get('port');
  return port ? `ws://127.0.0.1:${port}/ws/slideshow` : `ws://${location.host}/ws/slideshow`;
}

function SlideshowApp() {
  const [frame, setFrame] = useState<OutputFrame>(EMPTY_FRAME);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let stopped = false;
    const connect = () => {
      socket = new WebSocket(socketUrl());
      socket.onmessage = (event) => {
        const next = JSON.parse(String(event.data)) as OutputFrame | null;
        if (next) setFrame(next);
      };
      // When the app closes, the lyrics disappear and the page waits for it to return.
      socket.onclose = () => {
        if (stopped) return;
        setFrame((current) => ({ ...current, song: null, pieceId: null, picture: null }));
        timer = window.setTimeout(connect, RETRY_MS);
      };
    };
    connect();
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <Slide
        frame={frame.website ? { ...frame, website: null } : frame}
        width={size.width}
        height={size.height}
        transition
      />
      {frame.website && (
        <iframe
          title="Website"
          src={frame.website.url}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      )}
      {frame.message && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.55)',
            fontSize: Math.round(size.height / 24),
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {frame.message}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SlideshowApp />
  </StrictMode>,
);
