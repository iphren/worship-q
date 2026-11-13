/** Everything the interface asks of the native core. */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { wellFormed, type MonitorIdentity, type OutputKind } from '@worship-q/protocol';
import type { SqlDriver, SqlValue, Statement } from '@worship-q/store';

// Commands reach Rust as JSON, which rejects text holding half of a surrogate pair.
export const tauriDriver: SqlDriver = {
  select: <Row>(sql: string, params: SqlValue[] = []) =>
    invoke<Row[]>('db_select', { sql, params: wellFormed(params) }),
  batch: (statements: Statement[]) =>
    invoke<void>('db_batch', { statements: wellFormed(statements) }),
};

export const native = {
  listFontFamilies: () => invoke<string[]>('list_font_families'),
  fontMissingChars: (family: string, text: string) =>
    invoke<string>('font_missing_chars', { family, text }),
  /** Opens the slideshow on a monitor: covering it, or as a window when `windowed`. */
  openOutput: (monitor: MonitorIdentity, windowed: boolean) =>
    invoke<void>('open_output', { monitor, windowed }),
  closeOutput: () => invoke<void>('close_output'),
  /** Turns the full-screen slideshow into a window that can be dragged to any screen. */
  windowOutput: () => invoke<void>('window_output'),
  /** The monitor the slideshow window is on right now. */
  outputMonitor: () => invoke<MonitorIdentity | null>('output_monitor'),
  /** Starts moving a windowed slideshow with the mouse; does nothing when it is full screen. */
  dragOutput: () => invoke<void>('drag_output'),
  /**
   * Shows a web page over the whole slideshow, or takes it away when null. `embed` is the
   * address of a YouTube link's video alone, shown instead of the page where it can be.
   */
  outputWebsite: (url: string | null, embed: string | null = null) =>
    invoke<void>('output_website', { url, embed }),
  /** How the slideshow is shown, or null when it is closed. */
  outputMode: () => invoke<'fullscreen' | 'windowed' | null>('output_mode'),
  /** System display names by monitor name; empty where the system has none. */
  monitorLabels: () => invoke<Record<string, string>>('monitor_labels'),
  importBackground: (source: string, fileName: string) =>
    invoke<void>('import_background', { source, fileName }),
  removeBackgroundFile: (fileName: string) => invoke<void>('remove_background_file', { fileName }),
  /** URL the webview can load a stored background from, or null when the file is missing. */
  backgroundUrl: async (fileName: string) => {
    const path = await invoke<string | null>('background_path', { fileName });
    return path ? convertFileSrc(path) : null;
  },
  exportBackup: (destination: string) => invoke<void>('export_backup', { destination }),
  uploadBackground: (server: string, token: string, fileName: string) =>
    invoke<void>('upload_background', { server, token, fileName }),
  downloadBackground: (server: string, token: string, fileName: string) =>
    invoke<void>('download_background', { server, token, fileName }),
  // ── Media (media uploads plan, `src-tauri/src/media.rs`) ──
  /** A chosen file's size in bytes; fails for a folder or a missing file. */
  fileSize: (path: string) => invoke<number>('file_size', { path }),
  /**
   * Sends a file to `/api/v1/<route>`, reporting progress, and returns the server's answer.
   * Fails with a code such as `too-large:<bytes>`, `cancelled` or `refused:<message>`.
   */
  uploadMedia: async (
    server: string,
    token: string,
    uploadId: string,
    route: 'images' | 'videos' | 'decks',
    source: string,
    name: string,
    onProgress: (sent: number, total: number) => void,
  ): Promise<string> => {
    const stop = await onTransfer(uploadId, onProgress);
    try {
      return await invoke<string>('upload_media', { server, token, uploadId, route, source, name });
    } catch (error) {
      throw new Error(String(error), { cause: error });
    } finally {
      stop();
    }
  },
  /** Fetches `path` of the server into `destination`, reporting progress. */
  downloadMedia: async (
    server: string,
    token: string,
    transferId: string,
    path: string,
    destination: string,
    onProgress: (done: number, total: number) => void = () => undefined,
  ): Promise<void> => {
    const stop = await onTransfer(transferId, onProgress);
    try {
      await invoke<void>('download_media', { server, token, transferId, path, destination });
    } catch (error) {
      throw new Error(String(error), { cause: error });
    } finally {
      stop();
    }
  },
  cancelTransfer: (id: string) => invoke<boolean>('cancel_transfer', { id }),
  /** Keeps a copy of an uploaded video in this computer's storage. */
  storeVideo: (source: string, file: string) => invoke<void>('store_video', { source, file }),
  /** Where this computer keeps a video's copy, and whether it is there. */
  videoLocation: (file: string) =>
    invoke<{ path: string; exists: boolean }>('video_location', { file }),
  /** URL the webview can play this computer's copy of a video from, or null without one. */
  videoUrl: async (file: string) => {
    const { path, exists } = await invoke<{ path: string; exists: boolean }>('video_location', {
      file,
    });
    return exists ? convertFileSrc(path) : null;
  },
  listVideos: () => invoke<string[]>('list_videos'),
  removeVideo: (file: string) => invoke<void>('remove_video', { file }),
  copyFile: (source: string, destination: string) =>
    invoke<void>('copy_file', { source, destination }),
  /** A JPEG made from a HEIC photo, on macOS; fails with `unreadable` or `unsupported`. */
  convertHeic: async (source: string) => {
    try {
      return await invoke<string>('convert_heic', { source });
    } catch (error) {
      throw new Error(String(error), { cause: error });
    }
  },
  removeConverted: (path: string) => invoke<void>('remove_converted', { path }),
  /** Applies an audio output to the slideshow window through its own script call (U24). */
  outputAudioSink: (sinkId: string) => invoke<void>('output_audio_sink', { sinkId }),
  /** Moves **Listen**'s element in the main window to the Monitor device (A11, L6). */
  monitorAudioSink: (sinkId: string) => invoke<void>('monitor_audio_sink', { sinkId }),
  /** Holds the display awake while live audio broadcasting is on (M2.5). */
  keepDisplayAwake: (on: boolean) => invoke<void>('keep_display_awake', { on }),
  /** Lets the interface load a chosen file; returns the URL to load it from. */
  mediaFileUrl: async (path: string) => {
    await invoke<void>('allow_media_file', { path });
    return convertFileSrc(path);
  },
  /** Makes a backup and sends it to the church instance. */
  uploadBackup: (server: string, token: string) => invoke<void>('upload_backup', { server, token }),
  /** Saves a backup in the app's data folder; returns its path. */
  backupBeforeJoin: () => invoke<string>('backup_before_join'),
  /** This computer's name as its owner knows it; null when it cannot be found. */
  computerName: () => invoke<string | null>('computer_name'),
  /** Makes `frame` what the subtitle overlay page, or the localhost slideshow page, shows. */
  publishOverlay: (frame: unknown, kind: OutputKind = 'subtitle') =>
    invoke<void>('overlay_publish', { frame: JSON.stringify(frame), kind }),
  /** The overlay page's address, and why it is unavailable if it is. */
  overlayStatus: () => invoke<[string, string | null]>('overlay_status'),
  restoreBackup: (source: string, maxSchemaVersion: number) =>
    invoke<void>('restore_backup', { source, maxSchemaVersion }),
  /** The workspaces kept on this computer. */
  listWorkspaces: () => invoke<WorkspaceEntry[]>('list_workspaces'),
  /** Makes a new, empty workspace and reopens the app in it. */
  addWorkspace: () => invoke<void>('add_workspace'),
  /** Reopens the app in another workspace on this computer. */
  switchWorkspace: (id: string) => invoke<void>('switch_workspace', { id }),
  /** Removes a workspace other than the open one; returns where its backup was saved. */
  removeWorkspace: (id: string) => invoke<string>('remove_workspace', { id }),

  // ── System keychain (decision D23) ─────────────────────────────────────
  keychainSet: (account: string, secret: string) =>
    invoke<void>('keychain_set', { account, secret }),
  keychainGet: (account: string) => invoke<string | null>('keychain_get', { account }),
  keychainDelete: (account: string) => invoke<void>('keychain_delete', { account }),

  // ── The venue network (plan M5) ────────────────────────────────────────
  /** This computer's certificate fingerprint, addresses and port; makes the certificate once. */
  lanStatus: () => invoke<LanStatus>('lan_status'),
  /** Starts accepting connections from the workspace's devices on the LAN port. */
  lanServe: () => invoke<void>('lan_serve'),
  lanStopServing: () => invoke<void>('lan_stop_serving'),
  /** The desktops accepted on the LAN, by the hash of their device token. */
  lanSetCredentials: (credentials: LanCredential[]) =>
    invoke<void>('lan_set_credentials', { credentials }),
  lanSend: (id: string, data: string) => invoke<void>('lan_send', { id, data }),
  lanDrop: (id: string) => invoke<void>('lan_drop', { id }),
  /** Announces this computer as the workspace's coordinator on the LAN, or stops. */
  lanAdvertise: (workspace: string, deviceId: string, name: string, on: boolean) =>
    invoke<void>('lan_advertise', { workspace, deviceId, name, on }),
  /** Looks for the workspace's coordinator on the LAN for a few seconds. */
  lanBrowse: (workspace: string, seconds: number) =>
    invoke<LanFound[]>('lan_browse', { workspace, seconds }),
  /** Connects to a coordinator, checking its certificate fingerprint first. */
  lanConnect: (address: string, port: number, fingerprint: string, token: string, hello: unknown) =>
    invoke<string>('lan_connect', { address, port, fingerprint, token, hello }),
  lanDisconnect: (id: string) => invoke<void>('lan_disconnect', { id }),
  /** Events from LAN connections, accepted or made. */
  onLan: (handlers: {
    open(event: LanOpened): void;
    message(event: { id: string; data: string }): void;
    close(event: { id: string; reason: string | null }): void;
  }): Promise<UnlistenFn> =>
    Promise.all([
      listen<LanOpened>('lan-open', (e) => handlers.open(e.payload)),
      listen<{ id: string; data: string }>('lan-message', (e) => handlers.message(e.payload)),
      listen<{ id: string; reason: string | null }>('lan-close', (e) => handlers.close(e.payload)),
    ]).then((stops) => () => stops.forEach((stop) => stop())),

  // ── OBS (OBS control plan, M1) ─────────────────────────────────────────
  /** Keeps connecting to OBS at `address` until disconnected; replaces any earlier link. */
  obsConnect: (address: string, password: string | null) =>
    invoke<void>('obs_connect', { address, password }),
  obsDisconnect: () => invoke<void>('obs_disconnect'),
  /** One request to OBS; rejects with an `ObsRequestError`. */
  obsRequest: <T>(requestType: string, requestData?: unknown) =>
    invoke<T>('obs_request', { requestType, requestData: requestData ?? null }),
  obsStatus: () => invoke<ObsLinkStatus>('obs_status'),
  /** obs-websocket's own settings on this computer, when readable (decision O12). */
  obsReadConfig: () => invoke<ObsConfigFile | null>('obs_read_config'),
  onObs: (handlers: {
    status(status: ObsLinkStatus): void;
    event(eventType: string, eventData: unknown): void;
  }): Promise<UnlistenFn> =>
    Promise.all([
      listen<ObsLinkStatus>('obs-status', (e) => handlers.status(e.payload)),
      listen<{ eventType: string; eventData: unknown }>('obs-event', (e) =>
        handlers.event(e.payload.eventType, e.payload.eventData),
      ),
    ]).then((stops) => () => stops.forEach((stop) => stop())),
};

