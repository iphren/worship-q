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
  /** Shows a web page over the whole slideshow, or takes it away when null. */
  outputWebsite: (url: string | null) => invoke<void>('output_website', { url }),
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
  /** Has the church instance convert a slide deck; returns the converted deck as JSON. */
  importDeck: (server: string, token: string, source: string) =>
    invoke<string>('import_deck', { server, token, source }),
  /** Makes a backup and sends it to the church instance. */
  uploadBackup: (server: string, token: string) => invoke<void>('upload_backup', { server, token }),
  /** Saves a backup in the app's data folder; returns its path. */
  backupBeforeJoin: () => invoke<string>('backup_before_join'),
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
};

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
