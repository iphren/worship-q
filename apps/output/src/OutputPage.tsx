/**
 * A browser output page (decision D22): the slideshow or the subtitle overlay, following the
 * workspace's live state through the church server's relay. The output token is in the
 * link; the page keeps nothing in browser storage, sets no cookies and asks for no sign-in,
 * so a fresh browser or an OBS Browser Source shows the output the first time it opens.
 */
import {
  EMPTY_FRAME,
  PROTOCOL_VERSION,
  type LiveSnapshot,
  type OutputFrame,
  type OutputKind,
  type OutputToRelay,
  type OutputView,
  type RelayToOutput,
} from '@worship-q/protocol';
import { Slide } from '@worship-q/renderer';
import { useEffect, useMemo, useState } from 'react';
import { buildFrame, missingFonts } from './frame';

const RETRY_MS = [1000, 2000, 5000, 10000];
const PING_MS = 15_000;

type PageState =
  | { kind: 'connecting' }
  | { kind: 'rejected'; reason: 'unauthorized' | 'revoked' | 'update-needed' | 'no-token' }
  | { kind: 'ready' };

function pageKind(pathname: string): OutputKind {
  return pathname.endsWith('/subtitle') ? 'subtitle' : 'slideshow';
}

function fontAvailable(family: string | null): boolean {
  if (!family) return true;
  try {
    return document.fonts.check(`16px "${family.replace(/"/g, '\\"')}"`);
  } catch {
    return false;
  }
}

export function OutputPage() {
  const kind = useMemo(() => pageKind(location.pathname), []);
  const token = useMemo(() => new URLSearchParams(location.search).get('t') ?? '', []);
  const [state, setState] = useState<PageState>(
    token ? { kind: 'connecting' } : { kind: 'rejected', reason: 'no-token' },
  );
  const [look, setLook] = useState<OutputView['look']>(null);
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let attempt = 0;
    let stopped = false;
    let currentLook: OutputView['look'] = null;

    const connect = async () => {
      // The look is fetched first, so the hello can say which font the page lacks (M7.4).
      try {
        const response = await fetch(`/api/v1/output/look?t=${encodeURIComponent(token)}`);
        if (response.status === 401) return setState({ kind: 'rejected', reason: 'unauthorized' });
        if (response.ok) {
          const body = (await response.json()) as { look: OutputView['look'] };
          currentLook = body.look;
          setLook(body.look);
        }
      } catch {
        // The relay tells the look too; the hello goes without a font report.
      }
      if (stopped) return;
      const url = `${location.origin.replace(/^http/, 'ws')}/api/v1/output`;
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        const hello: OutputToRelay = {
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          token,
          capabilities: {
            roles: [kind === 'subtitle' ? 'overlay' : 'display'],
            appVersion: 'browser',
            transparency: kind === 'subtitle',
            media: true,
            missingFonts: missingFonts(currentLook, (family) => fontAvailable(family)),
          },
        };
        ws.send(JSON.stringify(hello));
      };
      let answered = true;
      const heartbeat = window.setInterval(() => {
        if (!answered) return lost();
        answered = false;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, PING_MS);
      ws.onmessage = (event) => {
        if (socket !== ws) return;
        answered = true;
        const message = JSON.parse(String(event.data)) as RelayToOutput;
        switch (message.type) {
          case 'ready':
            attempt = 0;
            currentLook = message.look;
            setLook(message.look);
            setState({ kind: 'ready' });
            return;
          case 'snapshot':
            setSnapshot(message.snapshot);
            return;
          case 'waiting':
            // The last snapshot stays on screen until a coordinator is back (M3.4 for pages).
            return;
          case 'rejected':
            setState({ kind: 'rejected', reason: message.reason });
            stopped = true;
            return;
          case 'update-needed':
            setState({ kind: 'rejected', reason: 'update-needed' });
            stopped = true;
            return;
          case 'pong':
            return;
        }
      };
      const lost = () => {
        window.clearInterval(heartbeat);
        if (socket !== ws) return;
        socket = null;
        ws.close();
        if (stopped) return;
        setState({ kind: 'connecting' });
        const delay = RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]!;
        timer = window.setTimeout(() => void connect(), delay);
      };
      ws.onclose = lost;
    };
    void connect();
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
      window.removeEventListener('resize', onResize);
    };
  }, [token, kind]);

  const frame: OutputFrame = useMemo(
    () =>
      buildFrame({
        kind,
        snapshot,
        look,
        fontAvailable: fontAvailable(look?.fontFamily ?? null),
        fileUrl: (fileName) =>
          `/api/v1/output/files/${encodeURIComponent(fileName)}?t=${encodeURIComponent(token)}`,
      }),
    [kind, snapshot, look, token],
  );

  if (state.kind === 'rejected') {
    // A subtitle overlay stays transparent; the slideshow says what is wrong, in small type.
    if (kind === 'subtitle') return null;
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#000',
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 18,
          textAlign: 'center',
          padding: 32,
        }}
      >
        {state.reason === 'no-token'
          ? 'This link has no key. Make a new output link in Worship Q under Settings → Browser outputs.'
          : state.reason === 'update-needed'
            ? 'The church server runs a different version of Worship Q. Reload this page.'
            : 'This output link was revoked. Make a new one in Worship Q under Settings → Browser outputs.'}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: kind === 'subtitle' ? 'transparent' : '#000',
      }}
    >
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
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 0,
            background: '#000',
          }}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      )}
    </div>
  );
}

export { EMPTY_FRAME };
