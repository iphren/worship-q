/**
 * This computer's OBS link (OBS control plan §3–§4; task breakdown M1.4, M1.5, M5.1): the
 * settings, the connection the native core keeps to OBS on this computer, and OBS's state as
 * read from it. Sharing it with the workspace is `ObsShare`'s.
 *
 * OBS's state is loaded when the connection is made and kept current from OBS's events. A
 * request's answer can arrive after an event that changed the same thing, so each answer is
 * used only if no such event came while it was on its way; and answers from before the
 * connection was last made are never used.
 *
 * Nothing here touches Tauri: the native calls, the settings' storage and the keychain are
 * supplied, so the link can be tested against a fake OBS.
 */
import {
  OBS_ERRORS,
  ObsSnapshotSchema,
  type ObsCommand,
  type ObsConnection,
  type ObsOutput,
  type ObsResult,
  type ObsSnapshot,
  type ObsState,
} from '@worship-q/protocol';
import type { ObsConfigFile, ObsLinkStatus, ObsRequestError } from '../platform/native';
import type { SettingsStorage } from './deviceSettings';

export type { ObsConfigFile, ObsLinkStatus, ObsRequestError } from '../platform/native';

/** The address OBS's WebSocket server has unless changed in OBS. */
export const DEFAULT_OBS_ADDRESS = 'localhost:4455';
/** One image of the program output a second while someone watches (O6, spike M0.2). */
export const SNAPSHOT_EVERY_MS = 1000;
export const SNAPSHOT_WIDTH = 320;
export const SNAPSHOT_QUALITY = 50;

/** obs-websocket's codes for an output already in the state asked for. */
const OUTPUT_RUNNING = 500;
const OUTPUT_NOT_RUNNING = 501;
/** The native core's own codes (`obs.rs`). */
const NOT_CONNECTED = -1;
const TIMED_OUT = -2;

/** What the native core offers (`platform/native.ts`). */
export interface ObsNative {
  connect(address: string, password: string | null): Promise<void>;
  disconnect(): Promise<void>;
  request<T>(requestType: string, requestData?: unknown): Promise<T>;
  readConfig(): Promise<ObsConfigFile | null>;
  listen(handlers: {
    status(status: ObsLinkStatus): void;
    event(eventType: string, eventData: unknown): void;
  }): Promise<() => void>;
}

/** The link's settings, on this computer only (O10). */
export interface ObsSettings {
  address: string;
  /** The link is turned on. */
  active: boolean;
  /** When it was last turned on; the later activation holds the workspace's OBS state (O9). */
  activatedAt: string | null;
  favourites: [string | null, string | null];
}

export const DEFAULT_OBS_SETTINGS: ObsSettings = {
  address: DEFAULT_OBS_ADDRESS,
  active: false,
  activatedAt: null,
  favourites: [null, null],
};

export interface ObsSettingsStore {
  get(): ObsSettings;
  set(settings: ObsSettings): void;
}

/** The OBS password, in the system keychain like the device token (D23). */
export interface ObsSecrets {
  get(): Promise<string | null>;
  set(password: string): Promise<void>;
  delete(): Promise<void>;
}

export type OutputKind = 'stream' | 'record' | 'virtualCam';
const OUTPUT_KINDS: OutputKind[] = ['stream', 'record', 'virtualCam'];

const IDLE: ObsOutput = { active: false, phase: null, durationMs: null, paused: false };

export interface ObsLinkView {
  settings: ObsSettings;
  /** A password is stored for the link. */
  hasPassword: boolean;
  /** The keychain would not give the password back; the link tries without one. */
  passwordUnavailable: boolean;
  /** The native connection's status; `off` while the link is turned off. */
  link: ObsLinkStatus;
  /** OBS's state has been read since the connection was made. */
  ready: boolean;
  /** OBS said it is quitting. */
  closing: boolean;
  /** In the order OBS lists them, top first. */
  scenes: string[];
  currentScene: string | null;
  /** Each output as last measured, at `measuredAt` on this computer's clock. */
  outputs: Record<OutputKind, ObsOutput>;
  measuredAt: Record<OutputKind, number>;
  /** obs-websocket's own settings, when they could be read (O12). */
  config: ObsConfigFile | null;
}

