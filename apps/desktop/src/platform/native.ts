/** Everything the interface asks of the native core. */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { MonitorIdentity } from '@worship-q/protocol';
import type { SqlDriver, SqlValue, Statement } from '@worship-q/store';

export const tauriDriver: SqlDriver = {
  select: <Row>(sql: string, params: SqlValue[] = []) =>
    invoke<Row[]>('db_select', { sql, params }),
  batch: (statements: Statement[]) => invoke<void>('db_batch', { statements }),
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
  /** Makes a backup and sends it to the church instance. */
  uploadBackup: (server: string, token: string) => invoke<void>('upload_backup', { server, token }),
  /** Saves a backup in the app's data folder; returns its path. */
  backupBeforeJoin: () => invoke<string>('backup_before_join'),
  /** Makes `frame` what the subtitle overlay page shows. */
  publishOverlay: (frame: unknown) =>
    invoke<void>('overlay_publish', { frame: JSON.stringify(frame) }),
  /** The overlay page's address, and why it is unavailable if it is. */
  overlayStatus: () => invoke<[string, string | null]>('overlay_status'),
  restoreBackup: (source: string, maxSchemaVersion: number) =>
    invoke<void>('restore_backup', { source, maxSchemaVersion }),
};
