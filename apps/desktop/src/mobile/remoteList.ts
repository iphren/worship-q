import type { RemoteDevice, RemoteView, ScannedInvitation } from '@worship-q/protocol';

/**
 * A workspace this phone controls (native apps plan, "The workspace list"; A4). Only what
 * identifies it and where to find it; the grant is in the keychain under `id`.
 */
export interface RemoteEntry {
  /** This device's own name for the entry, and the keychain account of its grant. */
  id: string;
  /** The server's address with its scheme (and path, N31); null for a local workspace offline. */
  serverUrl: string | null;
  /** The workspace's identifier on that server. */
  workspace: string | null;
  /** A local workspace's permanent identifier (N22). */
  local: string | null;
  /** The workspace's name as the coordinator last gave it. */
  name: string;
  /** The only devices this phone trusts on the venue network (N30). */
  devices: RemoteDevice[];
  /** Whether it was presenting when last seen. */
  presenting: boolean;
  /** An invitation not yet used: the first connection asks with it. */
  invite: string | null;
  /** The grant was revoked: a scan asks for approval again (N13). */
  ended: boolean;
  lastOpenedAt: string | null;
}

export interface RemoteList {
  version: 1;
  /** The name the phone gives, asked once for every workspace (A5). */
  phoneName: string;
  entries: RemoteEntry[];
}

export const EMPTY_LIST: RemoteList = { version: 1, phoneName: '', entries: [] };

/** Reads the stored list, starting afresh from anything unreadable. */
export function parseList(json: string | null): RemoteList {
  if (!json) return EMPTY_LIST;
  try {
    const value = JSON.parse(json) as Partial<RemoteList>;
    if (value.version !== 1 || !Array.isArray(value.entries)) return EMPTY_LIST;
    return { version: 1, phoneName: value.phoneName ?? '', entries: value.entries };
  } catch {
    return EMPTY_LIST;
  }
}

/**
 * The entry an invitation is for (N13, A6): the same server address and workspace, or the
 * same permanent identifier. Never by name.
 */
export function findEntry(list: RemoteList, scanned: ScannedInvitation): RemoteEntry | null {
  return (
    list.entries.find(
      (entry) =>
        (scanned.local !== undefined && entry.local === scanned.local) ||
        (scanned.serverUrl !== undefined &&
          scanned.workspace !== undefined &&
          entry.serverUrl === scanned.serverUrl &&
          entry.workspace === scanned.workspace),
    ) ?? null
  );
}

/** The devices an invitation's venue network hints name: one, without its name or id. */
function invitationDevices(scanned: ScannedInvitation): RemoteDevice[] {
  return scanned.lan ? [{ deviceId: '', name: '', ...scanned.lan }] : [];
}

/**
 * Opens an invitation (N13): an entry already on the list opens with no request unless its
 * access ended, when it asks again with this invitation; otherwise a new entry is added.
 * Returns the list and the entry to open.
 */
export function openInvitation(
  list: RemoteList,
  scanned: ScannedInvitation,
  newId: () => string,
): { list: RemoteList; entry: RemoteEntry; added: boolean } {
  const known = findEntry(list, scanned);
  if (known) {
    const entry: RemoteEntry = {
      ...known,
      // A new server identifier for the same local workspace updates the entry (N22).
      serverUrl: scanned.serverUrl ?? known.serverUrl,
      workspace: scanned.workspace ?? known.workspace,
      invite: known.ended ? scanned.invite : known.invite,
      ended: false,
      devices: known.devices.length > 0 ? known.devices : invitationDevices(scanned),
    };
    return { list: replace(list, entry), entry, added: false };
  }
  const entry: RemoteEntry = {
    id: newId(),
    serverUrl: scanned.serverUrl ?? null,
    workspace: scanned.workspace ?? null,
    local: scanned.local ?? null,
    name: scanned.server ?? '',
    devices: invitationDevices(scanned),
    presenting: false,
    invite: scanned.invite,
    ended: false,
    lastOpenedAt: null,
  };
  return { list: { ...list, entries: [...list.entries, entry] }, entry, added: true };
}

/** What a view tells the entry: its name, whether it presents, and whom to trust (N30). */
export function fromView(entry: RemoteEntry, view: RemoteView): RemoteEntry {
  return {
    ...entry,
    name: view.workspaceName || entry.name,
    presenting: view.status === 'live',
    ...(view.devices && view.devices.length > 0 ? { devices: view.devices } : {}),
  };
}

export function replace(list: RemoteList, entry: RemoteEntry): RemoteList {
  return {
    ...list,
    entries: list.entries.map((candidate) => (candidate.id === entry.id ? entry : candidate)),
  };
}

export function remove(list: RemoteList, id: string): RemoteList {
  return { ...list, entries: list.entries.filter((entry) => entry.id !== id) };
}

/** The entry opened most recently, which the app reopens. */
export function lastOpened(list: RemoteList): RemoteEntry | null {
  let best: RemoteEntry | null = null;
  for (const entry of list.entries) {
    if (entry.lastOpenedAt && (!best || entry.lastOpenedAt > (best.lastOpenedAt ?? ''))) {
      best = entry;
    }
  }
  return best;
}

/** The relay a phone uses for the entry; null for a local workspace with no internet. */
export function relayUrl(entry: RemoteEntry): string | null {
  return entry.serverUrl ? `${entry.serverUrl.replace(/^http/, 'ws')}/api/v1/remote` : null;
}

/** A file the entry's server keeps, such as a slide thumbnail. */
export function fileUrl(entry: RemoteEntry, name: string): string {
  return `${entry.serverUrl ?? ''}/api/v1/remote/files/${encodeURIComponent(entry.workspace ?? '')}/${encodeURIComponent(name)}`;
}

/** The keychain account of the entry's grant. */
export const grantAccount = (entry: RemoteEntry) => `remote-grant-${entry.id}`;