export interface ObsLinkDeps {
  native: ObsNative;
  settings: ObsSettingsStore;
  secrets: ObsSecrets;
  now?: () => number;
  /** Waits; supplied by tests. */
  delay?: (ms: number) => Promise<void>;
}

/** Whether a stored settings object reads as settings; used on load. */
export function readObsSettings(raw: unknown): ObsSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const scene = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  const favourites = Array.isArray(value.favourites) ? value.favourites : [];
  return {
    address:
      typeof value.address === 'string' && value.address.trim()
        ? value.address.trim()
        : DEFAULT_OBS_ADDRESS,
    active: value.active === true,
    activatedAt: typeof value.activatedAt === 'string' ? value.activatedAt : null,
    favourites: [scene(favourites[0]), scene(favourites[1])],
  };
}

/** Settings for one workspace on this computer, kept in the web view's storage. */
export function obsSettingsStore(
  storage: () => SettingsStorage | null,
  workspaceKey: string,
): ObsSettingsStore {
  const key = `wq.obs.${workspaceKey}`;
  let memory: ObsSettings | null = null;
  return {
    get() {
      if (memory) return memory;
      try {
        const raw = storage()?.getItem(key);
        memory = readObsSettings(raw ? JSON.parse(raw) : null);
      } catch {
        memory = { ...DEFAULT_OBS_SETTINGS };
      }
      return memory;
    },
    set(settings) {
      memory = settings;
      try {
        storage()?.setItem(key, JSON.stringify(settings));
      } catch {
        // Storage unavailable: the settings last while the app is open.
      }
    },
  };
}

/** One keychain entry per workspace folder, beside the device token's (D23). */
export function obsKeychainAccount(workspaceFolder: string): string {
  return `${workspaceFolder}:obs-password`;
}

/** The address as `host:port`, as the settings page shows it, from OBS's own port. */
export function addressForPort(port: number): string {
  return `localhost:${port}`;
}

/** An output's state from an `…StateChanged` event (obs-websocket's `outputState`). */
function fromOutputEvent(previous: ObsOutput, data: Record<string, unknown>): ObsOutput {
  const active = data.outputActive === true;
  switch (data.outputState) {
    case 'OBS_WEBSOCKET_OUTPUT_STARTING':
      return { active: false, phase: 'starting', durationMs: null, paused: false };
    case 'OBS_WEBSOCKET_OUTPUT_STARTED':
      return { active: true, phase: null, durationMs: 0, paused: false };
    case 'OBS_WEBSOCKET_OUTPUT_STOPPING':
      return { ...previous, active: true, phase: 'stopping' };
    case 'OBS_WEBSOCKET_OUTPUT_STOPPED':
      return IDLE;
    case 'OBS_WEBSOCKET_OUTPUT_RECONNECTING':
      return { ...previous, active: true, phase: 'reconnecting' };
    case 'OBS_WEBSOCKET_OUTPUT_RECONNECTED':
      return { ...previous, active: true, phase: null };
    case 'OBS_WEBSOCKET_OUTPUT_PAUSED':
      return { ...previous, active: true, paused: true };
    case 'OBS_WEBSOCKET_OUTPUT_RESUMED':
      return { ...previous, active: true, paused: false };
    default:
      return active ? { ...previous, active, phase: null } : IDLE;
  }
}

/** An output's state from `GetStreamStatus`, `GetRecordStatus` or `GetVirtualCamStatus`. */
function fromOutputStatus(data: Record<string, unknown>): ObsOutput {
  const active = data.outputActive === true;
  if (!active) return IDLE;
  return {
    active,
    phase: data.outputReconnecting === true ? 'reconnecting' : null,
    durationMs:
      typeof data.outputDuration === 'number' && data.outputDuration >= 0
        ? Math.round(data.outputDuration)
        : null,
    paused: data.outputPaused === true,
  };
}

