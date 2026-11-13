/**
 * Settings that belong to this computer rather than to a workspace, so they are kept outside
 * the workspace databases: in the web view's storage, which survives restarts and switching
 * workspaces (plan M3.1).
 */

/** An audio device chosen on this computer, kept by its id and its name (U24). */
export interface AudioDevice {
  id: string;
  name: string;
}

export interface DeviceSettings {
  /** A viewer only shows the presentation; it never starts or coordinates one (spec §7). */
  viewerMode: boolean;
  /** Where video items' sound plays; null for the system default (U24). */
  audioOutput: AudioDevice | null;
  /** The source for live audio broadcast; null for the system default. */
  audioInput: AudioDevice | null;
  /** Where **Listen** plays live audio (A11); null for the system default. */
  audioMonitor: AudioDevice | null;
}

const KEY = 'wq.device';
const DEFAULTS: DeviceSettings = {
  viewerMode: false,
  audioOutput: null,
  audioInput: null,
  audioMonitor: null,
};

function audioDevice(value: unknown): AudioDevice | null {
  const device = value as Partial<AudioDevice> | null | undefined;
  return typeof device?.id === 'string' && device.id && typeof device.name === 'string'
    ? { id: device.id, name: device.name }
    : null;
}

/** A media device as the webview lists it. */
export interface ListedDevice {
  deviceId: string;
  label: string;
  kind: string;
}

/**
 * The devices of a kind a picker offers: real devices with an id, without the `default` and
 * `communications` entries, whose labels are localised and which **System default** covers
 * (M0.3).
 */
export function pickableDevices(
  devices: readonly ListedDevice[],
  kind: 'audiooutput' | 'audioinput',
): AudioDevice[] {
  return devices
    .filter(
      (device) =>
        device.kind === kind &&
        device.deviceId !== '' &&
        device.deviceId !== 'default' &&
        device.deviceId !== 'communications',
    )
    .map((device) => ({ id: device.deviceId, name: device.label }));
}

/**
 * The chosen device among those listed now: by its id, else by its name, as ids may change
 * between runs (M0.3). Null when it is not connected, so the system default is used.
 */
export function findDevice(
  available: readonly AudioDevice[],
  chosen: AudioDevice | null,
): AudioDevice | null {
  if (!chosen) return null;
  return (
    available.find((device) => device.id === chosen.id) ??
    available.find((device) => device.name !== '' && device.name === chosen.name) ??
    null
  );
}

/**
 * Whether an input is the computer's own microphone (A16), from its label: it picks up the
 * room rather than the mixer, and on a Mac its sound cuts out when another app starts
 * playing (L2). Settings warns, and never blocks the switch.
 */
export function isBuiltInInput(label: string): boolean {
  const name = label.toLowerCase();
  if (/\busb\b|scarlett|interface|vb-cable|virtual|loopback|blackhole/.test(name)) return false;
  return (
    /macbook (pro|air)? ?microphone|imac microphone|mac (mini|studio) microphone|built-in microphone/.test(
      name,
    ) || /microphone array|internal microphone|built-in mic|integrated microphone/.test(name)
  );
}

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
        return {
          viewerMode: parsed.viewerMode === true,
          audioOutput: audioDevice(parsed.audioOutput),
          audioInput: audioDevice(parsed.audioInput),
          audioMonitor: audioDevice(parsed.audioMonitor),
        };
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

/** The storage key, for windows that follow changes made in another (the slideshow). */
export const DEVICE_SETTINGS_KEY = KEY;

export const deviceSettings = createDeviceSettings(() =>
  typeof localStorage === 'undefined' ? null : localStorage,
);
