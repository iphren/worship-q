/**
 * The connection to a church instance: content synchronization, off-site backups, the
 * workspace's shared live state, and the relay through which phones and the other devices
 * reach this one.
 *
 * Everything here is optional. Without a connection the app works exactly as before, and
 * losing the connection never interrupts a presentation.
 */
import { getVersion } from '@tauri-apps/api/app';
import {
  DeckSchema,
  deckLyrics,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type Capabilities,
  type DesktopToRelay,
  type HostToRemote,
  type LiveSnapshot,
  type OutputKind,
  type OutputLink,
  type RelayToDesktop,
  type Song,
  type WorkspaceGrant,
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
import { native, type LanCredential, type LanStatus } from '../platform/native';
import { forgetToken, keychainAccount, protectToken } from './credentials';
import { LanHost, LanTransport, type KnownPeer } from './lan';
import { LiveLink, type LiveBackupApi, type LiveStatus } from './liveLink';
import type { OutputController } from './output';
import { TransportSwitch, type Transport, type TransportKind } from './transport';

const SYNC_EVERY_MS = 60_000;
/** Local edits are sent this long after the last one. */
const SYNC_AFTER_EDIT_MS = 2_000;
const BACKUP_EVERY_MS = 12 * 60 * 60 * 1000;
const RELAY_RETRY_MS = [1000, 3000, 10000, 30000];
/** The relay is pinged this often; a ping left unanswered means the connection is gone. */
const RELAY_PING_MS = 15_000;
/** The workspace's device list for the LAN is refreshed this often while the server is reachable. */
const LAN_CREDENTIALS_EVERY_MS = 60 * 60 * 1000;
/**
 * Decision D14 offline rule: with no server and no coordinator found on the LAN after this
 * long, an operator device presents on its own and serves the LAN (plan M5.8).
 */
const OFFLINE_COORDINATOR_MS = 12_000;

export type RelayStatus =
  | { kind: 'off' }
  | { kind: 'connecting' }
  /** Connected; the live link says what role this device has. */
  | { kind: 'connected' }
  | { kind: 'update-needed' }
  | { kind: 'unauthorized' };

export interface CloudStatus {
  sync: SyncStatus;
  relay: RelayStatus;
  state: SyncState | null;
  backup: { kind: 'idle' } | { kind: 'running' } | { kind: 'failed'; message: string };
  /** This device's part in the shared live state; null until connected. */
  live: LiveStatus | null;
  /** Browser output links of the workspace (D22). */
  outputs: OutputLink[];
}

export class CloudController {
  readonly host: RemoteHost;
  private readonly syncStore: SyncStore;
  private client: SyncClient;
  private state: SyncState | null = null;
  private status_: CloudStatus;
  private readonly listeners = new Set<() => void>();
  private link: LiveLink | null = null;
  private transports: TransportSwitch | null = null;
  private relay: RelayTransport | null = null;
  private lanHost: LanHost | null = null;
  private lanTransport: LanTransport | null = null;
  private lan: LanStatus | null = null;
  /** Phones connected over the venue network, by connection; the rest come through the relay. */
  private readonly lanPhones = new Set<string>();
  /** Set while this device presents on its own without the server (plan M5.8). */
  private offlineCoordinator = false;
  private offlineTimer: number | undefined;
  /** The folder this workspace lives in on this computer; names its keychain entry. */
  private workspaceFolder: string | null = null;
  private editTimer: number | undefined;
  private timers: number[] = [];
  private syncing = false;
  private decks: { server: string; available: Promise<boolean> } | null = null;
  private appVersion = '';
  private missingFonts: string[] = [];
  private fontsTimer: number | undefined;

  constructor(
    private readonly session: Session,
    private readonly output: OutputController,
  ) {
    this.syncStore = new SyncStore(session.store);
    this.host = new RemoteHost(
      session,
      () => this.state?.workspaceName ?? '',
      () => Date.now(),
      () => this.state?.deviceId ?? null,
    );
    this.client = this.makeClient();
    this.status_ = {
      sync: { kind: 'disconnected' },
      relay: { kind: 'off' },
      state: null,
      backup: { kind: 'idle' },
      live: null,
      outputs: [],
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

  /** A request to the instance with this device's token and the protocol version. */
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { server, deviceToken } = this.state ?? {};
    if (!server || !deviceToken) throw new Error('not-connected');
    const headers: Record<string, string> = {
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
      authorization: `Bearer ${deviceToken}`,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${server}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return (await response.json()) as T;
  }

  async start(): Promise<void> {
    this.state = await this.client.load();
    this.appVersion = await getVersion().catch(() => '');
    await this.protectCredentials();
    this.update({ state: this.state, sync: this.client.status });
    // Edits made here are sent shortly after; content applied from the instance is not.
    this.session.subscribe(() => {
      if (this.syncing || !this.connected) return;
      window.clearTimeout(this.editTimer);
      this.editTimer = window.setTimeout(() => void this.syncIfChanged(), SYNC_AFTER_EDIT_MS);
      this.scheduleFontCheck();
    });
    this.timers.push(window.setInterval(() => void this.sync(), SYNC_EVERY_MS));
    this.timers.push(window.setInterval(() => void this.backupIfDue(), 60 * 60 * 1000));
    if (!this.connected) return;
    await this.checkFonts();
    this.lan = await native.lanStatus().catch(() => null);
    await this.startLive();
    await this.sync();
    await this.backupIfDue();
    await this.refreshOutputs().catch(() => undefined);
    await this.refreshLanCredentials();
    this.timers.push(
      window.setInterval(() => void this.refreshLanCredentials(), LAN_CREDENTIALS_EVERY_MS),
    );
  }

  stop(): void {
    this.timers.forEach((t) => window.clearInterval(t));
    window.clearTimeout(this.editTimer);
    window.clearTimeout(this.fontsTimer);
    window.clearTimeout(this.offlineTimer);
    this.relay?.close();
    this.lanTransport?.close();
    this.lanHost?.stop();
    this.link?.stop();
    this.host.dispose();
  }

  // ── Credentials (decision D23) ───────────────────────────────────────────

  /** Moves the device token into the system keychain, or loads it from there. */
  private async protectCredentials(): Promise<void> {
    try {
      const folder =
        this.workspaceFolder ??
        (await native.listWorkspaces()).find((entry) => entry.active)?.id ??
        this.session.workspace.id;
      this.workspaceFolder = folder;
      await protectToken(
        {
          getState: () => this.syncStore.getState(),
          setState: (patch) => this.syncStore.setState(patch),
          setMemoryToken: (token) => this.syncStore.setMemoryToken(token),
        },
        {
          set: native.keychainSet,
          get: native.keychainGet,
          delete: native.keychainDelete,
        },
        keychainAccount(folder),
      );
    } catch {
      // The database copy stays; Settings says the token is not yet protected.
    }
    this.state = await this.syncStore.getState();
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
    await this.protectCredentials();
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
    if (this.workspaceFolder) {
      await forgetToken(
        { set: native.keychainSet, get: native.keychainGet, delete: native.keychainDelete },
        keychainAccount(this.workspaceFolder),
      );
    }
    this.relay?.close();
    this.relay = null;
    this.lanTransport?.close();
    this.lanHost?.stop();
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

  /**
   * The link a phone opens to ask for control, as shown in the QR code. It also names the
   * coordinator's address and certificate fingerprint on the venue network (plan M5.6), for
   * phones whose browser accepts the certificate.
   */
  remoteLink(): string | null {
    const { server, workspaceServerId } = this.state ?? {};
    if (!server || !workspaceServerId) return null;
    let hints = '';
    const coordinator = this.coordinatorLan();
    if (coordinator) {
      hints =
        `&f=${encodeURIComponent(coordinator.fingerprint)}` +
        `&a=${encodeURIComponent(coordinator.addresses.join(','))}&p=${coordinator.port}`;
    }
    return `${server}/remote/?w=${encodeURIComponent(workspaceServerId)}#i=${this.host.invite()}${hints}`;
  }

  /** Where the coordinator can be reached on the venue network, if known. */
  private coordinatorLan(): KnownPeer | null {
    const status = this.link?.status;
    if (!status) return null;
    if (status.role === 'coordinator' && this.lan && this.lan.addresses.length > 0) {
      return {
        deviceId: this.state?.deviceId ?? '',
        name: this.state?.deviceName ?? '',
        fingerprint: this.lan.fingerprint,
        addresses: this.lan.addresses,
        port: this.lan.port,
      };
    }
    return this.knownPeers().find((peer) => peer.deviceId === status.coordinatorId) ?? null;
  }

  /** Devices whose LAN fingerprints the server gave, now or earlier (D19). */
  private knownPeers(): KnownPeer[] {
    const fromRelay: KnownPeer[] = (this.link?.status.peers ?? []).flatMap((peer) =>
      peer.lan ? [{ deviceId: peer.deviceId, name: peer.name, ...peer.lan }] : [],
    );
    const cached = this.state?.lanPeers ?? [];
    const ids = new Set(fromRelay.map((peer) => peer.deviceId));
    return [...fromRelay, ...cached.filter((peer) => !ids.has(peer.deviceId))];
  }

  /** Keeps the workspace's device list for the LAN fresh, and cached for when offline (M5.3). */
  private async refreshLanCredentials(): Promise<void> {
    if (!this.lanHost) return;
    let credentials: LanCredential[] | null = this.state?.lanCredentials ?? null;
    try {
      const { devices } = await this.call<{ devices: LanCredential[] }>(
        'GET',
        '/api/v1/workspace/lan-credentials',
      );
      credentials = devices;
      await this.syncStore.setState({ lanCredentials: devices });
    } catch {
      // Offline: the cached list stands.
    }
    if (credentials) await this.lanHost.setCredentials(credentials);
  }

  private rememberedPeers = '';

  /** Remembers where the workspace's devices are on the LAN, from the relay's peer list. */
  private async rememberPeers(): Promise<void> {
    const peers = this.knownPeers();
    const key = JSON.stringify(peers);
    if (peers.length === 0 || key === this.rememberedPeers) return;
    this.rememberedPeers = key;
    await this.syncStore.setState({ lanPeers: peers }).catch(() => undefined);
  }

  /**
   * Makes this computer the coordinator of the workspace's live state, in place of another
   * (Use this computer) or after the coordinator was lost (Carry on here; decision D18).
   */
  takeOver(): void {
    this.link?.claim();
  }

  /** Ends every phone's and every browser output's access to the presentation (M8.3). */
  async disconnectEverything(): Promise<void> {
    await this.host.disconnectAll();
    await this.revokeOutput('all').catch(() => undefined);
  }

  // ── Browser outputs (D22) ────────────────────────────────────────────────

  async refreshOutputs(): Promise<OutputLink[]> {
    const { links } = await this.call<{ links: OutputLink[] }>('GET', '/api/v1/outputs');
    this.update({ outputs: links });
    return links;
  }

  /** Makes a link; its address, with the token, is returned this once. */
  async createOutput(kind: OutputKind, name: string): Promise<OutputLink> {
    const link = await this.call<OutputLink>('POST', '/api/v1/outputs', { kind, name });
    await this.refreshOutputs();
    return link;
  }

  /** Revokes one link, or every link with `all`; pages using it stop at once. */
  async revokeOutput(id: string): Promise<void> {
    await this.call('DELETE', `/api/v1/outputs/${encodeURIComponent(id)}`);
    await this.refreshOutputs();
  }

  // ── Fonts (M8.5) ─────────────────────────────────────────────────────────

  private scheduleFontCheck(): void {
    window.clearTimeout(this.fontsTimer);
    this.fontsTimer = window.setTimeout(() => void this.checkFonts(), 2000);
  }

  /** Which of the workspace's output fonts this computer lacks; told to the coordinator. */
  private async checkFonts(): Promise<void> {
    try {
      const installed = new Set(await native.listFontFamilies());
      const wanted = [
        await this.session.fontFamily('slideshow'),
        await this.session.fontFamily('subtitle'),
      ].filter((font): font is string => !!font);
      const missing = [...new Set(wanted.filter((font) => !installed.has(font)))];
      if (missing.join('|') !== this.missingFonts.join('|')) {
        this.missingFonts = missing;
        this.link?.capabilitiesChanged();
      }
    } catch {
      // Fonts cannot be listed here; nothing is reported.
    }
  }

  private capabilities(): Capabilities {
    return {
      roles: this.session.isViewer ? ['display', 'overlay'] : ['coordinator', 'display', 'overlay'],
      appVersion: this.appVersion,
      fonts: true,
      screens: true,
      media: true,
      transparency: true,
      missingFonts: this.missingFonts,
    };
  }

  // ── The shared live state ────────────────────────────────────────────────

  private async startLive(): Promise<void> {
    const backup: LiveBackupApi = {
      put: (snapshot: LiveSnapshot, grants: WorkspaceGrant[]) =>
        this.call('PUT', '/api/v1/live', { snapshot, grants }).then(() => undefined),
      get: () =>
        this.call<{ snapshot: LiveSnapshot | null; grants: WorkspaceGrant[] }>(
          'GET',
          '/api/v1/live',
        ),
    };
    const hello = (): Extract<DesktopToRelay, { type: 'hello' }> => ({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      token: this.state?.deviceToken ?? '',
      capabilities: this.capabilities(),
      role: this.session.isViewer ? 'viewer' : 'operator',
      lan: this.lan
        ? { fingerprint: this.lan.fingerprint, addresses: this.lan.addresses, port: this.lan.port }
        : null,
    });
    const link = new LiveLink({
      session: this.session,
      host: this.host,
      deviceId: () => this.state?.deviceId ?? '',
      deviceName: () => this.state?.deviceName ?? 'This computer',
      capabilities: () => this.capabilities(),
      // The coordinator's messages reach followers both ways; a follower's go the active way.
      send: (message) => {
        if (message.type === 'toFollower') {
          this.transports?.sendOn('relay', message);
          this.lanHost?.send(message);
        } else if (this.offlineCoordinator && message.type === 'claim') {
          // Nothing to claim from while offline.
        } else {
          this.transports?.send(message);
        }
      },
      backup,
      grantsRegistered: {
        get: async () => (await this.syncStore.getState()).grantsRegisteredAt !== null,
        set: async () => {
          await this.syncStore.setState({ grantsRegisteredAt: new Date().toISOString() });
        },
      },
    });
    let lastRole: LiveStatus['role'] | null = null;
    let lastCoordinator: string | null = null;
    link.subscribe(() => {
      const status = link.status;
      this.update({ live: status });
      if (status.role !== lastRole) {
        lastRole = status.role;
        void this.lanHost?.setCoordinating(status.role === 'coordinator');
      }
      if (status.coordinatorId !== lastCoordinator) {
        lastCoordinator = status.coordinatorId;
        this.lanTransport?.lookNow();
      }
      void this.rememberPeers();
    });
    this.link = link;
    this.update({ live: link.status });

    // The coordinator's side of the venue network: a relay room over the connections the
    // native core accepts (plan M5.3, M6.3).
    this.lanHost = new LanHost({
      workspaceId: () => this.state?.workspaceServerId ?? '',
      deviceId: () => this.state?.deviceId ?? '',
      deviceName: () => this.state?.deviceName ?? 'This computer',
      hello,
      onMessage: (message) => {
        switch (message.type) {
          case 'ready':
            link.setLanPeers(this.lanHost?.peers ?? []);
            return;
          case 'peer':
            link.receive(message);
            return;
          case 'message':
            this.lanPhones.add(message.from);
            void this.host.message(message.from, message.data);
            return;
          case 'left':
            this.lanPhones.delete(message.from);
            this.host.left(message.from);
            return;
        }
      },
    });
    await this.lanHost.start().catch(() => undefined);

    const transportEvents = {
      open: (kind: TransportKind) => this.transports?.opened(kind),
      close: (kind: TransportKind) => this.transports?.closed(kind),
      message: (kind: TransportKind, message: RelayToDesktop) =>
        this.transports?.received(kind, message),
    };
    this.relay = new RelayTransport({
      url: () => `${(this.state?.server ?? '').replace(/^http/, 'ws')}/api/v1/coordinator`,
      hello,
      events: {
        ...transportEvents,
        open: (kind) => {
          // Phones always come through the church server, whatever carries the live state.
          this.host.attach({
            send: (to, data) => this.sendToPhone(to, data),
            drop: (to) => this.dropPhone(to),
          });
          if (this.offlineCoordinator) {
            // Back online after presenting alone: the server is asked to agree (D14).
            this.offlineCoordinator = false;
            this.transports?.sendOn('relay', { type: 'claim' });
          }
          this.transports?.opened(kind);
        },
        close: (kind) => {
          this.host.detach();
          this.transports?.closed(kind);
          this.considerOffline();
        },
        status: (relay) => this.update({ relay }),
      },
    });
    // The follower's side of the venue network: the coordinator found by mDNS (plan M5.5).
    this.lanTransport = new LanTransport({
      workspaceId: () => this.state?.workspaceServerId ?? '',
      token: () => this.state?.deviceToken ?? '',
      hello,
      knownPeers: () => this.knownPeers(),
      coordinatorId: () => (this.relay?.open ? (link.status.coordinatorId ?? null) : null),
      enabled: () => link.status.role !== 'coordinator' && !this.offlineCoordinator,
      events: transportEvents,
    });
    this.transports = new TransportSwitch([this.relay, this.lanTransport], {
      open: (kind) => link.connected(kind),
      close: () => link.disconnected(),
      message: (_kind, message) => {
        switch (message.type) {
          case 'changed':
            void this.sync();
            return;
          case 'message':
            void this.host.message(message.from, message.data);
            return;
          case 'left':
            this.host.left(message.from);
            return;
          default:
            link.receive(message);
        }
      },
    });
    this.relay.start();
    this.lanTransport.start();
    this.considerOffline();
  }

  private sendToPhone(to: string | undefined, data: HostToRemote): void {
    if (to === undefined) {
      this.transports?.sendOn('relay', { type: 'send', data });
      this.lanHost?.send({ type: 'send', data });
    } else if (this.lanPhones.has(to)) {
      this.lanHost?.send({ type: 'send', to, data });
    } else {
      this.transports?.sendOn('relay', { type: 'send', to, data });
    }
  }

  private dropPhone(to: string): void {
    if (this.lanPhones.has(to)) this.lanHost?.send({ type: 'drop', to });
    else this.transports?.sendOn('relay', { type: 'drop', to });
  }

  /**
   * Decision D14 without the server (plan M5.8): an operator device that reaches neither
   * the server nor a coordinator on the LAN presents on its own and serves the LAN. When
   * two such coordinators later meet, the older live state is kept (M4.7).
   */
  private considerOffline(): void {
    window.clearTimeout(this.offlineTimer);
    if (this.session.isViewer) return;
    this.offlineTimer = window.setTimeout(() => {
      const link = this.link;
      if (!link || this.relay?.open || this.lanTransport?.open || this.offlineCoordinator) return;
      if (link.status.role === 'coordinator') return;
      this.offlineCoordinator = true;
      const deviceId = this.state?.deviceId ?? '';
      link.connected('lan');
      link.receive({
        type: 'ready',
        workspaceId: this.state?.workspaceServerId ?? '',
        deviceId,
        coordinator: true,
        coordinatorName: this.state?.deviceName ?? null,
        coordinatorId: deviceId,
        peers: [
          {
            deviceId,
            name: this.state?.deviceName ?? '',
            role: 'operator',
            connectedAt: new Date().toISOString(),
          },
        ],
      });
    }, OFFLINE_COORDINATOR_MS);
  }

  /** Dismisses the notice that another computer took over the presentation. */
  dismissDemoted(): void {
    this.link?.dismissDemoted();
  }
}

/** The WebSocket to the church server's relay, reconnecting until closed. */
class RelayTransport implements Transport {
  readonly kind: TransportKind = 'relay';
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: number | undefined;
  private stopped = false;
  private open_ = false;

  constructor(
    private readonly options: {
      url(): string;
      hello(): Extract<DesktopToRelay, { type: 'hello' }>;
      events: {
        open(kind: TransportKind): void;
        close(kind: TransportKind): void;
        message(kind: TransportKind, message: RelayToDesktop): void;
        status(status: RelayStatus): void;
      };
    },
  ) {}

  get open(): boolean {
    return this.open_;
  }

  start(): void {
    this.connect();
  }

  send(message: DesktopToRelay): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.socket?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const { events } = this.options;
    events.status({ kind: 'connecting' });
    const socket = new WebSocket(this.options.url());
    this.socket = socket;
    let final = false;
    socket.onopen = () => this.send(this.options.hello());
    // A connection the instance dropped while the computer slept still looks open here, and
    // the instance would no longer pass messages to it.
    let answered = true;
    let ticked = Date.now();
    const heartbeat = window.setInterval(() => {
      const now = Date.now();
      // A late timer means the computer slept for long enough to be dropped.
      const slept = now - ticked > RELAY_PING_MS * 2;
      ticked = now;
      if (slept || !answered) return lost();
      answered = false;
      this.send({ type: 'ping' });
    }, RELAY_PING_MS);
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const message = JSON.parse(String(event.data)) as RelayToDesktop;
      answered = true;
      switch (message.type) {
        case 'pong':
          return;
        case 'ready':
          this.attempt = 0;
          if (!this.open_) {
            this.open_ = true;
            events.status({ kind: 'connected' });
            events.open(this.kind);
          }
          break;
        case 'update-needed':
          final = true;
          events.status({ kind: 'update-needed' });
          return;
        case 'rejected':
          final = true;
          events.status({ kind: 'unauthorized' });
          return;
      }
      events.message(this.kind, message);
    };
    const lost = () => {
      window.clearInterval(heartbeat);
      if (this.socket !== socket) return;
      this.socket = null;
      // Closing a dead connection can take long to finish, so this does not wait for it.
      socket.close();
      if (this.open_) {
        this.open_ = false;
        events.close(this.kind);
      }
      if (this.stopped || final) return;
      events.status({ kind: 'connecting' });
      const delay = RELAY_RETRY_MS[Math.min(this.attempt++, RELAY_RETRY_MS.length - 1)]!;
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
    socket.onclose = lost;
  }
}
