/**
 * Settings that belong to this computer rather than to a workspace, so they are kept outside
 * the workspace databases: in the web view's storage, which survives restarts and switching
 * workspaces (plan M3.1).
 */

export interface DeviceSettings {
  /** A viewer only shows the presentation; it never starts or coordinates one (spec §7). */
  viewerMode: boolean;
}

const KEY = 'wq.device';
const DEFAULTS: DeviceSettings = { viewerMode: false };

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createDeviceSettings(storage: () => SettingsStorage | null) {
  return {
    get(): DeviceSettings {
      try {
        const raw = storage()?.getItem(KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<DeviceSettings>) : {};
        return { ...DEFAULTS, viewerMode: parsed.viewerMode === true };
      } catch {
        return { ...DEFAULTS };
      }
    },
    set(patch: Partial<DeviceSettings>): DeviceSettings {
      const next = { ...this.get(), ...patch };
      try {
        storage()?.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: the setting lasts while the app is open.
      }
      return next;
    },
  };
}

export const deviceSettings = createDeviceSettings(() =>
  typeof localStorage === 'undefined' ? null : localStorage,
);
