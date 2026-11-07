/**
 * Pure helpers of the admin app: the page routes, text for sizes, times and errors, and
 * what a live snapshot says is on screen. Nothing here touches the DOM, so the root vitest
 * config (node environment) runs the tests.
 */
import {
  LIBRARY_TYPES,
  type AdminDevice,
  type ConnectedDevice,
  type LibraryType,
  type LiveSnapshot,
  type ObsConnection,
  type ObsOutput,
} from '@worship-q/protocol';

// ── Church Library types ───────────────────────────────────────────────────

/** What each Church Library type is called, as a plural noun in a sentence. */
export const LIBRARY_TYPE_NOUNS: Record<LibraryType, string> = {
  songs: 'songs',
  backgrounds: 'backgrounds',
  slides: 'slides',
  websites: 'websites',
};

/** What each Church Library type is called on its own, as on a badge. */
export const LIBRARY_TYPE_LABELS: Record<LibraryType, string> = {
  songs: 'Songs',
  backgrounds: 'Backgrounds',
  slides: 'Slides',
  websites: 'Websites',
};

/** Library types in a sentence, in their usual order: “songs, slides and websites”. */
export function libraryTypeList(types: readonly LibraryType[]): string {
  const nouns = LIBRARY_TYPES.filter((type) => types.includes(type)).map(
    (type) => LIBRARY_TYPE_NOUNS[type],
  );
  if (nouns.length <= 1) return nouns.join('');
  return `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}`;
}

/**
 * What a workspace manages, in a sentence: “the Church Library” for every type, else “the
 * Church Library's songs and backgrounds” and the like.
 */
export function managedLabel(types: readonly LibraryType[]): string {
  if (LIBRARY_TYPES.every((type) => types.includes(type))) return 'the Church Library';
  return `the Church Library's ${libraryTypeList(types)}`;
}

// ── Routes ─────────────────────────────────────────────────────────────────

/** The app's pages, as the browser's path names them under /admin/. */
export type Route =
  /** The sign-in page, with the error code the server redirected back with, if any. */
  | { page: 'home'; error: string | null }
  | { page: 'workspaces' }
  | { page: 'workspace'; id: string }
  /** `pairCode` comes from the QR code's deep link, /admin/pair?code=ABCD-2345 (D29). */
  | { page: 'devices'; pairCode: string | null }
  | { page: 'library' }
  | { page: 'administrators' }
  | { page: 'settings' }
  | { page: 'storage' }
  | { page: 'not-found' };

export const BASE = '/admin';

export function parseRoute(pathname: string, search = ''): Route {
  const params = new URLSearchParams(search);
  let path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  path = path.replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (first === undefined) return { page: 'home', error: params.get('error') };
  if (third !== undefined) return { page: 'not-found' };
  switch (first) {
    case 'workspaces':
      return second === undefined ? { page: 'workspaces' } : { page: 'workspace', id: second };
    case 'devices':
      return second === undefined ? { page: 'devices', pairCode: null } : { page: 'not-found' };
    case 'pair':
      return second === undefined
        ? { page: 'devices', pairCode: params.get('code') }
        : { page: 'not-found' };
    case 'library':
    case 'administrators':
    case 'settings':
    case 'storage':
      return second === undefined ? { page: first } : { page: 'not-found' };
    default:
      return { page: 'not-found' };
  }
}

/** The path for a route, the inverse of `parseRoute`. */
export function routePath(route: Route): string {
  switch (route.page) {
    case 'home':
      return route.error ? `${BASE}/?error=${encodeURIComponent(route.error)}` : `${BASE}/`;
    case 'workspace':
      return `${BASE}/workspaces/${encodeURIComponent(route.id)}`;
    case 'devices':
      return route.pairCode
        ? `${BASE}/pair?code=${encodeURIComponent(route.pairCode)}`
        : `${BASE}/devices`;
    case 'not-found':
      return `${BASE}/`;
    default:
      return `${BASE}/${route.page}`;
  }
}

