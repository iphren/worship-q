/**
 * The subtitle overlay page, for OBS Browser Source and similar software on this computer.
 * It is served by the app on localhost and draws whatever subtitle frame it is sent. It
 * runs in an ordinary browser, so nothing here may use the Tauri interface.
 */
import { EMPTY_FRAME, type OutputFrame } from '@worship-q/protocol';
import { Slide } from '@worship-q/renderer';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const RETRY_MS = 1000;

function socketUrl(): string {
  // In development the page comes from Vite and is told where the app's server is.
  const port = new URLSearchParams(location.search).get('port');
  return port ? `ws://127.0.0.1:${port}/ws` : `ws://${location.host}/ws`;
}

function OverlayApp() {
  const [frame, setFrame] = useState<OutputFrame>({ ...EMPTY_FRAME, layout: 'subtitle' });
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
        setFrame((current) => ({ ...current, song: null, pieceId: null }));
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

  return <Slide frame={frame} width={size.width} height={size.height} transition />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
);
