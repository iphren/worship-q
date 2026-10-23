/**
 * Synchronization between this device and its church instance.
 *
 * Content is pushed and pulled as records (see `SyncRecord`). The live state is not
 * content and is never synchronized here. The transport is supplied by the caller, so
 * the same logic runs against the real instance over HTTP and against an in-process one
 * in tests.
 */
import {
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  UPDATE_NEEDED,
  type EnrollResponse,
  type PullResponse,
  type PushResponse,
  type SyncRecord,
} from '@worship-q/protocol';
import type { Session } from '@worship-q/session';
import type { AppliedChanges, SyncState, SyncStore } from '@worship-q/store';

export interface WorkspaceInfo {
  id: string;
  name: string;
  contentId: string | null;
  deviceName: string;
}

/** What the device asks of its church instance. */
export interface InstanceApi {
  enroll(code: string, deviceName: string): Promise<EnrollResponse>;
  workspace(): Promise<WorkspaceInfo>;
  claim(contentId: string): Promise<string>;
  push(records: SyncRecord[]): Promise<PushResponse>;
  pull(since: number): Promise<PullResponse>;
}

/** Moving background files to and from the instance. */
export interface FileTransfer {
  upload(fileName: string): Promise<void>;
  download(fileName: string): Promise<void>;
  /** Of the given files, those this device does not have. */
  missing(fileNames: string[]): Promise<string[]>;
}

export class UpdateNeededError extends Error {
  constructor() {
    super(UPDATE_NEEDED);
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

/** The instance's address without a trailing slash, with https added when missing. */
export function normalizeServer(address: string): string {
  let value = address.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value;
}

export function httpApi(
  server: string,
  token: () => string | null,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): InstanceApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) };
    const bearer = token();
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetchImpl(`${server}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 426) throw new UpdateNeededError();
    if (response.status === 401) throw new UnauthorizedError();
    if (response.status === 403) throw new InvalidCodeError();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return (await response.json()) as T;
  }
  return {
    enroll: (code, deviceName) =>
      call('POST', '/api/v1/enroll', { protocolVersion: PROTOCOL_VERSION, code, deviceName }),
    workspace: () => call('GET', '/api/v1/workspace'),
    claim: async (contentId) =>
      (await call<{ contentId: string }>('POST', '/api/v1/claim', { contentId })).contentId,
    push: (records) =>
      call('POST', '/api/v1/sync/push', { protocolVersion: PROTOCOL_VERSION, records }),
    pull: (since) => call('GET', `/api/v1/sync/pull?since=${since}`),
  };
}

const PUSH_BATCH = 200;

export type SyncStatus =
  | { kind: 'disconnected' }
  | { kind: 'idle'; lastSyncAt: string | null }
  | { kind: 'syncing' }
  | { kind: 'error'; message: string; lastSyncAt: string | null }
  | { kind: 'update-needed' }
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
      if (error instanceof UpdateNeededError) return this.setStatus({ kind: 'update-needed' });
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
    await this.sync.setState({
      server,
      deviceId: enrolled.deviceId,
      deviceToken: enrolled.deviceToken,
      workspaceServerId: enrolled.workspace.id,
      workspaceName: enrolled.workspace.name,
      joinedAt: null,
      cursor: 0,
      pushedThrough: null,
      lastSyncAt: null,
      lastError: null,
    });
    return enrolled;
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
