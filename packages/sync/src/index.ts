/**
 * Synchronization between this device and its church instance.
 *
 * Content is pushed and pulled as records (see `SyncRecord`). The live state is not
 * content and is never synchronized here. The transport is supplied by the caller, so
 * the same logic runs against the real instance over HTTP and against an in-process one
 * in tests.
 */
import {
  negotiateProtocol,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  UPDATE_NEEDED,
  updateNeededBy,
  type EnrollResponse,
  type LibraryKind,
  type PairingPollResponse,
  type PairingStartResponse,
  type PullResponse,
  type PushResponse,
  type RestoreResponse,
  type ServerInfo,
  type SyncRecord,
} from '@worship-q/protocol';
import type { Session } from '@worship-q/session';
import type { AppliedChanges, SyncState, SyncStore } from '@worship-q/store';

export interface WorkspaceInfo {
  id: string;
  name: string;
  contentId: string | null;
  deviceName: string;
  /** Its songs and backgrounds are the Church Library's; absent from older instances. */
  manageLibrary?: boolean;
}

/** What the device asks of its church instance. */
export interface InstanceApi {
  /** What the instance is and speaks; needs no credentials. */
  info(): Promise<ServerInfo>;
  enroll(code: string, deviceName: string): Promise<EnrollResponse>;
  /** Pairing with an administrator's approval (phase 3, D29). */
  startPairing(deviceName: string): Promise<PairingStartResponse>;
  pollPairing(secret: string): Promise<PairingPollResponse>;
  workspace(): Promise<WorkspaceInfo>;
  claim(contentId: string): Promise<string>;
  push(records: SyncRecord[]): Promise<PushResponse>;
  pull(since: number): Promise<PullResponse>;
  /** Drops the workspace's own version of a church song or background (D32). */
  restore(kind: LibraryKind, key: string): Promise<RestoreResponse>;
}

/** Moving background files to and from the instance. */
export interface FileTransfer {
  upload(fileName: string): Promise<void>;
  download(fileName: string): Promise<void>;
  /** Of the given files, those this device does not have. */
  missing(fileNames: string[]): Promise<string[]>;
}

export class UpdateNeededError extends Error {
  /** Which side needs updating: this app, or the server when it is the older one. */
  readonly by: 'app' | 'server';

  constructor(serverProtocolVersion?: unknown) {
    super(UPDATE_NEEDED);
    this.by = updateNeededBy(serverProtocolVersion);
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
  }
}

export class InvalidCodeError extends Error {
  constructor() {
    super('invalid-code');
  }
}

/** The code names a workspace, but codes are off: an administrator must approve (D30). */
export class CodesOffError extends Error {
  constructor() {
    super('codes-off');
  }
}

/** Too many computers are waiting for approval at the instance; try again later (D29). */
export class TooManyPairingRequestsError extends Error {
  constructor() {
    super('too-many-requests');
  }
}

/** The instance has no live church version to go back to (D32). */
export class NoChurchVersionError extends Error {
  constructor() {
    super('no-church-version');
  }
}

/** The instance's address without a trailing slash, with https added when missing. */
export function normalizeServer(address: string): string {
  let value = address.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value;
}

/**
 * Asks an instance what it speaks and picks the version to use with it (D26): the
 * instance's own when it is older than this build's and still accepted, else this build's.
 * An instance that cannot be asked is spoken to at this build's version.
 */
