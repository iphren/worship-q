/**
 * The connection to a church instance: content synchronization, off-site backups, the
 * workspace's shared live state, and the relay through which phones and the other devices
 * reach this one.
 *
 * Everything here is optional. Without a connection the app works exactly as before, and
 * losing the connection never interrupts a presentation. That includes this computer's OBS
 * link: its own controls work without one, and are shared with the workspace with one.
 */
import { getVersion } from '@tauri-apps/api/app';
import {
  AUDIO_PROTOCOL_VERSION,
  DeckSchema,
  deckLyrics,
  OBS_PROTOCOL_VERSION,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type BiblePassageResponse,
  type BibleVersionsResponse,
  type Capabilities,
  type AudioState,
  type DesktopToRelay,
  type HostToRemote,
  type IceServer,
  type LiveSnapshot,
  type OutputKind,
  type OutputLink,
  type PairingStartResponse,
  type RelayToDesktop,
  type ServerInfo,
  type Song,
  type WorkspaceGrant,
} from '@worship-q/protocol';
import { RemoteHost } from '@worship-q/remote';
import { browserBroadcastPeer, browserMediaPort, type BrowserTrack } from '@worship-q/audio';
import type { Session } from '@worship-q/session';
import { SyncStore, type SyncState } from '@worship-q/store';
import {
  httpApi,
  negotiate,
  normalizeServer,
  SyncClient,
  type FileTransfer,
  type JoinMode,
  type SyncStatus,
} from '@worship-q/sync';
import { native, type LanCredential, type LanStatus } from '../platform/native';
import { infoDue } from './serverInfo';
import { BibleClient, BibleRequestError, workspaceVersions, type BibleServer } from './bible';
import { forgetToken, keychainAccount, protectToken } from './credentials';
import { deckIdOf, originalSource, probeVideo } from './mediaFiles';
import { mediaOffer, type MediaOffer } from './media';
import { MediaUploads, type UploadDeps, type UploadTarget } from './uploads';
import { VideoCache, type VideoCacheDeps } from './videoCache';
import { LanHost, LanTransport, type KnownPeer } from './lan';
import { AudioListen } from './audioListen';
import { AudioReporter } from './audioReport';
import { audioSwitchStore } from './audioSettings';
import { AudioShare } from './audioShare';
import { deviceSettings } from './deviceSettings';
import { IceServers } from './iceServers';
import { LiveLink, type LiveBackupApi, type LiveStatus } from './liveLink';
import { ObsLink, obsKeychainAccount, obsSettingsStore, type ObsNative } from './obs';
import { ObsReporter } from './obsReport';
import { ObsShare, shareObsWithPhones } from './obsShare';
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
  /**
   * Whether this run has the device token: `refused` when the keychain would not give it
   * back (macOS asks after each update), `missing` when its entry is gone (D23).
   */
  credentials: 'ok' | 'refused' | 'missing';
  /** What the instance said about itself when last asked; null when it could not be asked. */
  server: ServerInfo | null;
}

/** What joining a workspace will do, shown before the operator chooses how (plan M2). */
export interface JoinPreview {
  workspaceName: string;
  churchEmpty: boolean;
  hasLocalContent: boolean;
  /**
   * The administrator who approved the pairing let this computer keep its own content
   * (“Keep both”). Always true when joining with a connection code.
   */
  allowMerge: boolean;
}

/** The native OBS link (`src-tauri/src/obs.rs`). */
const obsNative: ObsNative = {
  connect: native.obsConnect,
  disconnect: native.obsDisconnect,
  request: native.obsRequest,
  readConfig: native.obsReadConfig,
  listen: native.onObs,
};