/** The scene names of `GetSceneList` or `SceneListChanged`, top of OBS's list first. */
export function sceneNames(scenes: unknown): string[] {
  if (!Array.isArray(scenes)) return [];
  return scenes
    .filter(
      (scene): scene is { sceneName: string; sceneIndex?: number } =>
        !!scene && typeof scene.sceneName === 'string' && scene.sceneName.length > 0,
    )
    .map((scene, position) => ({ name: scene.sceneName, index: scene.sceneIndex ?? position }))
    .sort((a, b) => b.index - a.index)
    .map((scene) => scene.name);
}

const STATUS_REQUESTS: Record<OutputKind, string> = {
  stream: 'GetStreamStatus',
  record: 'GetRecordStatus',
  virtualCam: 'GetVirtualCamStatus',
};

const OUTPUT_EVENTS: Record<string, OutputKind> = {
  StreamStateChanged: 'stream',
  RecordStateChanged: 'record',
  VirtualcamStateChanged: 'virtualCam',
};

/** What each command asks of OBS; each names the state wanted (O3). */
function requestFor(command: ObsCommand): { type: string; data?: unknown; starts?: boolean } {
  switch (command.type) {
    case 'setScene':
      return { type: 'SetCurrentProgramScene', data: { sceneName: command.scene } };
    case 'startStream':
      return { type: 'StartStream', starts: true };
    case 'stopStream':
      return { type: 'StopStream', starts: false };
    case 'startRecord':
      return { type: 'StartRecord', starts: true };
    case 'stopRecord':
      return { type: 'StopRecord', starts: false };
    case 'startVirtualCam':
      return { type: 'StartVirtualCam', starts: true };
    case 'stopVirtualCam':
      return { type: 'StopVirtualCam', starts: false };
  }
}

function requestError(error: unknown): ObsRequestError {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code, comment } = error as { code: unknown; comment?: unknown };
    return {
      code: typeof code === 'number' ? code : 0,
      comment: typeof comment === 'string' ? comment : null,
    };
  }
  return { code: 0, comment: typeof error === 'string' ? error : null };
}

/** The connection as the workspace sees it: Connected only once OBS's state is read. */
export function sharedConnection(view: ObsLinkView): ObsConnection {
  if (view.closing) return 'not-running';
  switch (view.link.state) {
    case 'connected':
      return view.ready ? 'connected' : 'connecting';
    case 'refused':
      return 'refused';
    case 'connecting':
      return 'connecting';
    default:
      return 'not-running';
  }
}

/** The part of the OBS state this link supplies; the share adds who owns it. */
export type ObsLocalState = Omit<ObsState, 'ownerId' | 'ownerName' | 'revision'>;

export class ObsLink {
  private view_: ObsLinkView;
  private readonly listeners = new Set<() => void>();
  private readonly snapshotListeners = new Set<(snapshot: ObsSnapshot) => void>();
  private unlisten: (() => void) | null = null;
  private password: string | null = null;
  /** Counts connections made; answers from an earlier one are dropped. */
  private generation = 0;
  /** Counts events per kind, so an answer overtaken by an event is dropped. */
  private sceneEvents = 0;
  private sceneListEvents = 0;
  private readonly outputEvents: Record<OutputKind, number> = {
    stream: 0,
    record: 0,
    virtualCam: 0,
  };
  private imageFormat: 'webp' | 'jpg' = 'jpg';
  /** OBS is switching scene collection: screenshots wait (spike, rate limits). */
  private collectionChanging = false;
  private watchingHere = false;
  private watchingElsewhere = false;
  private shooting = false;
  private stopped = false;
  private readonly now: () => number;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(private readonly deps: ObsLinkDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.delay = deps.delay ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    const at = this.now();
    this.view_ = {
      settings: deps.settings.get(),
      hasPassword: false,
      passwordUnavailable: false,
      link: { state: 'off' },
      ready: false,
      closing: false,
      scenes: [],
      currentScene: null,
      outputs: { stream: IDLE, record: IDLE, virtualCam: IDLE },
      measuredAt: { stream: at, record: at, virtualCam: at },
      config: null,
    };
  }