/** Pairing codes are compared without spaces, dashes or case, as the server does. */
export function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

// ── Sizes ──────────────────────────────────────────────────────────────────

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A size in the units people read on disks: decimal, one decimal place under 10. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toLocaleString('en', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })} ${UNITS[unit]}`;
}

/** What is used, as a share of the whole, clamped to 0–100 for a bar. */
export function usedPercent(freeBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  const used = (totalBytes - freeBytes) / totalBytes;
  return Math.min(100, Math.max(0, Math.round(used * 100)));
}

// ── Times ──────────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function count(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** How long ago or until a moment, in words: "just now", "3 minutes ago", "in 2 hours". */
export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'unknown';
  const diff = now - at;
  const past = diff >= 0;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return past ? 'just now' : 'in under a minute';
  let text: string;
  if (abs < HOUR) text = count(Math.floor(abs / MINUTE), 'minute');
  else if (abs < DAY) text = count(Math.floor(abs / HOUR), 'hour');
  else if (abs < 30 * DAY) text = count(Math.floor(abs / DAY), 'day');
  else if (abs < 365 * DAY) text = count(Math.floor(abs / (30 * DAY)), 'month');
  else text = count(Math.floor(abs / (365 * DAY)), 'year');
  return past ? `${text} ago` : `in ${text}`;
}

/** "Expires in 12 minutes" or, once past, "Expired 3 minutes ago". */
export function expiryText(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Expiry unknown';
  return at <= now ? `Expired ${relativeTime(iso, now)}` : `Expires ${relativeTime(iso, now)}`;
}

export function isPast(iso: string, now = Date.now()): boolean {
  const at = Date.parse(iso);
  return !Number.isNaN(at) && at <= now;
}

/** The full date and time, for a title attribute next to the relative text. */
export function formatDateTime(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toLocaleString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ORDINAL_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });

/** A run sheet's date (YYYY-MM-DD) as its name, such as "Sunday 1st Nov". */
export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, y, m, d] = match;
  const day = Number(d);
  const when = new Date(Number(y), Number(m) - 1, day);
  const weekday = when.toLocaleDateString('en', { weekday: 'long' });
  const month = when.toLocaleDateString('en', { month: 'short' });
  return `${weekday} ${day}${ORDINAL_SUFFIX[ordinalRules.select(day)]} ${month}`;
}

// ── The live state (D38) ───────────────────────────────────────────────────

export interface OnScreen {
  /** The output is blanked; `title` and `lines` say what is behind the blank. */
  blank: boolean;
  /** The presented item's title; null when nothing is presented. */
  title: string | null;
  /** The presented piece's lines; empty when there is no piece or it was not found. */
  lines: string[];
  /** A piece is presented but is not among the item's pieces, so only the title is known. */
  pieceMissing: boolean;
}

/** What the snapshot says is on screen, as text. */
export function onScreen(snapshot: LiveSnapshot): OnScreen {
  const { presented } = snapshot;
  const blank = snapshot.state.blank;
  if (!presented) return { blank, title: null, lines: [], pieceMissing: false };
  const piece = presented.pieces.find((p) => p.id === presented.pieceId);
  return {
    blank,
    title: presented.title || 'Untitled',
    lines: piece ? piece.lines : [],
    pieceMissing: piece === undefined,
  };
}

export const ROLE_LABEL: Record<ConnectedDevice['role'], string> = {
  coordinator: 'Presenting computer',
  operator: 'Computer',
  viewer: 'Computer (viewing)',
  phone: 'Phone',
  output: 'Output screen',
};

export const CONNECTION_LABEL: Record<ConnectedDevice['connection'], string> = {
  lan: 'on the venue network',
  relay: 'through the church server',
};

// ── Devices ────────────────────────────────────────────────────────────────

/** Active devices first, by workspace then name; revoked ones last, newest revocation first. */
export function orderDevices(devices: readonly AdminDevice[]): AdminDevice[] {
  return [...devices].sort((a, b) => {
    if ((a.revokedAt === null) !== (b.revokedAt === null)) return a.revokedAt === null ? -1 : 1;
    if (a.revokedAt && b.revokedAt) return b.revokedAt.localeCompare(a.revokedAt);
    return (
      a.workspaceName.localeCompare(b.workspaceName) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
  });
}

export interface DeviceGroup {
  workspaceId: string;
  workspaceName: string;
  devices: AdminDevice[];
}

/** Devices grouped by workspace, groups by workspace name, each group in `orderDevices` order. */
export function groupDevicesByWorkspace(devices: readonly AdminDevice[]): DeviceGroup[] {
  const groups = new Map<string, DeviceGroup>();
  for (const device of orderDevices(devices)) {
    let group = groups.get(device.workspaceId);
    if (!group) {
      group = { workspaceId: device.workspaceId, workspaceName: device.workspaceName, devices: [] };
      groups.set(device.workspaceId, group);
    }
    group.devices.push(device);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.workspaceName.localeCompare(b.workspaceName) || a.workspaceId.localeCompare(b.workspaceId),
  );
}

// ── Errors ─────────────────────────────────────────────────────────────────

const ERROR_TEXT: Record<string, string> = {
  'not-administrator':
    'Your account signed in, but it is not an administrator of this instance. Ask an administrator to add your e-mail address.',
  'sign-in-failed': 'Sign-in did not complete. Try again.',
  'no-email':
    'Your account did not give a verified e-mail address, so it cannot be matched to an administrator.',
  'provider-unreachable': 'The sign-in provider could not be reached. Try again in a moment.',
  'sign-in-not-configured': 'Sign-in is not configured on this instance.',
  unauthorized: 'You are signed out. Sign in again.',
  'missing-header': 'The request was refused. Reload the page and try again.',
  'name-required': 'Enter a name.',
  'workspace-required': 'Choose a workspace.',
  'merge-choice-required': 'Choose whether this computer may keep its own songs and run sheets.',
  'invalid-email': 'That is not a valid e-mail address.',
  'last-administrator':
    'The last administrator cannot be removed. Add another administrator first.',
  'not-pending': 'This request is no longer pending. It may have expired or been handled already.',
  'files-removed': 'Files were removed, so this item cannot be restored.',
  'not-deleted': 'This item is not deleted.',
  'not-found': 'This no longer exists. It may have been removed meanwhile.',
  'unknown-setting': 'This setting is not known to the server.',
  'invalid-value': 'That value is not allowed.',
  'invalid-kind': 'That kind of item is not known.',
  network: 'The server could not be reached. Check the connection and try again.',
};

/** Plain words for an error code from the server, or a fallback that still names it. */
export function errorText(code: string, status?: number): string {
  const known = ERROR_TEXT[code];
  if (known) return known;
  if (status !== undefined && status >= 500) return `The server had a problem (${code}).`;
  return `Something went wrong (${code}).`;
}

// ── OBS ────────────────────────────────────────────────────────────────────

/** The OBS computer's connection to OBS, in words. */
export const OBS_STATUS_LABEL: Record<ObsConnection, string> = {
  connected: 'OBS connected',
  connecting: 'Connecting to OBS…',
  'not-running': 'OBS not running',
  refused: 'OBS refused the password',
};

/** A running time as `m:ss`, or `h:mm:ss` from an hour. */
export function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(total % 60)}` : `${m}:${two(total % 60)}`;
}

/** A short age: “5 s”, “2 min”, “1 h”. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

/** What a stream, recording or virtual camera is doing, as the phone says it. */
export function obsOutputText(output: ObsOutput, elapsedMs: number | null): string {
  if (output.phase === 'starting') return 'Starting…';
  if (output.phase === 'stopping') return 'Stopping…';
  if (output.phase === 'reconnecting') return 'Reconnecting…';
  if (!output.active) return 'Off';
  const time = elapsedMs !== null ? formatDuration(elapsedMs) : 'On';
  return output.paused ? `${time} · Paused` : time;
}
