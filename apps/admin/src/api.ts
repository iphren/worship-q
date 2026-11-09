/**
 * The admin routes, one function each. Every request carries the `ADMIN_HEADER`, which a
 * cross-site form cannot add (decision D35), and the session cookie. A 401 means the
 * session ended; `onSignedOut` lets the app fall back to the sign-in page from anywhere.
 */
import {
  ADMIN_HEADER,
  type AdminAdministrator,
  type AdminDevice,
  type AdminLibraryContent,
  type AdminLibraryItem,
  type AdminLibraryPlan,
  type AdminLibraryUsage,
  type AdminLiveView,
  type AdminObsView,
  type AdminMe,
  type AdminPairingRequest,
  type AdminStorage,
  type AdminWorkspace,
  type AdminBible,
  type ChurchSettings,
  type LibraryKind,
  type LibraryType,
} from '@worship-q/protocol';
import { errorText } from './format';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(errorText(code, status));
    this.name = 'ApiError';
  }
}

/** Plain words for anything a request may throw. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return errorText('network');
  return errorText('unknown');
}

const signedOutListeners = new Set<() => void>();

export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { [ADMIN_HEADER]: '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    let code = `http-${response.status}`;
    try {
      const data: unknown = await response.json();
      if (typeof data === 'object' && data !== null && 'error' in data) {
        const { error } = data as { error: unknown };
        if (typeof error === 'string') code = error;
      }
    } catch {
      // Not JSON: the status code is all there is.
    }
    if (response.status === 401) for (const listener of signedOutListeners) listener();
    throw new ApiError(response.status, code);
  }
  return response.json() as Promise<T>;
}

const encode = encodeURIComponent;
const ADMIN = '/api/v1/admin';

export const api = {
  me: () => request<AdminMe>('GET', `${ADMIN}/me`),
  logout: () => request<void>('POST', '/auth/logout'),

  workspaces: () => request<{ workspaces: AdminWorkspace[] }>('GET', `${ADMIN}/workspaces`),
  createWorkspace: (name: string) =>
    request<{ workspace: AdminWorkspace; code: string }>('POST', `${ADMIN}/workspaces`, {
      name,
    }),
  updateWorkspace: (id: string, patch: { name?: string; codesEnabled?: boolean }) =>
    request<{ workspace: AdminWorkspace }>('PATCH', `${ADMIN}/workspaces/${encode(id)}`, patch),
  newCode: (id: string) =>
    request<{ code: string }>('POST', `${ADMIN}/workspaces/${encode(id)}/code`),
  /** What turning on management of these Church Library types would do (D36). */
  libraryPlan: (id: string, types: LibraryType[]) =>
    request<AdminLibraryPlan>(
      'GET',
      `${ADMIN}/workspaces/${encode(id)}/library-plan?types=${encode(types.join(','))}`,
    ),
  /** Sets which Church Library types the workspace manages. */
  setLibraryTypes: (id: string, types: LibraryType[]) =>
    request<{ workspace: AdminWorkspace; moved: number }>(
      'POST',
      `${ADMIN}/workspaces/${encode(id)}/library`,
      { types },
    ),
  live: (id: string) => request<AdminLiveView>('GET', `${ADMIN}/workspaces/${encode(id)}/live`),
  obs: (id: string) => request<AdminObsView>('GET', `${ADMIN}/workspaces/${encode(id)}/obs`),
  /** Where the browser loads a workspace's file from; the session cookie admits it. */
  workspaceFileUrl: (id: string, name: string) =>
    `${ADMIN}/workspaces/${encode(id)}/files/${encode(name)}`,

  devices: () =>
    request<{
      devices: AdminDevice[];
      pending: AdminPairingRequest[];
      churchLibraryEmpty: boolean;
    }>('GET', `${ADMIN}/devices`),
  renameDevice: (id: string, name: string) =>
    request<{ renamed: boolean }>('PATCH', `${ADMIN}/devices/${encode(id)}`, { name }),
  revokeDevice: (id: string) =>
    request<{ revoked: boolean }>('DELETE', `${ADMIN}/devices/${encode(id)}`),
  approvePairing: (code: string, workspaceId: string, name: string | null, allowMerge: boolean) =>
    request<{ device: { id: string; name: string; workspaceId: string } }>(
      'POST',
      `${ADMIN}/pairing/${encode(code)}/approve`,
      name ? { workspaceId, name, allowMerge } : { workspaceId, allowMerge },
    ),
  refusePairing: (code: string) =>
    request<{ refused: boolean }>('POST', `${ADMIN}/pairing/${encode(code)}/refuse`),

  administrators: () =>
    request<{ administrators: AdminAdministrator[] }>('GET', `${ADMIN}/administrators`),
  addAdministrator: (email: string) =>
    request<{ administrator: AdminAdministrator }>('POST', `${ADMIN}/administrators`, { email }),
  removeAdministrator: (id: string) =>
    request<{ removed: boolean }>('DELETE', `${ADMIN}/administrators/${encode(id)}`),

  settings: () => request<{ settings: ChurchSettings; keys: string[] }>('GET', `${ADMIN}/settings`),
  bible: () => request<AdminBible>('GET', `${ADMIN}/bible`),
  setSetting: (key: keyof ChurchSettings, value: number | boolean | string | string[] | null) =>
    request<{ settings: ChurchSettings }>('PUT', `${ADMIN}/settings`, { key, value }),

  library: (kind: LibraryKind, search = '') =>
    request<{ items: AdminLibraryItem[] }>(
      'GET',
      `${ADMIN}/library/${kind}${search.trim() ? `?q=${encode(search.trim())}` : ''}`,
    ),
  workspaceLibrary: (workspaceId: string, kind: LibraryKind, search = '') =>
    request<{ items: AdminLibraryItem[] }>(
      'GET',
      `${ADMIN}/workspaces/${encode(workspaceId)}/library/${kind}${search.trim() ? `?q=${encode(search.trim())}` : ''}`,
    ),
  workspaceLibraryContent: (workspaceId: string, kind: LibraryKind, id: string) =>
    request<AdminLibraryContent>(
      'GET',
      `${ADMIN}/workspaces/${encode(workspaceId)}/library/${kind}/${encode(id)}`,
    ),
  libraryContent: (kind: LibraryKind, id: string) =>
    request<AdminLibraryContent>('GET', `${ADMIN}/library/${kind}/${encode(id)}`),
  /** Where the browser loads a Church Library file from; the session cookie admits it. */
  fileUrl: (name: string) => `${ADMIN}/files/${encode(name)}`,
  libraryUsage: (kind: LibraryKind, id: string) =>
    request<AdminLibraryUsage>('GET', `${ADMIN}/library/${kind}/${encode(id)}/usage`),
  deleteLibraryItem: (kind: LibraryKind, id: string) =>
    request<{ deleted: boolean }>('DELETE', `${ADMIN}/library/${kind}/${encode(id)}`),
  restoreLibraryItem: (kind: LibraryKind, id: string) =>
    request<{ restored: boolean }>('POST', `${ADMIN}/library/${kind}/${encode(id)}/restore`),

  storage: () => request<AdminStorage>('GET', `${ADMIN}/storage`),
};
