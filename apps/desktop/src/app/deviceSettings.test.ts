import { describe, expect, it } from 'vitest';
import { createDeviceSettings } from './deviceSettings';

describe('device settings (M3.1)', () => {
  it('keeps viewer mode across a restart, in storage outside the workspace database', () => {
    const disk = new Map<string, string>();
    const storage = {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
    };
    const first = createDeviceSettings(() => storage);
    expect(first.get().viewerMode).toBe(false);
    first.set({ viewerMode: true });
    // The app reopens: a new instance reads the same storage.
    const second = createDeviceSettings(() => storage);
    expect(second.get().viewerMode).toBe(true);
  });

  it('falls back to an operator device when storage is missing or damaged', () => {
    expect(createDeviceSettings(() => null).get()).toEqual({ viewerMode: false });
    const broken = { getItem: () => '{not json', setItem: () => undefined };
    expect(createDeviceSettings(() => broken).get()).toEqual({ viewerMode: false });
  });
});
