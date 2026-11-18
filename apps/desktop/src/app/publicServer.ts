/**
 * The Worship Q public server (public server plan): where a workspace without a church server
 * gets remote control, Bible passages, slide decks and live audio. It keeps nothing.
 */
import type { ServerInfo } from '@worship-q/protocol';

/**
 * The public server's address (S1). `VITE_WORSHIP_Q_PUBLIC_SERVER` replaces it in development
 * and tests, for a public server run locally.
 */
export const PUBLIC_SERVER_URL: string =
  (import.meta.env?.VITE_WORSHIP_Q_PUBLIC_SERVER as string | undefined) ||
  'https://public.worship-q.com';

const INSTALL_KEY = 'worship-q.install';

/**
 * This copy of the app's identifier (S2), made on first use and shared by its workspaces.
 * Sent to the public server only, for its limits. Without storage a fresh one is made each
 * run, which only makes the limits count by address.
 */
export function installId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  newId: () => string = () => crypto.randomUUID(),
): string {
  try {
    const kept = storage?.getItem(INSTALL_KEY);
    if (kept && /^[A-Za-z0-9-]{8,64}$/.test(kept)) return kept;
    const made = newId();
    storage?.setItem(INSTALL_KEY, made);
    return made;
  } catch {
    return newId();
  }
}

/** Whether a server's info says it is the public server, which cannot be joined (S5). */
export function isPublicServer(info: ServerInfo | null): boolean {
  return info?.public === true;
}

/**
 * Who answers this workspace's server features: its church server, the public server, or
 * nobody yet (public server discovery §4.2). `connected` keeps meaning joined to a church.
 */
export type Service =
  | { kind: 'church'; server: string; token: string }
  | { kind: 'public'; server: string; token: string };

/** The service for a workspace's connection state. */
export function serviceOf(state: {
  server: string | null;
  deviceToken: string | null;
  joinedAt: string | null;
  publicServer: boolean;
}): Service | null {
  const { server, deviceToken } = state;
  if (!server || !deviceToken) return null;
  if (state.joinedAt) return { kind: 'church', server, token: deviceToken };
  if (state.publicServer) return { kind: 'public', server, token: deviceToken };
  return null;
}

/** Thrown when a feature needs the public server and it cannot be reached or joined. */
export class PublicServerError extends Error {
  constructor(
    readonly reason: 'unreachable' | 'not-public' | 'viewer' | 'refused' | 'update-needed',
  ) {
    super(`public-server: ${reason}`);
  }
}
