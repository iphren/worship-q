import { native } from '../platform/native';
import type { Candidate, Ways } from './appSocket';

/** How long a connection may take to open before it counts as unreachable. */
const OPEN_MS = 6000;

/** Handlers of the app's outgoing LAN connections, by the native core's identifier. */
const lanHandlers = new Map<
  string,
  { message(data: string): void; close(reason: string | null): void }
>();
let listening: Promise<unknown> | null = null;

/** One listener for the native core's LAN events, passing each to its connection. */
function listenToLan(): Promise<unknown> {
  listening ??= native.onLan({
    open: () => undefined,
    message: ({ id, data }) => lanHandlers.get(id)?.message(data),
    close: ({ id, reason }) => {
      lanHandlers.get(id)?.close(reason);
      lanHandlers.delete(id);
    },
  });
  return listening;
}

/** The church or public server's relay, through the web view's own WebSocket. */
function relay(url: string): Promise<Candidate> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timed out'));
    }, OPEN_MS);
    const candidate: Candidate = {
      via: 'relay',
      send: (data) => ws.readyState === WebSocket.OPEN && ws.send(data),
      close: () => ws.close(),
      onmessage: null,
      onclose: null,
    };
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(candidate);
    };
    ws.onmessage = (event) => candidate.onmessage?.(String(event.data));
    ws.onclose = (event) => {
      clearTimeout(timer);
      reject(new Error('closed before opening'));
      candidate.onclose?.(event.reason || undefined);
    };
  });
}

/**
 * A device on the venue network, pinned to its certificate's fingerprint by the native core,
 * with no device token and no hello yet: the phone says hello once it chose this connection.
 */
async function lan(address: string, port: number, fingerprint: string): Promise<Candidate> {
  await listenToLan();
  const id = await native.lanConnect(address, port, fingerprint, null, null);
  const candidate: Candidate = {
    via: 'lan',
    send: (data) => void native.lanSend(id, data).catch(() => undefined),
    close: () => {
      lanHandlers.delete(id);
      void native.lanDisconnect(id).catch(() => undefined);
    },
    onmessage: null,
    onclose: null,
  };
  lanHandlers.set(id, {
    message: (data) => candidate.onmessage?.(data),
    close: (reason) => candidate.onclose?.(reason ?? undefined),
  });
  return candidate;
}

/** The ways the phone and tablet app reaches a workspace. */
export const appWays: Ways = {
  relay,
  lan,
  browse: (workspace, seconds) => native.lanBrowse(workspace, seconds),
};
