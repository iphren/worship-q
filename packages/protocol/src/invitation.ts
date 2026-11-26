/**
 * Invitation links through the link router (native apps plan, "The link router", N29, N31).
 *
 * `https://app.worship-q.com/j#s=…&w=…&l=…&i=…&f=…&a=…&p=…`: everything is in the fragment,
 * which browsers never send, so the router never receives church data. With the app installed
 * the link opens it; without, the router page offers the church's phone page.
 *
 * Pure and dependency-free: the router page bundles it on its own.
 */

export const ROUTER_ORIGIN = 'https://app.worship-q.com';
export const ROUTER_PATH = '/j';

/** What an invitation carries. Which fields are present depends on the workspace (N29). */
export interface Invitation {
  /** The church or public server: a host name with an optional port, reached over HTTPS. */
  server?: string;
  /** The workspace's identifier on that server. */
  workspace?: string;
  /** A local workspace's permanent identifier (N22). */
  local?: string;
  /** The invitation the coordinator checks. */
  invite: string;
  /** The coordinator on the venue network, when known. */
  lan?: { fingerprint: string; addresses: string[]; port: number };
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validPort(value: string): boolean {
  return /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

/** `host[:port]` as the router carries it, or null when it is not a host name with a port. */
function cleanHost(value: string): string | null {
  const match = /^([^:]+)(?::(\d+))?$/.exec(value.trim().toLowerCase());
  const host = match?.[1];
  const port = match?.[2];
  if (!host) return null;
  if (host.length > 253 || /^[\d.]+$/.test(host)) return null;
  // A name with at least one dot: `localhost` and names only a church's own network knows
  // keep a direct link, as the router could not help a phone reach them.
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (port !== undefined && !validPort(port)) return null;
  return port === undefined || port === '443' ? host : `${host}:${port}`;
}

/**
 * The server as the router carries it: `host[:port]` for an `https://` address with no path,
 * or null for addresses that keep a direct link: `http://`, an IP address, or a path (N31).
 */
export function routerServer(serverUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;
  return cleanHost(url.host);
}

/** Percent-encodes a fragment value, keeping `:` and `,` for a shorter QR code. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%2C/gi, ',');
}

function lanHints(lan: Invitation['lan']): string {
  if (!lan || !lan.fingerprint || lan.addresses.length === 0 || !(lan.port > 0)) return '';
  return `&f=${encode(lan.fingerprint)}&a=${encode(lan.addresses.join(','))}&p=${lan.port}`;
}

/** The router link for an invitation. `server`, if given, must come from `routerServer`. */
export function invitationLink(invitation: Invitation): string {
  const fields: string[] = [];
  if (invitation.server) fields.push(`s=${encode(invitation.server)}`);
  if (invitation.workspace) fields.push(`w=${encode(invitation.workspace)}`);
  if (invitation.local) fields.push(`l=${encode(invitation.local)}`);
  fields.push(`i=${encode(invitation.invite)}`);
  return `${ROUTER_ORIGIN}${ROUTER_PATH}#${fields.join('&')}${lanHints(invitation.lan)}`;
}

/**
 * Reads an invitation from a router link's fragment (with or without the `#`). Null when it
 * has no invitation, names a server the router does not carry, or names no workspace at all.
 */
export function readInvitation(fragment: string): Invitation | null {
  const fields = new URLSearchParams(fragment.replace(/^#/, ''));
  const value = (key: string) => fields.get(key)?.trim() || undefined;
  const invite = value('i');
  if (!invite) return null;
  const rawServer = value('s');
  const server = rawServer === undefined ? undefined : cleanHost(rawServer);
  if (server === null) return null;
  const workspace = value('w');
  const local = value('l');
  if (server ? !workspace : !local) return null;
  const invitation: Invitation = { invite };
  if (server) invitation.server = server;
  if (workspace) invitation.workspace = workspace;
  if (local) invitation.local = local;
  const fingerprint = value('f');
  const addresses = (value('a') ?? '').split(',').filter(Boolean);
  const port = Number(value('p') ?? 0);
  if (fingerprint && addresses.length > 0 && Number.isInteger(port) && port > 0 && port < 65536) {
    invitation.lan = { fingerprint, addresses, port };
  }
  return invitation;
}

/** The church server's phone page for an invitation, as a direct QR code opens it today. */
export function phonePageLink(invitation: Invitation): string | null {
  const { server, workspace, invite, lan } = invitation;
  if (!server || !workspace) return null;
  return `https://${server}/remote/?w=${encodeURIComponent(workspace)}#i=${encode(invite)}${lanHints(lan)}`;
}

/** What the router page shows for the fragment it was opened with. */
export type RouterView =
  { kind: 'continue'; server: string; href: string } | { kind: 'app-only' } | { kind: 'invalid' };

export function routerView(fragment: string): RouterView {
  const invitation = readInvitation(fragment);
  if (!invitation) return { kind: 'invalid' };
  const href = phonePageLink(invitation);
  if (invitation.server && href) return { kind: 'continue', server: invitation.server, href };
  return { kind: 'app-only' };
}
