/**
 * The live audio switch on this computer (live audio plan A12, A15; task breakdown M2.1):
 * per workspace, in this computer's storage beside the OBS link, never in the workspace's
 * synchronized settings. The input stays in `deviceSettings.audioInput`, as it belongs to the
 * computer rather than to a workspace.
 */
import { stampActivation } from '@worship-q/live-state';
import type { SettingsStorage } from './deviceSettings';

export interface AudioSwitch {
  /** Broadcast this computer's input whenever the workspace is open (A15). */
  broadcast: boolean;
  /** When it was last switched on; the later activation wins (A3). Null before ever. */
  activatedAt: string | null;
}

export const DEFAULT_AUDIO_SWITCH: AudioSwitch = { broadcast: false, activatedAt: null };

export interface AudioSwitchStore {
  get(): AudioSwitch;
  set(value: AudioSwitch): void;
}

/** A stored entry as read: anything damaged or missing reads as off. */
export function readAudioSwitch(value: unknown): AudioSwitch {
  const entry = value as Partial<AudioSwitch> | null | undefined;
  const activatedAt =
    typeof entry?.activatedAt === 'string' && !Number.isNaN(Date.parse(entry.activatedAt))
      ? entry.activatedAt
      : null;
  return { broadcast: entry?.broadcast === true && activatedAt !== null, activatedAt };
}

export function audioSwitchStore(
  storage: () => SettingsStorage | null,
  workspaceKey: string,
): AudioSwitchStore {
  const key = `wq.audio.${workspaceKey}`;
  let memory: AudioSwitch | null = null;
  return {
    get() {
      if (memory) return memory;
      try {
        const raw = storage()?.getItem(key);
        memory = readAudioSwitch(raw ? JSON.parse(raw) : null);
      } catch {
        memory = { ...DEFAULT_AUDIO_SWITCH };
      }
      return memory;
    },
    set(value) {
      memory = value;
      try {
        storage()?.setItem(key, JSON.stringify(value));
      } catch {
        // Storage unavailable: the switch lasts while the app is open.
      }
    },
  };
}

/**
 * The switch turned on now: stamped with this computer's clock, or a millisecond after the
 * newest activation it has seen when its clock is behind, so a press always wins (§3.1).
 */
export function switchOn(now: number, newestSeen: string | null): AudioSwitch {
  return { broadcast: true, activatedAt: stampActivation(now, newestSeen) };
}
