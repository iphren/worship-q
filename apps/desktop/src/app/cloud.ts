/**
 * The connection to a church instance: content synchronization, off-site backups, and the
 * relay through which phones control this device's presentation.
 *
 * Everything here is optional. Without a connection the app works exactly as before, and
 * losing the connection never interrupts a presentation.
 */
import { getVersion } from '@tauri-apps/api/app';
import {
  DeckSchema,
  deckLyrics,
  PROTOCOL_VERSION,
  type CoordinatorToRelay,
  type RelayToCoordinator,
  type Song,
} from '@worship-q/protocol';
import { RemoteHost } from '@worship-q/remote';
import type { Session } from '@worship-q/session';
import { SyncStore, type SyncState } from '@worship-q/store';
import {
  httpApi,
  normalizeServer,
  SyncClient,
  type FileTransfer,
  type JoinMode,
  type SyncStatus,
} from '@worship-q/sync';
import { native } from '../platform/native';
import type { OutputController } from './output';

const SYNC_EVERY_MS = 60_000;
/** Local edits are sent this long after the last one. */
const SYNC_AFTER_EDIT_MS = 2_000;
const BACKUP_EVERY_MS = 12 * 60 * 60 * 1000;
const RELAY_RETRY_MS = [1000, 3000, 10000, 30000];
/** The relay is pinged this often; a ping left unanswered means the connection is gone. */
const RELAY_PING_MS = 15_000;

export type RelayStatus =
  | { kind: 'off' }
  | { kind: 'connecting' }
  /** This device receives the remote controllers. */
  | { kind: 'coordinator' }
  /** Another computer of the workspace receives them. */
  | { kind: 'standby'; coordinatorName: string | null }
  | { kind: 'update-needed' }
  | { kind: 'unauthorized' };

export interface CloudStatus {
  sync: SyncStatus;
  relay: RelayStatus;
  state: SyncState | null;
  backup: { kind: 'idle' } | { kind: 'running' } | { kind: 'failed'; message: string };
}

export class CloudController {
  readonly host: RemoteHost;
  private readonly syncStore: SyncStore;
  private client: SyncClient;
  private state: SyncState | null = null;
  private status_: CloudStatus;
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private relayAttempt = 0;
  private relayTimer: number | undefined;
  private editTimer: number | undefined;
  private timers: number[] = [];
  private stopped = false;
  private syncing = false;
  private decks: { server: string; available: Promise<boolean> } | null = null;

  constructor(
    private readonly session: Session,
    private readonly output: OutputController,
  ) {
    this.syncStore = new SyncStore(session.store);
    this.host = new RemoteHost(session, () => this.state?.workspaceName ?? '');
    this.client = this.makeClient();
    this.status_ = {
      sync: { kind: 'disconnected' },
      relay: { kind: 'off' },
      state: null,
      backup: { kind: 'idle' },
    };
  }

  get status(): CloudStatus {
    return this.status_;
  }