export async function negotiate(
  server: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<{ protocol: number; info: ServerInfo | null }> {
  try {
    const response = await fetchImpl(`${server}/api/v1/info`);
    if (!response.ok) return { protocol: PROTOCOL_VERSION, info: null };
    const info = (await response.json()) as ServerInfo;
    return { protocol: negotiateProtocol(info.protocolVersion), info };
  } catch {
    return { protocol: PROTOCOL_VERSION, info: null };
  }
}

export function httpApi(
  server: string,
  token: () => string | null,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  /** The protocol version to speak, negotiated with the instance (D26). */
  protocol: () => number = () => PROTOCOL_VERSION,
): InstanceApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { [PROTOCOL_HEADER]: String(protocol()) };
    const bearer = token();
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetchImpl(`${server}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 426) {
      const body = (await response.json().catch(() => null)) as {
        protocolVersion?: unknown;
      } | null;
      throw new UpdateNeededError(body?.protocolVersion);
    }
    if (response.status === 401) throw new UnauthorizedError();
    if (response.status === 429) throw new TooManyPairingRequestsError();
    if (response.status === 403) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw body?.error === 'codes-off' ? new CodesOffError() : new InvalidCodeError();
    }
    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (body?.error === 'no-church-version') throw new NoChurchVersionError();
    }
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return (await response.json()) as T;
  }
  return {
    info: () => call('GET', '/api/v1/info'),
    enroll: (code, deviceName) =>
      call('POST', '/api/v1/enroll', { protocolVersion: protocol(), code, deviceName }),
    startPairing: (deviceName) =>
      call('POST', '/api/v1/pair', { protocolVersion: protocol(), deviceName }),
    pollPairing: (secret) => call('POST', '/api/v1/pair/poll', { secret }),
    workspace: () => call('GET', '/api/v1/workspace'),
    claim: async (contentId) =>
      (await call<{ contentId: string }>('POST', '/api/v1/claim', { contentId })).contentId,
    push: (records) => call('POST', '/api/v1/sync/push', { protocolVersion: protocol(), records }),
    pull: (since) => call('GET', `/api/v1/sync/pull?since=${since}`),
    restore: (kind, key) => call('POST', '/api/v1/sync/restore', { kind, key }),
  };
}

const PUSH_BATCH = 200;

export type SyncStatus =
  | { kind: 'disconnected' }
  | { kind: 'idle'; lastSyncAt: string | null }
  | { kind: 'syncing' }
  | { kind: 'error'; message: string; lastSyncAt: string | null }
  /** The server refused this protocol version; `by` says which side is behind. */
  | { kind: 'update-needed'; by: 'app' | 'server' }
  | { kind: 'revoked' };

/** How a device's existing content meets the church workspace when it joins. */
export type JoinMode =
  /** The church workspace is empty: this device's content becomes its content. */
  | 'upload'
  /** Keep this device's songs and run sheets, and add the church's. */
  | 'merge'
  /** Discard this device's songs and run sheets and take the church's. */
  | 'replace';

export class SyncClient {
  private running: Promise<void> | null = null;
  private again = false;
  private status_: SyncStatus = { kind: 'disconnected' };
  private readonly listeners = new Set<() => void>();
  /** Background files were checked against the instance since the app opened. */
  private filesChecked = false;

  constructor(
    private readonly session: Session,
    private readonly sync: SyncStore,
    private readonly api: InstanceApi,
    private readonly files: FileTransfer,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get status(): SyncStatus {
    return this.status_;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: SyncStatus): void {
    this.status_ = status;
    for (const listener of [...this.listeners]) listener();
  }

  /** Reads the saved connection, to show its state before the first synchronization. */
  async load(): Promise<SyncState> {
    const state = await this.sync.getState();
    this.session.store.managesChurchLibrary = state.manageLibrary === true;
    this.setStatus(
      state.joinedAt ? { kind: 'idle', lastSyncAt: state.lastSyncAt } : { kind: 'disconnected' },
    );
    return state;
  }

  /**
   * Pushes local changes and pulls the instance's. Calls made while one is running cause
   * one more run afterwards, so no change is missed.
   */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.once();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Runs only when something here changed since the last push, saving a round trip. */
  async runIfChanged(): Promise<void> {
    if (this.running) return;
    const state = await this.sync.getState();
    if (!state.deviceToken || !state.joinedAt) return;
    const records = await this.sync.localChanges(this.session.workspace.id, state.pushedThrough);
    if (records.length > 0) await this.run();
  }

  private async once(): Promise<void> {
    const state = await this.sync.getState();
    if (!state.deviceToken || !state.joinedAt) return this.setStatus({ kind: 'disconnected' });
    this.setStatus({ kind: 'syncing' });
    try {
      await this.push(state);
      await this.pull(state);
      const lastSyncAt = this.now();
      await this.sync.setState({ lastSyncAt, lastError: null });
      this.setStatus({ kind: 'idle', lastSyncAt });
    } catch (error) {
      if (error instanceof UpdateNeededError)
        return this.setStatus({ kind: 'update-needed', by: error.by });
      if (error instanceof UnauthorizedError) return this.setStatus({ kind: 'revoked' });
      const message = error instanceof Error ? error.message : String(error);
      await this.sync.setState({ lastError: message }).catch(() => undefined);
      this.setStatus({ kind: 'error', message, lastSyncAt: state.lastSyncAt });
    }
  }

  private async push(state: SyncState): Promise<void> {
    const workspaceId = this.session.workspace.id;
    // Changes made from here on are pushed next time.
    const through = this.now();
    const records = await this.sync.localChanges(workspaceId, state.pushedThrough);
    // Files first, so that no device learns of a background before it can fetch it.
    for (const record of records) {
      if (record.kind === 'background' && !record.data.removedAt) {
        const fileName = String(record.data.fileName);
        if ((await this.files.missing([fileName])).length === 0) await this.files.upload(fileName);
      }
    }
    for (let start = 0; start < records.length; start += PUSH_BATCH) {
      const { remap } = await this.api.push(records.slice(start, start + PUSH_BATCH));
      for (const [from, to] of Object.entries(remap)) {
        await this.session.external(() => this.sync.remapRunSheet(from, to));
      }
    }
    await this.sync.setState({ pushedThrough: through });
  }

  private async pull(state: SyncState): Promise<void> {
    let cursor = state.cursor;
    const records: SyncRecord[] = [];
    let page: PullResponse;
    // Everything is gathered first, so a run sheet is never applied before its songs.
    do {
      page = await this.api.pull(cursor);
      records.push(...page.records);
      cursor = page.cursor;
    } while (page.more);
    const workspaceId = this.session.workspace.id;
    // A version 3 instance says whether this workspace manages the Church Library (D31).
    if (typeof page.manageLibrary === 'boolean' && page.manageLibrary !== state.manageLibrary) {
      await this.sync.setState({ manageLibrary: page.manageLibrary });
    }
    if (typeof page.manageLibrary === 'boolean') {
      this.session.store.managesChurchLibrary = page.manageLibrary;
    }
    const changes: AppliedChanges = await this.session.applyRemote(async () => {
      await this.session.store.setChurchSettings(page.church);
      return this.sync.applyRemote(workspaceId, records);
    });
    let wanted = changes.backgroundFiles;
    if (!this.filesChecked) {
      // Fetch anything an earlier run did not manage to.
      const backgrounds = await this.session.store.listBackgrounds(workspaceId);
      wanted = [
        ...new Set([...wanted, ...backgrounds.map((b: { fileName: string }) => b.fileName)]),
      ];
      this.filesChecked = true;
    }
    for (const fileName of await this.files.missing(wanted)) {
      await this.files.download(fileName).catch((error) => console.warn(fileName, error));
    }
    await this.sync.setState({ cursor });
  }

  // ── Connecting ───────────────────────────────────────────────────────────

  /**
   * Enrolls this device with a connection code. Nothing in the local workspace changes
   * until `join` is called.
   */
  async enroll(server: string, code: string, deviceName: string): Promise<EnrollResponse> {
    const enrolled = await this.api.enroll(code, deviceName);
    await this.adopt(server, enrolled, deviceName);
    return enrolled;
  }

  /**
   * Asks the instance to pair this device (D29). The device then shows the code and polls
   * with `pollPairing` until an administrator decides. Nothing here changes until approval.
   */
  startPairing(deviceName: string): Promise<PairingStartResponse> {
    return this.api.startPairing(deviceName);
  }

  /** One poll of a pairing; on approval the device is enrolled as with a code. */
  async pollPairing(
    server: string,
    secret: string,
    deviceName: string,
  ): Promise<PairingPollResponse> {
    const result = await this.api.pollPairing(secret);
    if (result.status === 'approved') await this.adopt(server, result, deviceName);
    return result;
  }

  private async adopt(server: string, enrolled: EnrollResponse, deviceName: string): Promise<void> {
    await this.sync.setState({
      server,
      deviceId: enrolled.deviceId,
      deviceToken: enrolled.deviceToken,
      workspaceServerId: enrolled.workspace.id,
      deviceName,
      workspaceName: enrolled.workspace.name,
      joinedAt: null,
      cursor: 0,
      pushedThrough: null,
      lastSyncAt: null,
      lastError: null,
      manageLibrary: null,
    });
  }

  /**
   * Drops this workspace's own version of a church song (D32, “Delete our version”): the
   * instance forgets it and hands back the church's record, which is applied here as the
   * song. Other devices of the workspace receive it on their next pull.
   */
  async deleteOwnVersion(kind: LibraryKind, key: string): Promise<void> {
    const { record } = await this.api.restore(kind, key);
    const workspaceId = this.session.workspace.id;
    await this.session.applyRemote(() => this.sync.applyRemote(workspaceId, [record]));
  }

  /**
   * Makes the local workspace part of the church workspace, then synchronizes. The local
   * workspace takes the church workspace's identifier; the caller reopens the session
   * afterwards.
   */
  async join(mode: JoinMode): Promise<void> {
    const local = this.session.workspace;
    const info = await this.api.workspace();
    const contentId = info.contentId ?? (await this.api.claim(local.id));
    await this.session.external(async () => {
      if (contentId !== local.id) {
        if (mode === 'replace') await this.sync.clearContent(local.id);
        await this.sync.rehomeWorkspace(local.id, contentId);
      }
      // Replacing takes the church's workspace settings too; otherwise the name the church
      // gave the workspace is adopted.
      if (mode === 'replace') await this.sync.yieldWorkspace(contentId);
      else await this.session.store.setWorkspaceName(contentId, info.name);
    });
    await this.sync.setState({
      workspaceName: info.name,
      joinedAt: this.now(),
      cursor: 0,
      // After replacing, nothing here is newer than the church's copy.
      pushedThrough: mode === 'replace' ? this.now() : null,
    });
  }

  /** Stops synchronizing. The content stays on this device. */
  async disconnect(): Promise<void> {
    await this.sync.forget();
    this.setStatus({ kind: 'disconnected' });
  }
}