export class CloudController {
  readonly host: RemoteHost;
  /** The workspace's OBS state on this desktop (OBS control plan). */
  readonly obs: ObsShare;
  /** The workspace's live audio on this desktop (live audio plan). */
  readonly audio: AudioShare;
  /** **Listen** on this desktop; null outside a window. */
  readonly listen: AudioListen | null;
  /** The ICE servers for live audio, from the church server (A10). */
  private readonly ice: IceServers;
  /** Tells the church server this computer's broadcast, for the admin app (A21). */
  private audioReporter: AudioReporter | null = null;
  private readonly audioWindowEvents: (() => void)[] = [];
  /** Media being uploaded from this computer; they carry on across pages (U16). */
  readonly uploads: MediaUploads;
  /** This computer's copies of the videos of upcoming run sheets (U8, U9). */
  readonly videos: VideoCache;
  /** The church's Bible, through the church server (B17, P4.1). */
  readonly bible: BibleClient;
  private videoTimer: number | undefined;
  private readonly syncStore: SyncStore;
  private client: SyncClient;
  private state: SyncState | null = null;
  private status_: CloudStatus;
  private readonly listeners = new Set<() => void>();
  private link: LiveLink | null = null;
  private transports: TransportSwitch | null = null;
  private relay: RelayTransport | null = null;
  /** Tells the church server this computer's OBS state, for the admin app. */
  private obsReporter: ObsReporter | null = null;
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
  private appVersion = '';
  private missingFonts: string[] = [];
  private fontsTimer: number | undefined;
  /** The protocol version spoken to the instance: its own when older than ours (D26). */
  private protocolVersion = PROTOCOL_VERSION;

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
    this.bible = new BibleClient(
      () => this.bibleServer(),
      () => (typeof localStorage === 'undefined' ? null : localStorage),
      () => this.state?.server ?? '',
    );
    // Phones use the Bible through this desktop (B26).
    this.host.setBible({
      versions: async () => {
        const offered = await this.bible.versions();
        const chosen = await session.store.getBibleVersions(session.workspace.id);
        const church = (await session.store.getChurchSettings()).bibleDefaultVersions ?? [];
        return { offered, versions: workspaceVersions(chosen, offered, church) };
      },
      setVersions: async (versions) => {
        await session.setBibleVersions(versions);
      },
      toc: (version, chapter) =>
        chapter
          ? this.bible.tocWithChapter(version, chapter.book, chapter.chapter)
          : this.bible.toc(version),
      passage: (versions, reference) => this.bible.passage(versions, reference),
      search: (version, query) => this.bible.search(version, query),
    });
    this.uploads = new MediaUploads(this.uploadDeps());
    this.videos = new VideoCache(this.videoCacheDeps());
    let readyVideos = 0;
    this.videos.subscribe(() => {
      // A copy that arrived may be the one on screen.
      const ready = [...this.videos.statuses.values()].filter((s) => s.kind === 'ready').length;
      if (ready > readyVideos) this.output.fileArrived();
      readyVideos = ready;
    });
    this.obs = new ObsShare({
      deviceId: () => this.state?.deviceId ?? '',
      deviceName: () => this.state?.deviceName ?? 'This computer',
    });
    shareObsWithPhones(this.obs, this.host);
    this.ice = new IceServers(() =>
      this.connected
        ? this.call<{ iceServers: IceServer[] }>('GET', '/api/v1/ice')
        : Promise.reject(new Error('not-connected')),
    );
    const media =
      typeof navigator !== 'undefined' && navigator.mediaDevices
        ? browserMediaPort(navigator.mediaDevices)
        : null;
    this.audio = new AudioShare({
      deviceId: () => this.state?.deviceId ?? '',
      deviceName: () => this.state?.deviceName ?? 'This computer',
      chosenInput: () => deviceSettings.get().audioInput,
      inputMoved: (device) => deviceSettings.set({ audioInput: device }),
      media: media ?? {
        list: async () => ({ inputs: [], defaultLabel: null }),
        open: () => Promise.reject(Object.assign(new Error('no media'), { name: 'NotFoundError' })),
        visible: () => true,
      },
      // The tracks come from `browserMediaPort`, so they are its own.
      createPeer: ({ track, iceServers, events }) =>
        browserBroadcastPeer({ track: track as BrowserTrack | null, iceServers, events }),
      iceServers: () => this.ice.get(),
      keepAwake: (on) => void native.keepDisplayAwake(on).catch(() => undefined),
    });
    // Phones listen through this desktop (M4.1).
    this.host.setAudio({
      view: () => this.audio.remoteView(),
      signal: (phone, signal) => this.audio.fromPhone(phone, signal),
      gone: (grantId) => this.audio.phoneGone(grantId),
      left: (grantId) => this.audio.phoneLeft(grantId),
    });
    this.audio.setPhones({
      changed: () => this.host.audioChanged(),
      deliver: (grantId, signal) => this.host.audioSignal(grantId, signal),
    });
    this.listen =
      typeof document === 'undefined'
        ? null
        : new AudioListen({
            share: this.audio,
            iceServers: () => this.ice.get(),
            monitor: () => deviceSettings.get().audioMonitor,
            applySink: (id) =>
              native.monitorAudioSink(id).catch(() => window.__worshipQMonitor?.(id)),
          });
    this.status_ = {
      sync: { kind: 'disconnected' },
      relay: { kind: 'off' },
      state: null,
      backup: { kind: 'idle' },
      live: null,
      outputs: [],
      credentials: 'ok',
      server: null,
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
      () => this.protocolVersion,
    );
    const client = new SyncClient(this.session, this.syncStore, api, files);
    client.subscribe(() => {
      this.update({ sync: client.status });
      // The instance refused our version: it may have been updated, or we were. Ask it
      // again what it speaks and try once more at that version (D26).
      if (client.status.kind === 'update-needed') void this.renegotiate();
    });
    return client;
  }

  /**
   * Asks the instance what it speaks and keeps to that (D26), so a desktop updated before
   * its church's server keeps working as a version 2 client. Also learns what the instance
   * offers: pairing, the admin app.
   */
  private async negotiate(server: string): Promise<ServerInfo | null> {
    const { protocol, info } = await negotiate(server);
    this.protocolVersion = protocol;
    this.update({ server: info });
    return info;
  }

  private renegotiating = false;

  private async renegotiate(): Promise<void> {
    const server = this.state?.server;
    if (!server || this.renegotiating) return;
    this.renegotiating = true;
    try {
      const before = this.protocolVersion;
      await this.negotiate(server);
      if (this.protocolVersion !== before) {
        this.link?.capabilitiesChanged();
        await this.sync();
        // The hello carries the version; a fresh connection says the new one.
        this.relay?.reconnect();
      }
    } finally {
      this.renegotiating = false;
    }
  }

  /**
   * Asks the instance its version again when the relay connection reopens, which it does
   * after every server restart, so a server updated while this app runs is noticed without
   * waiting for a refusal: an updated server still accepts the older version, so none comes
   * (D26; OBS control M2.9). An unreachable instance leaves the version as it was.
   */
  private async recheckProtocol(): Promise<void> {
    const server = this.state?.server;
    if (!server || this.renegotiating) return;
    const { protocol, info } = await negotiate(server);
    if (!info || server !== this.state?.server) return;
    this.update({ server: info });
    if (protocol === this.protocolVersion) return;
    this.protocolVersion = protocol;
    this.link?.capabilitiesChanged();
    // The hello carries the version and the capabilities; a fresh connection says the new ones.
    this.relay?.reconnect();
  }

  /**
   * The church server's Bible routes, while this computer is connected to a server that
   * offers a Bible; null otherwise, when the window uses what it saved (P4.1).
   */
  private bibleServer(): BibleServer | null {
    const { server, deviceToken } = this.state ?? {};
    // Asked even when the server's last info said it had no Bible: that may be out of date,
    // and the server refuses a version it does not offer.
    if (!server || !deviceToken) return null;
    const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const headers: Record<string, string> = {
        [PROTOCOL_HEADER]: String(this.protocolVersion),
        authorization: `Bearer ${deviceToken}`,
      };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${server}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        const code = answer.error;
        throw new BibleRequestError(
          code === 'not-offered' ||
            code === 'not-found' ||
            code === 'too-large' ||
            code === 'unavailable'
            ? code
            : 'unavailable',
          answer.reason ?? `${response.status}`,
        );
      }
      return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
    };
    const v = (version: string) => encodeURIComponent(version);
    return {
      versions: async () =>
        (await request<BibleVersionsResponse>('GET', '/api/v1/bible/versions')).versions,
      toc: (version, chapter) =>
        request(
          'GET',
          `/api/v1/bible/${v(version)}/toc${chapter ? `?book=${chapter.book}&chapter=${chapter.chapter}` : ''}`,
        ),
      passage: async (version, usfm, device, session) =>
        (
          await request<BiblePassageResponse>(
            'GET',
            `/api/v1/bible/${v(version)}/passage?ref=${encodeURIComponent(usfm)}&device=${device}&session=${session}`,
          )
        ).text,
      search: (version, query) =>
        request('GET', `/api/v1/bible/${v(version)}/search?q=${encodeURIComponent(query)}`),
      reportUsage: (tokens, device, session) =>
        request('POST', '/api/v1/bible/fums', { tokens, device, session }),
    };
  }

  /** A request to the instance with this device's token and the protocol version. */
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { server, deviceToken } = this.state ?? {};
    if (!server || !deviceToken) throw new Error('not-connected');
    const headers: Record<string, string> = {
      [PROTOCOL_HEADER]: String(this.protocolVersion),
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
    // A computer that left its church before the defaults were forgotten on leaving.
    if (!this.state?.deviceToken) await this.session.store.dropChurchSettings();
    // Run sheet edits, here or arriving, may need videos fetched or let them go (U8, U9).
    this.session.subscribe(() => this.scheduleVideos());
    this.scheduleVideos();
    // Edits made here are sent shortly after; content applied from the instance is not.
    this.session.subscribe(() => {
      if (this.syncing || !this.connected) return;
      window.clearTimeout(this.editTimer);
      this.editTimer = window.setTimeout(() => void this.syncIfChanged(), SYNC_AFTER_EDIT_MS);
      this.scheduleFontCheck();
    });
    let tick = 0;
    this.timers.push(
      window.setInterval(() => {
        void this.sync();
        // What the server offers can change while this app runs (P4.5).
        if (this.connected && infoDue(this.status_.server, ++tick)) {
          void this.recheckProtocol().catch(() => undefined);
        }
      }, SYNC_EVERY_MS),
    );
    this.timers.push(window.setInterval(() => void this.backupIfDue(), 60 * 60 * 1000));
    // Before anything that needs the church: the OBS computer's controls work without it.
    await this.startObs().catch(console.error);
    // So does capture for live audio, which starts with the workspace when switched on (A15).
    this.startAudio();
    if (!this.connected) return;
    await this.checkFonts();
    if (this.state?.server) await this.negotiate(this.state.server);
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
    window.clearTimeout(this.videoTimer);
    this.relay?.close();
    this.lanTransport?.close();
    this.lanHost?.stop();
    this.link?.stop();
    this.obsReporter?.stop();
    this.obs.localLink?.stop();
    this.obs.stop();
    this.audioReporter?.stop();
    for (const remove of this.audioWindowEvents.splice(0)) remove();
    this.listen?.dispose();
    this.audio.stop();
    this.host.dispose();
  }

  /**
   * This computer's OBS link, for this workspace (O10): settings in this computer's storage,
   * the password in the keychain beside the device token.
   */
  private async startObs(): Promise<void> {
    const folder = this.workspaceFolder ?? this.session.workspace.id;
    const account = obsKeychainAccount(folder);
    const link = new ObsLink({
      native: obsNative,
      settings: obsSettingsStore(
        () => (typeof localStorage === 'undefined' ? null : localStorage),
        folder,
      ),
      secrets: {
        get: () => native.keychainGet(account),
        set: (password) => native.keychainSet(account, password),
        delete: () => native.keychainDelete(account),
      },
    });
    this.obs.setLink(link);
    await link.start();
  }

  /**
   * Live audio for this workspace (A12, A15): the switch in this computer's storage beside
   * the OBS link, and the main window's device and visibility changes for the input watcher.
   */
  private startAudio(): void {
    const folder = this.workspaceFolder ?? this.session.workspace.id;
    if (typeof window !== 'undefined') {
      const devices = () => this.audio.devicesChanged();
      const visibility = () => this.audio.visibilityChanged();
      navigator.mediaDevices?.addEventListener('devicechange', devices);
      document.addEventListener('visibilitychange', visibility);
      this.audioWindowEvents.push(
        () => navigator.mediaDevices?.removeEventListener('devicechange', devices),
        () => document.removeEventListener('visibilitychange', visibility),
      );
    }
    this.audio.start(
      audioSwitchStore(() => (typeof localStorage === 'undefined' ? null : localStorage), folder),
    );
  }

  /** The church server relays audio messages: it speaks protocol 7. */
  private audioSupported(): boolean {
    return this.protocolVersion >= AUDIO_PROTOCOL_VERSION;
  }

  /** The church server relays OBS messages: it speaks protocol 4 (M2.9). */
  private obsSupported(): boolean {
    return this.protocolVersion >= OBS_PROTOCOL_VERSION;
  }

  // ── Credentials (decision D23) ───────────────────────────────────────────

  /** Moves the device token into the system keychain, or loads it from there. */
  private async protectCredentials(): Promise<void> {
    let credentials: CloudStatus['credentials'] = 'ok';
    try {
      const folder =
        this.workspaceFolder ??
        (await native.listWorkspaces()).find((entry) => entry.active)?.id ??
        this.session.workspace.id;
      this.workspaceFolder = folder;
      const loaded = await protectToken(
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
      if (loaded === 'refused' || loaded === 'missing') credentials = loaded;
    } catch {
      // The database copy stays; Settings says the token is not yet protected.
    }
    this.state = await this.syncStore.getState();
    this.update({ credentials });
  }

  /** Asks the keychain again for the token it refused, by starting over (D23). */
  retryCredentials(): void {
    window.location.reload();
  }

  private async refreshState(): Promise<void> {
    this.state = await this.syncStore.getState();
    this.update({ state: this.state });
  }

  /**
   * **Sync now**: the content, and what the server offers (its Bible, media, protocol),
   * which a desktop otherwise asks again only from time to time.
   */
  async syncNow(): Promise<void> {
    await Promise.all([this.sync(), this.recheckProtocol().catch(() => undefined)]);
  }

  async sync(): Promise<void> {
    if (!this.connected) return;
    this.syncing = true;
    try {
      await this.client.run();
    } finally {
      this.syncing = false;
      await this.refreshState();
      this.scheduleVideos();
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
  async enroll(address: string, code: string, deviceName: string): Promise<JoinPreview> {
    const server = await this.aim(address);
    const enrolled = await this.client.enroll(server, code, deviceName);
    return this.joined(enrolled.workspace, true);
  }

  /**
   * Asks the instance at `address` what it is, before connecting (D26, D29): whether new
   * computers pair with an administrator's approval, or still join with a code.
   */
  async probe(address: string): Promise<ServerInfo | null> {
    return this.negotiate(normalizeServer(address));
  }

  /**
   * Asks the instance to pair this computer (D29). The code and link are shown to the
   * operator; `pollPairing` then waits for an administrator.
   */
  async startPairing(address: string, deviceName: string): Promise<PairingStartResponse> {
    await this.aim(address);
    return this.client.startPairing(deviceName);
  }

  /** One poll of a pairing; on approval this computer is enrolled and ready to join. */
  async pollPairing(
    secret: string,
    deviceName: string,
  ): Promise<
    { status: 'pending' | 'refused' | 'expired' } | { status: 'approved'; join: JoinPreview }
  > {
    const server = this.state?.server;
    if (!server) throw new Error('not-connected');
    const result = await this.client.pollPairing(server, secret, deviceName);
    if (result.status !== 'approved') return { status: result.status };
    return {
      status: 'approved',
      join: await this.joined(result.workspace, result.allowMerge !== false),
    };
  }

  /** Points the connection at an instance and learns what it speaks. */
  private async aim(address: string): Promise<string> {
    const server = normalizeServer(address);
    this.state = { ...(this.state ?? (await this.syncStore.getState())), server };
    await this.negotiate(server);
    return server;
  }

  private async joined(
    workspace: { name: string; contentId: string | null },
    allowMerge: boolean,
  ): Promise<JoinPreview> {
    await this.protectCredentials();
    await this.refreshState();
    return {
      workspaceName: workspace.name,
      churchEmpty: workspace.contentId === null,
      hasLocalContent: await this.syncStore.hasContent(this.session.workspace.id),
      allowMerge,
    };
  }

  /** The admin app's address, when the instance has one (phase 3). */
  get adminUrl(): string | null {
    const server = this.state?.server;
    return server && this.status_.server?.admin ? `${server}/admin/` : null;
  }

  // ── Two versions of a song (D32) ─────────────────────────────────────────

  /**
   * Drops this workspace's own version of a church song, going back to the church's here
   * and, through the instance, on the workspace's other computers.
   */
  async deleteOwnVersion(songId: string): Promise<void> {
    if (!this.connected) throw new Error('not-connected');
    await this.client.deleteOwnVersion('song', songId);
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

  // ── Media (media uploads plan) ───────────────────────────────────────────

  /** What the church's server takes now (U19); null when not connected. */
  mediaOffer(): MediaOffer | null {
    return this.connected ? mediaOffer(this.status_.server) : null;
  }

  /**
   * Queues files for uploading, after asking the server what it takes, so a limit changed
   * since this computer last asked is the one used (U2). Returns the files Worship Q cannot
   * show, which are left out.
   */
  async addMedia(paths: readonly string[], target: UploadTarget): Promise<string[]> {
    await this.recheckProtocol().catch(() => undefined);
    return this.uploads.add(paths, target).refused;
  }

  /** The dependencies of the upload queue, on this computer and its church server. */
  private uploadDeps(): UploadDeps {
    return {
      newId: () => crypto.randomUUID(),
      platform: /Mac/.test(navigator.userAgent)
        ? 'macos'
        : /Windows/.test(navigator.userAgent)
          ? 'windows'
          : 'other',
      offer: () => this.mediaOffer(),
      credentials: () => {
        const { server, deviceToken } = this.state ?? {};
        return server && deviceToken && this.connected ? { server, token: deviceToken } : null;
      },
      fileSize: native.fileSize,
      convertHeic: native.convertHeic,
      removeConverted: native.removeConverted,
      probeVideo: async (path) => probeVideo(await native.mediaFileUrl(path)),
      upload: ({ server, token }, id, route, source, name, onProgress) =>
        native.uploadMedia(server, token, id, route, source, name, onProgress),
      cancel: async (id) => {
        await native.cancelTransfer(id);
      },
      fetchDeckImages: async ({ server, token }, deck) => {
        for (const page of deck.pages) await native.downloadBackground(server, token, page.image);
        this.output.forgetFiles();
      },
      storeVideo: async (source, file) => {
        await native.storeVideo(source, file);
        this.videos.uploaded(file);
      },
      createSong: (fields) => this.session.createSong(fields),
      saveSong: (id, fields) => this.session.saveSong(id, fields),
      getSong: (id) => this.session.store.getSong(id),
      canEdit: (date) => this.session.canEdit(date),
      addSong: (date, songId, afterItemId) => this.session.addSong(date, songId, afterItemId),
    };
  }

  /** What the video cache needs, on this computer and its church server. */
  private videoCacheDeps(): VideoCacheDeps {
    const key = 'worship-q.videoUploads';
    return {
      today: () => this.session.today(),
      wanted: (from) => this.session.store.videosFrom(this.session.workspace.id, from),
      liveDate: () => this.session.liveDate,
      list: () => native.listVideos(),
      fetch: async (file, onProgress) => {
        const { server, deviceToken } = this.state ?? {};
        if (!server || !deviceToken) throw new Error('not-connected');
        const { path } = await native.videoLocation(file);
        await native.downloadMedia(
          server,
          deviceToken,
          crypto.randomUUID(),
          `/api/v1/files/${file}`,
          path,
          onProgress,
        );
      },
      remove: (file) => native.removeVideo(file),
      connected: () => this.connected,
      uploads: {
        get: () => {
          try {
            return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>;
          } catch {
            return {};
          }
        },
        set: (value) => {
          try {
            localStorage.setItem(key, JSON.stringify(value));
          } catch {
            // Kept for this run only.
          }
        },
      },
    };
  }

  /** Looks at the videos upcoming run sheets need, shortly after the last change. */
  private scheduleVideos(): void {
    window.clearTimeout(this.videoTimer);
    this.videoTimer = window.setTimeout(() => void this.videos.pass().catch(console.error), 1500);
  }

  /**
   * Saves a media item's original file at `destination` (U18): a video from this computer's
   * copy when it has one, otherwise from the church's server.
   */
  async downloadOriginal(
    song: Song,
    destination: string,
    onProgress: (done: number, total: number) => void,
  ): Promise<void> {
    const local = song.video ? await native.videoLocation(song.video.file) : null;
    const source = originalSource(song, local?.exists ? local.path : null);
    if (!source) throw new Error('no-original');
    if ('local' in source) return native.copyFile(source.local, destination);
    const { server, deviceToken } = this.state ?? {};
    if (!server || !deviceToken || !this.connected) throw new Error('not-connected');
    await native.downloadMedia(
      server,
      deviceToken,
      crypto.randomUUID(),
      source.server,
      destination,
      onProgress,
    );
  }

  /**
   * Converts a slide deck's kept original again on the server and saves the new deck as the
   * item's next revision (U4). The processing stage shows meanwhile.
   */
  async reconvert(song: Song): Promise<Song> {
    const { server, deviceToken } = this.state ?? {};
    if (!server || !deviceToken || !this.connected) throw new Error('not-connected');
    const response = await fetch(
      `${server}/api/v1/decks/${deckIdOf(song)}/reconvert?name=${encodeURIComponent(song.deck?.source ?? '')}`,
      {
        method: 'POST',
        headers: {
          [PROTOCOL_HEADER]: String(this.protocolVersion),
          authorization: `Bearer ${deviceToken}`,
        },
      },
    );
    if (response.status === 404) throw new Error('no-original');
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `server answered ${response.status}`);
    }
    const deck = DeckSchema.parse(await response.json());
    for (const page of deck.pages) await native.downloadBackground(server, deviceToken, page.image);
    this.output.forgetFiles();
    return this.session.saveSong(song.id, { deck, lyrics: deckLyrics(deck) });
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
      obs: this.obsSupported(),
      // Video items in snapshots (protocol version 5, U21).
      videos: true,
      // Passage items in snapshots (protocol version 6).
      passages: true,
      // Live audio messages (protocol version 7).
      audio: this.audioSupported(),
    };
  }

  // ── The shared live state ────────────────────────────────────────────────

  private async startLive(): Promise<void> {
    this.obsReporter?.stop();
    this.obsReporter = new ObsReporter({
      state: () => this.obs.ownState(),
      snapshot: () => this.obs.takeSnapshot(),
      subscribe: this.obs.subscribe,
      transitionEnded: (listener) => this.obs.onTransitionEnded(listener),
      put: (state, snapshot) =>
        this.call('PUT', '/api/v1/obs', { state, snapshot }).then(() => undefined),
    });
    this.audioReporter?.stop();
    this.audioReporter = new AudioReporter({
      state: () => this.audio.ownState(),
      subscribe: this.audio.subscribe,
      put: (state: AudioState) =>
        this.audioSupported()
          ? this.call('PUT', '/api/v1/audio', { state }).then(() => undefined)
          : Promise.resolve(),
    });
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
      protocolVersion: this.protocolVersion,
      token: this.state?.deviceToken ?? '',
      capabilities: this.capabilities(),
      role: this.session.isViewer ? 'viewer' : 'operator',
      lan: this.lan
        ? { fingerprint: this.lan.fingerprint, addresses: this.lan.addresses, port: this.lan.port }
        : null,
      live: this.link?.presence() ?? null,
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
        } else if (message.type === 'claim') {
          // Only the church server decides who coordinates (D14), whatever carries the live
          // state: a claim sent over the LAN would reach the coordinator's own room, not the
          // server. Nothing to claim from while offline.
          if (!this.offlineCoordinator) this.transports?.sendOn('relay', message);
        } else if (message.type === 'presence') {
          // For the server's decisions too; the hello says it again on the next connection.
          this.transports?.sendOn('relay', message);
        } else {
          this.transports?.send(message);
        }
      },
      backup,
      obs: this.obs,
      obsSupported: () => this.obsSupported(),
      audio: this.audio,
      audioSupported: () => this.audioSupported(),
      // An administrator's signals reach the broadcaster through the church server only.
      sendToServer: (message) => this.transports?.sendOn('relay', message),
      grantsRegistered: {
        get: async () => (await this.syncStore.getState()).grantsRegisteredAt !== null,
        set: async () => {
          await this.syncStore.setState({ grantsRegisteredAt: new Date().toISOString() });
        },
      },
      revisions: {
        get: async () => (await this.syncStore.getState()).revisionCeiling ?? 0,
        reserve: async (ceiling) => {
          await this.syncStore.setState({ revisionCeiling: ceiling });
        },
      },
    });
    let lastRole: LiveStatus['role'] | null = null;
    let lastCoordinator: string | null = null;
    link.subscribe(() => {
      const status = link.status;
      this.update({ live: status });
      const roleChanged = status.role !== lastRole;
      if (roleChanged) {
        lastRole = status.role;
        void this.lanHost?.setCoordinating(status.role === 'coordinator');
      }
      if (roleChanged || status.coordinatorId !== lastCoordinator) {
        lastCoordinator = status.coordinatorId;
        // A connection to another coordinator on the LAN would carry its live state here,
        // and this device's commands to it, while the server says otherwise (D14, D21).
        this.lanTransport?.follow(status.coordinatorId, status.role === 'coordinator');
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
          // Back online after presenting alone. The hello said so, and the server has
          // settled the role already: back to this device, or to an older live state (D14).
          this.offlineCoordinator = false;
          this.transports?.opened(kind);
          void this.recheckProtocol();
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
            // Church settings may have changed what the server offers, such as its Bible.
            void this.recheckProtocol().catch(() => undefined);
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

  /** Connects again with a fresh hello, also after the server refused the last one (D26). */
  reconnect(): void {
    if (this.stopped) return;
    window.clearTimeout(this.timer);
    if (this.socket) this.socket.close();
    else this.connect();
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
    const openedAt = Date.now();
    let lastMessageAt = openedAt;
    const heartbeat = window.setInterval(() => {
      const now = Date.now();
      // A late timer means the computer slept for long enough to be dropped.
      const slept = now - ticked > RELAY_PING_MS * 2;
      ticked = now;
      if (slept || !answered) {
        console.warn('[relay] Gave up on the connection', {
          cause: slept ? 'slept' : 'unanswered ping',
          openForMs: now - openedAt,
          sinceLastMessageMs: now - lastMessageAt,
        });
        return lost();
      }
      answered = false;
      this.send({ type: 'ping' });
    }, RELAY_PING_MS);
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const message = JSON.parse(String(event.data)) as RelayToDesktop;
      answered = true;
      lastMessageAt = Date.now();
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
    socket.onclose = (event) => {
      console.warn('[relay] Connection closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        afterGivingUp: this.socket !== socket,
        openForMs: Date.now() - openedAt,
        sinceLastMessageMs: Date.now() - lastMessageAt,
      });
      lost();
    };
  }
}