  /** True once this computer joined a church workspace. */
  get connected(): boolean {
    return !!this.state?.deviceToken && !!this.state.joinedAt;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<CloudStatus>): void {
    this.status_ = { ...this.status_, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private makeClient(): SyncClient {
    const server = () => this.state?.server ?? '';
    const token = () => this.state?.deviceToken ?? '';
    const files: FileTransfer = {
      upload: (fileName) => native.uploadBackground(server(), token(), fileName),
      download: async (fileName) => {
        await native.downloadBackground(server(), token(), fileName);
        this.output.forgetFiles();
      },
      missing: async (fileNames) => {
        const missing: string[] = [];
        for (const name of fileNames) if (!(await native.backgroundUrl(name))) missing.push(name);
        return missing;
      },
    };
    // The address can change when connecting, so it is looked up on every call.
    const api = httpApi(
      '',
      () => this.state?.deviceToken ?? null,
      (input, init) => fetch(`${server()}${String(input)}`, init),
    );
    const client = new SyncClient(this.session, this.syncStore, api, files);
    client.subscribe(() => this.update({ sync: client.status }));
    return client;
  }

  async start(): Promise<void> {
    this.state = await this.client.load();
    this.update({ state: this.state, sync: this.client.status });
    // Edits made here are sent shortly after; content applied from the instance is not.
    this.session.subscribe(() => {
      if (this.syncing || !this.connected) return;
      window.clearTimeout(this.editTimer);
      this.editTimer = window.setTimeout(() => void this.syncIfChanged(), SYNC_AFTER_EDIT_MS);
    });
    this.timers.push(window.setInterval(() => void this.sync(), SYNC_EVERY_MS));
    this.timers.push(window.setInterval(() => void this.backupIfDue(), 60 * 60 * 1000));
    if (!this.connected) return;
    this.connectRelay();
    await this.sync();
    await this.backupIfDue();
  }

  stop(): void {
    this.stopped = true;
    this.timers.forEach((t) => window.clearInterval(t));
    window.clearTimeout(this.editTimer);
    window.clearTimeout(this.relayTimer);
    this.socket?.close();
    this.host.dispose();
  }

  private async refreshState(): Promise<void> {
    this.state = await this.syncStore.getState();
    this.update({ state: this.state });
  }

  async sync(): Promise<void> {
    if (!this.connected) return;
    this.syncing = true;
    try {
      await this.client.run();
    } finally {
      this.syncing = false;
      await this.refreshState();
    }
  }

  private async syncIfChanged(): Promise<void> {
    this.syncing = true;
    try {
      await this.client.runIfChanged();
    } finally {
      this.syncing = false;
    }
  }

  // ── Connecting and leaving ───────────────────────────────────────────────

  /**
   * Enrolls this computer with the church instance. Returns what joining will do: whether
   * the church workspace is still empty, and whether this computer has content to keep.
   */
  async enroll(
    address: string,
    code: string,
    deviceName: string,
  ): Promise<{ workspaceName: string; churchEmpty: boolean; hasLocalContent: boolean }> {
    const server = normalizeServer(address);
    this.state = { ...(this.state ?? (await this.syncStore.getState())), server };
    const enrolled = await this.client.enroll(server, code, deviceName);
    await this.refreshState();
    return {
      workspaceName: enrolled.workspace.name,
      churchEmpty: enrolled.workspace.contentId === null,
      hasLocalContent: await this.syncStore.hasContent(this.session.workspace.id),
    };
  }

  /**
   * Joins the church workspace. A backup of this computer's workspace is saved first, in
   * the app's data folder. The app reopens afterwards, as after restoring a backup.
   */
  async join(mode: JoinMode): Promise<void> {
    await native.backupBeforeJoin();
    await this.client.join(mode);
    window.location.reload();
  }

  /** Stops synchronizing and remote control; the content stays on this computer. */
  async disconnect(): Promise<void> {
    await this.host.disconnectAll().catch(() => undefined);
    await this.client.disconnect();
    this.socket?.close();
    this.socket = null;
    window.location.reload();
  }

  // ── Backups ──────────────────────────────────────────────────────────────

  async backupNow(): Promise<void> {
    if (!this.state?.server || !this.state.deviceToken) return;
    this.update({ backup: { kind: 'running' } });
    try {
      await native.uploadBackup(this.state.server, this.state.deviceToken);
      await this.syncStore.setState({ lastBackupAt: new Date().toISOString() });
      await this.refreshState();
      this.update({ backup: { kind: 'idle' } });
    } catch (error) {
      this.update({ backup: { kind: 'failed', message: String(error) } });
    }
  }

  private async backupIfDue(): Promise<void> {
    if (!this.connected || this.status_.backup.kind === 'running') return;
    const last = this.state?.lastBackupAt ? Date.parse(this.state.lastBackupAt) : 0;
    if (Date.now() - last > BACKUP_EVERY_MS) await this.backupNow();
  }

  // ── Slide decks ──────────────────────────────────────────────────────────

  /** Whether the church instance can convert slide decks. */
  decksAvailable(): Promise<boolean> {
    const server = this.state?.server;
    if (!server || !this.connected) return Promise.resolve(false);
    if (this.decks?.server !== server) {
      const available = fetch(`${server}/api/v1/info`)
        .then((response) => response.json() as Promise<{ decks?: boolean }>)
        .then((info) => info.decks === true)
        .catch(() => {
          // Asked again next time, in case the instance was only out of reach.
          this.decks = null;
          return false;
        });
      this.decks = { server, available };
    }
    return this.decks.available;
  }

  /**
   * Has the church instance convert a slide deck into images, fetches them, and saves the
   * deck as a song. Other computers fetch the images when the song reaches them.
   */
  async importDeck(
    source: string,
    onProgress: (stage: 'converting' | 'fetching', done: number, total: number) => void,
  ): Promise<Song> {
    const { server, deviceToken } = this.state ?? {};
    if (!server || !deviceToken || !this.connected) throw new Error('not-connected');
    onProgress('converting', 0, 0);
    const deck = DeckSchema.parse(JSON.parse(await native.importDeck(server, deviceToken, source)));
    let done = 0;
    onProgress('fetching', done, deck.pages.length);
    for (const page of deck.pages) {
      await native.downloadBackground(server, deviceToken, page.image);
      onProgress('fetching', ++done, deck.pages.length);
    }
    this.output.forgetFiles();
    const title = deck.source.replace(/\.[^.]+$/, '');
    return this.session.createSong({ title, lyrics: deckLyrics(deck), deck });
  }

  // ── Remote control ───────────────────────────────────────────────────────

  /** The link a phone opens to ask for control, as shown in the QR code. */
  remoteLink(): string | null {
    const { server, workspaceServerId } = this.state ?? {};
    if (!server || !workspaceServerId) return null;
    return `${server}/remote/?w=${encodeURIComponent(workspaceServerId)}#i=${this.host.invite()}`;
  }

  /** Makes this computer the one phones control, in place of another. */
  takeOver(): void {
    this.relaySend({ type: 'claim' });
  }

  private relaySend(message: CoordinatorToRelay): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private connectRelay(): void {
    if (this.stopped || !this.state?.server || !this.state.deviceToken) return;
    const token = this.state.deviceToken;
    const url = `${this.state.server.replace(/^http/, 'ws')}/api/v1/coordinator`;
    this.update({ relay: { kind: 'connecting' } });
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      void getVersion().then((appVersion) =>
        this.relaySend({
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          token,
          capabilities: {
            roles: ['coordinator', 'display', 'overlay'],
            appVersion,
            fonts: true,
            screens: true,
            media: true,
            transparency: true,
          },
        }),
      );
    };
    // A connection the instance dropped while the computer slept still looks open here, and
    // the instance would no longer pass phones to it.
    let answered = true;
    let answers = false;
    let ticked = Date.now();
    const heartbeat = window.setInterval(() => {
      const now = Date.now();
      // A late timer means the computer slept for long enough to be dropped.
      const slept = now - ticked > RELAY_PING_MS * 2;
      ticked = now;
      // Instances that never answer pings predate them and are not held to it.
      if (slept || (answers && !answered)) return lost();
      answered = false;
      this.relaySend({ type: 'ping' });
    }, RELAY_PING_MS);
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const message = JSON.parse(String(event.data)) as RelayToCoordinator;
      if (message.type === 'pong') {
        answered = answers = true;
        return;
      }
      this.relayMessage(message);
    };
    const lost = () => {
      window.clearInterval(heartbeat);
      if (this.socket !== socket) return;
      this.socket = null;
      // Closing a dead connection can take long to finish, so this does not wait for it.
      socket.close();
      this.host.detach();
      const final = ['update-needed', 'unauthorized'].includes(this.status_.relay.kind);
      if (this.stopped || final || !this.connected) return;
      this.update({ relay: { kind: 'connecting' } });
      const delay = RELAY_RETRY_MS[Math.min(this.relayAttempt++, RELAY_RETRY_MS.length - 1)]!;
      this.relayTimer = window.setTimeout(() => this.connectRelay(), delay);
    };
    socket.onclose = lost;
  }

  private relayMessage(message: RelayToCoordinator): void {
    switch (message.type) {
      case 'ready':
        this.relayAttempt = 0;
        if (message.coordinator) {
          this.host.attach({
            send: (to, data) => this.relaySend({ type: 'send', to, data }),
            drop: (to) => this.relaySend({ type: 'drop', to }),
          });
          this.update({ relay: { kind: 'coordinator' } });
        } else {
          this.host.detach();
          this.update({ relay: { kind: 'standby', coordinatorName: message.coordinatorName } });
        }
        return;
      case 'update-needed':
        return this.update({ relay: { kind: 'update-needed' } });
      case 'rejected':
        return this.update({ relay: { kind: 'unauthorized' } });
      case 'changed':
        void this.sync();
        return;
      case 'message':
        void this.host.message(message.from, message.data);
        return;
      case 'left':
        this.host.left(message.from);
        return;
    }
  }
}