/** Reports a transfer's `media-progress` events until the returned function is called. */
function onTransfer(
  id: string,
  report: (done: number, total: number) => void,
): Promise<UnlistenFn> {
  return listen<{ id: string; sent: number; total: number }>('media-progress', (event) => {
    if (event.payload.id === id) report(event.payload.sent, event.payload.total);
  });
}

/** The native OBS link's status (`src-tauri/src/obs.rs`). */
export interface ObsLinkStatus {
  state: 'off' | 'not-running' | 'connecting' | 'connected' | 'refused';
  refusal?: 'authentication' | 'password-required' | 'other';
  message?: string;
  obsVersion?: string;
}

/** A request OBS refused, or one that could not be made: OBS's code, or -1 to -3. */
export interface ObsRequestError {
  code: number;
  comment: string | null;
}

export interface ObsConfigFile {
  serverEnabled: boolean;
  serverPort: number;
  authRequired: boolean;
  serverPassword: string;
}

export interface LanStatus {
  fingerprint: string;
  port: number;
  addresses: string[];
  serving: boolean;
  error: string | null;
}

export interface LanCredential {
  tokenHash: string;
  deviceId: string;
  name: string;
}

export interface LanFound {
  deviceId: string;
  name: string;
  fingerprint: string;
  addresses: string[];
  port: number;
}

export type LanOpened =
  | { kind: 'desktop'; id: string; deviceId: string; name: string; hello: unknown }
  | { kind: 'remote'; id: string; hello: unknown };

export interface WorkspaceEntry {
  id: string;
  /** The workspace open now. */
  active: boolean;
  /** Null until the workspace was first opened. */
  name: string | null;
  /** The church server it is connected to, if any. */
  server: string | null;
}