  get view(): ObsLinkView {
    return this.view_;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Images of the program output, while someone watches. */
  onSnapshot(listener: (snapshot: ObsSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  private update(patch: Partial<ObsLinkView>): void {
    this.view_ = { ...this.view_, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private saveSettings(patch: Partial<ObsSettings>): ObsSettings {
    const settings = { ...this.view_.settings, ...patch };
    this.deps.settings.set(settings);
    this.update({ settings });
    return settings;
  }

  /** Starts listening, and connects if the link was left on (O7). */
  async start(): Promise<void> {
    this.unlisten = await this.deps.native.listen({
      status: (status) => this.onStatus(status),
      event: (type, data) => this.onEvent(type, data),
    });
    if (this.stopped) return this.unlisten();
    await this.loadPassword();
    void this.refreshConfig();
    if (this.view_.settings.active) await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.unlisten?.();
    this.unlisten = null;
    if (this.view_.settings.active) void this.deps.native.disconnect().catch(() => undefined);
  }

  private async loadPassword(): Promise<void> {
    try {
      this.password = await this.deps.secrets.get();
      this.update({ hasPassword: !!this.password, passwordUnavailable: false });
    } catch {
      this.password = null;
      this.update({ hasPassword: false, passwordUnavailable: true });
    }
  }

  /** Reads obs-websocket's own settings again (O12). */
  async refreshConfig(): Promise<ObsConfigFile | null> {
    const config = await this.deps.native.readConfig().catch(() => null);
    this.update({ config });
    return config;
  }

  // ── Settings (M1.5) ──────────────────────────────────────────────────────

  /**
   * Turns the link on, now: this computer takes the workspace's OBS state from any other
   * (O9). With no password stored, OBS's own is used when it can be read (O12).
   */
  async activate(): Promise<void> {
    const config = this.view_.config ?? (await this.refreshConfig());
    if (config) {
      if (!this.password && config.authRequired && config.serverPassword) {
        await this.setPassword(config.serverPassword, false);
      }
      if (this.view_.settings.address === DEFAULT_OBS_ADDRESS && config.serverPort !== 4455) {
        this.saveSettings({ address: addressForPort(config.serverPort) });
      }
    }
    this.saveSettings({ active: true, activatedAt: new Date(this.now()).toISOString() });
    await this.connect();
  }

  /** Turns the link off: by the operator, or silently when another computer took over (O9). */
  async deactivate(): Promise<void> {
    if (!this.view_.settings.active) return;
    this.saveSettings({ active: false });
    this.generation++;
    this.resetObs();
    this.update({ link: { state: 'off' } });
    await this.deps.native.disconnect().catch(() => undefined);
  }

  async setAddress(address: string): Promise<void> {
    const next = address.trim() || DEFAULT_OBS_ADDRESS;
    if (next === this.view_.settings.address) return;
    this.saveSettings({ address: next });
    if (this.view_.settings.active) await this.connect();
  }

  /** An empty password removes the stored one. */
  async setPassword(password: string, reconnect = true): Promise<void> {
    const value = password.trim() ? password : null;
    try {
      if (value) await this.deps.secrets.set(value);
      else await this.deps.secrets.delete();
      this.update({ passwordUnavailable: false });
    } catch {
      // Kept for this run; Settings says it could not be stored.
      this.update({ passwordUnavailable: true });
    }
    this.password = value;
    this.update({ hasPassword: !!value });
    if (reconnect && this.view_.settings.active) await this.connect();
  }

  setFavourites(favourites: [string | null, string | null]): void {
    this.saveSettings({ favourites });
  }

  /** Port and password from obs-websocket's own settings (O12). */
  async useObsSettings(): Promise<boolean> {
    const config = await this.refreshConfig();
    if (!config) return false;
    this.saveSettings({ address: addressForPort(config.serverPort) });
    await this.setPassword(config.authRequired ? config.serverPassword : '', false);
    if (this.view_.settings.active) await this.connect();
    return true;
  }

  private async connect(): Promise<void> {
    this.generation++;
    this.resetObs();
    this.update({ link: { state: 'connecting' } });
    try {
      await this.deps.native.connect(this.view_.settings.address, this.password);
    } catch (error) {
      this.update({
        link: { state: 'refused', refusal: 'other', message: requestError(error).comment ?? '' },
      });
    }
  }

  /** Forgets what was read from OBS; it is read again on the next connection. */
  private resetObs(): void {
    const at = this.now();
    this.collectionChanging = false;
    this.update({
      ready: false,
      closing: false,
      outputs: { stream: IDLE, record: IDLE, virtualCam: IDLE },
      measuredAt: { stream: at, record: at, virtualCam: at },
    });
  }

  // ── From the native core ─────────────────────────────────────────────────

  private onStatus(status: ObsLinkStatus): void {
    if (!this.view_.settings.active) return;
    const was = this.view_.link.state;
    if (status.state === 'connected') {
      this.generation++;
      this.resetObs();
      this.update({ link: status });
      void this.load(this.generation);
      return;
    }
    if (was === 'connected') this.resetObs();
    this.update({ link: status });
    // OBS not answering may be its server turned off: Settings can say so (O12).
    if (status.state === 'not-running' && was !== 'not-running') void this.refreshConfig();
  }

  private async load(generation: number): Promise<void> {
    const native = this.deps.native;
    const scenesAt = { scene: this.sceneEvents, list: this.sceneListEvents };
    const outputsAt = { ...this.outputEvents };
    const [version, sceneList, ...outputs] = await Promise.allSettled([
      native.request<{ supportedImageFormats?: unknown }>('GetVersion'),
      native.request<{ currentProgramSceneName?: unknown; scenes?: unknown }>('GetSceneList'),
      ...OUTPUT_KINDS.map((kind) => native.request<Record<string, unknown>>(STATUS_REQUESTS[kind])),
    ]);
    if (generation !== this.generation || this.stopped) return;
    if (version.status === 'fulfilled') {
      const formats = version.value?.supportedImageFormats;
      this.imageFormat = Array.isArray(formats) && formats.includes('webp') ? 'webp' : 'jpg';
    }
    const patch: Partial<ObsLinkView> = { ready: true };
    if (sceneList.status === 'fulfilled') {
      if (scenesAt.list === this.sceneListEvents)
        patch.scenes = sceneNames(sceneList.value?.scenes);
      const current = sceneList.value?.currentProgramSceneName;
      if (scenesAt.scene === this.sceneEvents && typeof current === 'string') {
        patch.currentScene = current;
      }
    }
    const at = this.now();
    const nextOutputs = { ...this.view_.outputs };
    const measuredAt = { ...this.view_.measuredAt };
    OUTPUT_KINDS.forEach((kind, index) => {
      const result = outputs[index]!;
      if (result.status !== 'fulfilled' || outputsAt[kind] !== this.outputEvents[kind]) return;
      nextOutputs[kind] = fromOutputStatus(result.value ?? {});
      measuredAt[kind] = at;
    });
    this.update({ ...patch, outputs: nextOutputs, measuredAt });
    this.maybeShoot();
  }

  /** Reads an output's duration again after OBS said its state changed. */
  private async refreshOutput(kind: OutputKind): Promise<void> {
    const generation = this.generation;
    const events = this.outputEvents[kind];
    const result = await this.deps.native
      .request<Record<string, unknown>>(STATUS_REQUESTS[kind])
      .catch(() => null);
    if (!result || generation !== this.generation || events !== this.outputEvents[kind]) return;
    const fresh = fromOutputStatus(result);
    const current = this.view_.outputs[kind];
    // The duration is what was asked for; the state stays as the event set it, unless OBS
    // says the output is not running after all.
    const output = fresh.active
      ? { ...current, durationMs: fresh.durationMs ?? current.durationMs }
      : fresh;
    this.update({
      outputs: { ...this.view_.outputs, [kind]: output },
      measuredAt: { ...this.view_.measuredAt, [kind]: this.now() },
    });
  }

  private async reloadScenes(): Promise<void> {
    const generation = this.generation;
    const at = { scene: this.sceneEvents, list: this.sceneListEvents };
    const list = await this.deps.native
      .request<{ currentProgramSceneName?: unknown; scenes?: unknown }>('GetSceneList')
      .catch(() => null);
    if (!list || generation !== this.generation) return;
    const patch: Partial<ObsLinkView> = {};
    if (at.list === this.sceneListEvents) patch.scenes = sceneNames(list.scenes);
    if (at.scene === this.sceneEvents && typeof list.currentProgramSceneName === 'string') {
      patch.currentScene = list.currentProgramSceneName;
    }
    this.update(patch);
  }

  private onEvent(type: string, raw: unknown): void {
    if (!this.view_.settings.active) return;
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const output = OUTPUT_EVENTS[type];
    if (output) {
      this.outputEvents[output]++;
      const next = fromOutputEvent(this.view_.outputs[output], data);
      this.update({
        outputs: { ...this.view_.outputs, [output]: next },
        measuredAt: { ...this.view_.measuredAt, [output]: this.now() },
      });
      if (next.active && next.phase === null) void this.refreshOutput(output);
      return;
    }
    switch (type) {
      case 'CurrentProgramSceneChanged': {
        this.sceneEvents++;
        const scene = typeof data.sceneName === 'string' ? data.sceneName : null;
        // Sent again for the scene already on program, for example when Studio Mode is
        // turned off (spike M0.3): nothing changed.
        if (scene !== this.view_.currentScene) this.update({ currentScene: scene });
        return;
      }
      case 'SceneListChanged':
        this.sceneListEvents++;
        this.update({ scenes: sceneNames(data.scenes) });
        return;
      case 'SceneNameChanged': {
        const from = typeof data.oldSceneName === 'string' ? data.oldSceneName : null;
        const to = typeof data.sceneName === 'string' ? data.sceneName : null;
        if (!from || !to) return;
        this.sceneListEvents++;
        const rename = (scene: string | null) => (scene === from ? to : scene);
        const [first, second] = this.view_.settings.favourites;
        if (first === from || second === from) {
          // The favourites follow a scene renamed in OBS, so the switch button keeps working.
          this.saveSettings({ favourites: [rename(first), rename(second)] });
        }
        if (this.view_.currentScene === from) this.sceneEvents++;
        this.update({
          scenes: this.view_.scenes.map((scene) => (scene === from ? to : scene)),
          currentScene: rename(this.view_.currentScene),
        });
        return;
      }
      case 'CurrentSceneCollectionChanging':
        this.collectionChanging = true;
        return;
      case 'CurrentSceneCollectionChanged':
        this.collectionChanging = false;
        this.sceneListEvents++;
        this.sceneEvents++;
        void this.reloadScenes();
        return;
      case 'ExitStarted':
        this.update({ closing: true });
        return;
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  /**
   * Asks OBS for a change. Asking for a state an output is already in counts as done, so
   * two operators pressing Start at once both succeed.
   */
  async command(command: ObsCommand): Promise<ObsResult> {
    if (!this.view_.settings.active) return { ok: false, error: OBS_ERRORS.noObs };
    if (this.view_.link.state !== 'connected') {
      return { ok: false, error: OBS_ERRORS.notConnected };
    }
    const request = requestFor(command);
    try {
      await this.deps.native.request(request.type, request.data);
      return { ok: true };
    } catch (raw) {
      const error = requestError(raw);
      if (request.starts === true && error.code === OUTPUT_RUNNING) return { ok: true };
      if (request.starts === false && error.code === OUTPUT_NOT_RUNNING) return { ok: true };
      if (error.code === NOT_CONNECTED) return { ok: false, error: OBS_ERRORS.notConnected };
      if (error.code === TIMED_OUT) return { ok: false, error: OBS_ERRORS.timeout };
      return {
        ok: false,
        code: error.code,
        ...(error.comment ? { error: error.comment.slice(0, 300) } : {}),
      };
    }
  }

  // ── What the workspace is told ───────────────────────────────────────────

  /** Each output now, its duration carried forward from when it was measured. */
  outputsNow(): Record<OutputKind, ObsOutput> {
    const now = this.now();
    const out = {} as Record<OutputKind, ObsOutput>;
    for (const kind of OUTPUT_KINDS) {
      const output = this.view_.outputs[kind];
      out[kind] =
        output.active && output.durationMs !== null && !output.paused
          ? {
              ...output,
              durationMs: output.durationMs + Math.max(0, now - this.view_.measuredAt[kind]),
            }
          : output;
    }
    return out;
  }

  /**
   * What this link tells the workspace; null when it was never turned on. Once turned off it
   * still says so, until another computer's link holds the state.
   */
  localState(): ObsLocalState | null {
    const { settings } = this.view_;
    if (!settings.activatedAt) return null;
    const outputs = this.outputsNow();
    const connected = sharedConnection(this.view_) === 'connected';
    return {
      activatedAt: settings.activatedAt,
      active: settings.active,
      status: settings.active ? sharedConnection(this.view_) : 'not-running',
      scenes: connected ? this.view_.scenes : [],
      currentScene: connected ? this.view_.currentScene : null,
      favourites: settings.favourites,
      stream: connected ? outputs.stream : IDLE,
      record: connected ? outputs.record : IDLE,
      virtualCam: connected ? outputs.virtualCam : IDLE,
    };
  }

  // ── The live monitor (M5.1) ──────────────────────────────────────────────

  /** A panel on this computer shows the monitor. */
  setWatchingHere(watching: boolean): void {
    this.watchingHere = watching;
    this.maybeShoot();
  }

  /** Another device, or a phone, shows the monitor. */
  setWatchingElsewhere(watching: boolean): void {
    this.watchingElsewhere = watching;
    this.maybeShoot();
  }

  get watched(): boolean {
    return this.watchingHere || this.watchingElsewhere;
  }

  private canShoot(): boolean {
    return (
      this.watched &&
      !this.stopped &&
      this.view_.settings.active &&
      this.view_.link.state === 'connected' &&
      this.view_.ready
    );
  }

  /**
   * Takes one image a second while anyone watches and stops when nobody does, so OBS is
   * not asked for screenshots nobody sees. One request at a time, never overlapping.
   */
  private maybeShoot(): void {
    if (this.shooting || !this.canShoot()) return;
    this.shooting = true;
    void (async () => {
      try {
        while (this.canShoot()) {
          await this.shoot();
          await this.delay(SNAPSHOT_EVERY_MS);
        }
      } finally {
        this.shooting = false;
      }
    })();
  }

  private async shoot(): Promise<void> {
    const scene = this.view_.currentScene;
    if (!scene || this.collectionChanging) return;
    const generation = this.generation;
    const format = this.imageFormat;
    try {
      const result = await this.deps.native.request<{ imageData?: unknown }>(
        'GetSourceScreenshot',
        {
          sourceName: scene,
          imageFormat: format,
          imageWidth: SNAPSHOT_WIDTH,
          imageCompressionQuality: SNAPSHOT_QUALITY,
        },
      );
      if (generation !== this.generation || !this.canShoot()) return;
      const snapshot = ObsSnapshotSchema.safeParse({
        image: result?.imageData,
        takenAt: new Date(this.now()).toISOString(),
      });
      if (!snapshot.success) return;
      for (const listener of [...this.snapshotListeners]) listener(snapshot.data);
    } catch (raw) {
      // A format OBS turned down this time is not asked for again.
      if (format === 'webp' && requestError(raw).code > 0) this.imageFormat = 'jpg';
    }
  }
}
