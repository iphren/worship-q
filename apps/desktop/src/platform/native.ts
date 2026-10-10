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
  openOutput: (monitor: MonitorIdentity) => invoke<void>('open_output', { monitor }),
  closeOutput: () => invoke<void>('close_output'),
  outputIsOpen: () => invoke<boolean>('output_is_open'),
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
  restoreBackup: (source: string, maxSchemaVersion: number) =>
    invoke<void>('restore_backup', { source, maxSchemaVersion }),
};
