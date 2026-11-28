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
import { formatDate as runSheetDate, intlLocale, t, type MessageKey } from '@worship-q/i18n/admin';

// ── Church Library types ───────────────────────────────────────────────────

/** What a Church Library type is called, as a plural noun in a sentence. */
export function libraryTypeNoun(type: LibraryType): string {
  return t(`libraryType.noun.${type}`);
}

/** What a Church Library type is called on its own, as on a badge. */
export function libraryTypeLabel(type: LibraryType): string {
  return t(`libraryType.label.${type}`);
}

/** Library types in a sentence, in their usual order: “songs, slides and websites”. */
export function libraryTypeList(types: readonly LibraryType[]): string {
  const nouns = LIBRARY_TYPES.filter((type) => types.includes(type)).map(libraryTypeNoun);
  if (nouns.length <= 1) return nouns.join('');
  return t('list.last', {
    rest: nouns.slice(0, -1).join(t('list.separator')),
    last: nouns[nouns.length - 1]!,
  });
}

/**
 * What a workspace manages, in a sentence: “the Church Library” for every type, else “the
 * Church Library's songs and backgrounds” and the like.
 */
export function managedLabel(types: readonly LibraryType[]): string {
  if (LIBRARY_TYPES.every((type) => types.includes(type))) return t('managed.all');
  return t('managed.some', { types: libraryTypeList(types) });
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
  /** Who may connect an AI assistant (MCP plan). */
  | { page: 'mcp-users' }
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
    case 'mcp-users':
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
  return `${value.toLocaleString(intlLocale(), {
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

/** How long ago or until a moment, in words: "just now", "3 minutes ago", "in 2 hours". */
export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return t('time.unknown');
  const diff = now - at;
  const past = diff >= 0;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return t(past ? 'time.justNow' : 'time.underAMinute');
  const [n, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < HOUR
      ? [Math.floor(abs / MINUTE), 'minute']
      : abs < DAY
        ? [Math.floor(abs / HOUR), 'hour']
        : abs < 30 * DAY
          ? [Math.floor(abs / DAY), 'day']
          : abs < 365 * DAY
            ? [Math.floor(abs / (30 * DAY)), 'month']
            : [Math.floor(abs / (365 * DAY)), 'year'];
  return new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'always' }).format(
    past ? -n : n,
    unit,
  );
}

/** "Expires in 12 minutes" or, once past, "Expired 3 minutes ago". */
export function expiryText(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return t('time.expiryUnknown');
  return t(at <= now ? 'time.expired' : 'time.expires', { time: relativeTime(iso, now) });
}

export function isPast(iso: string, now = Date.now()): boolean {
  const at = Date.parse(iso);
  return !Number.isNaN(at) && at <= now;
}

/** The full date and time, for a title attribute next to the relative text. */
export function formatDateTime(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toLocaleString(intlLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A run sheet's date (YYYY-MM-DD) as its name, such as "Sunday 1st Nov". */
export function formatDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? runSheetDate(date) : date;
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
    title: presented.title || t('common.untitled'),
    lines: piece ? piece.lines : [],
    pieceMissing: piece === undefined,
  };
}

export function roleLabel(role: ConnectedDevice['role']): string {
  return t(`role.${role}`);
}

export function connectionLabel(connection: ConnectedDevice['connection']): string {
  return t(`connection.${connection}`);
}

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

/** The server's error codes that have words of their own. */
const ERROR_CODES = new Set([
  'not-administrator',
  'sign-in-failed',
  'no-email',
  'provider-unreachable',
  'sign-in-not-configured',
  'unauthorized',
  'missing-header',
  'name-required',
  'workspace-required',
  'merge-choice-required',
  'invalid-email',
  'last-administrator',
  'already-added',
  'unknown-workspace',
  'not-pending',
  'files-removed',
  'not-deleted',
  'not-found',
  'unknown-setting',
  'invalid-value',
  'invalid-kind',
  'network',
]);

/** Plain words for an error code from the server, or a fallback that still names it. */
export function errorText(code: string, status?: number): string {
  if (ERROR_CODES.has(code)) return t(`error.${code}` as MessageKey);
  if (status !== undefined && status >= 500) return t('error.server', { code });
  return t('error.other', { code });
}

// ── OBS ────────────────────────────────────────────────────────────────────

/** The OBS computer's connection to OBS, in words. */
export function obsStatusLabel(status: ObsConnection): string {
  return t(`obs.status.${status}`);
}

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
  if (seconds < 60) return t('time.ageSeconds', { n: seconds });
  if (seconds < 3600) return t('time.ageMinutes', { n: Math.floor(seconds / 60) });
  return t('time.ageHours', { n: Math.floor(seconds / 3600) });
}

/** What a stream, recording or virtual camera is doing, as the phone says it. */
export function obsOutputText(output: ObsOutput, elapsedMs: number | null): string {
  if (output.phase === 'starting') return t('obs.starting');
  if (output.phase === 'stopping') return t('obs.stopping');
  if (output.phase === 'reconnecting') return t('obs.reconnecting');
  if (!output.active) return t('obs.off');
  const time = elapsedMs !== null ? formatDuration(elapsedMs) : t('obs.on');
  return output.paused ? t('obs.paused', { time }) : time;
}

// ── Service records (R11, R19) ─────────────────────────────────────────────

/** A date's day in the browser's own time, as the instants it starts and ends at. */
export function dayRange(date: string): { from: string; to: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return {
    from: new Date(y, m - 1, d).toISOString(),
    to: new Date(y, m - 1, d + 1).toISOString(),
  };
}

/** The time of day of an instant, to the second: “10:04:31”. */
export function formatTimeOfDay(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * How long something ran, from its start to its end, or to `now` while it goes on. Null for
 * an end that never came and is not now: an interrupted recording.
 */
export function runTime(startedAt: string, endedAt: string | null, now: number): number {
  return Math.max(0, (endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt));
}
