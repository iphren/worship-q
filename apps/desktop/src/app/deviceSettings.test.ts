import { describe, expect, it } from 'vitest';
import {
  createDeviceSettings,
  findDevice,
  isBuiltInInput,
  pickableDevices,
} from './deviceSettings';

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
    const defaults = { viewerMode: false, audioOutput: null, audioInput: null, audioMonitor: null };
    expect(createDeviceSettings(() => null).get()).toEqual(defaults);
    const broken = { getItem: () => '{not json', setItem: () => undefined };
    expect(createDeviceSettings(() => broken).get()).toEqual(defaults);
  });
});

describe('audio devices (U24, M6.7)', () => {
  const memory = () => {
    const disk = new Map<string, string>();
    return {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
    };
  };

  it('saves the chosen devices by id and name, and reads them back', () => {
    const storage = memory();
    const settings = createDeviceSettings(() => storage);
    settings.set({
      audioOutput: { id: 'abc', name: 'MacBook Pro Speakers' },
      audioInput: { id: 'mic', name: 'USB Microphone' },
    });
    expect(createDeviceSettings(() => storage).get()).toMatchObject({
      audioOutput: { id: 'abc', name: 'MacBook Pro Speakers' },
      audioInput: { id: 'mic', name: 'USB Microphone' },
      viewerMode: false,
    });
  });

  it('reads a damaged device as the system default', () => {
    const storage = memory();
    storage.setItem('wq.device', JSON.stringify({ audioOutput: { id: 3 }, audioInput: 'x' }));
    expect(createDeviceSettings(() => storage).get()).toMatchObject({
      audioOutput: null,
      audioInput: null,
    });
  });

  it('offers real devices only, without default and communications', () => {
    const listed = [
      { deviceId: 'default', label: 'Default - Speakers', kind: 'audiooutput' },
      { deviceId: 'communications', label: '通信 - Speakers', kind: 'audiooutput' },
      { deviceId: 'h1', label: 'Speakers', kind: 'audiooutput' },
      { deviceId: 'h2', label: 'Microphone', kind: 'audioinput' },
      { deviceId: '', label: '', kind: 'audiooutput' },
    ];
    expect(pickableDevices(listed, 'audiooutput')).toEqual([{ id: 'h1', name: 'Speakers' }]);
    expect(pickableDevices(listed, 'audioinput')).toEqual([{ id: 'h2', name: 'Microphone' }]);
  });

  it('finds the chosen device by id, then by name, else falls back to the default', () => {
    const available = [
      { id: 'new-id', name: 'AirPods' },
      { id: 'spk', name: 'Speakers' },
    ];
    expect(findDevice(available, { id: 'spk', name: 'Renamed' })).toEqual(available[1]);
    expect(findDevice(available, { id: 'old-id', name: 'AirPods' })).toEqual(available[0]);
    expect(findDevice(available, { id: 'gone', name: 'HDMI' })).toBeNull();
    expect(findDevice(available, null)).toBeNull();
  });
});

describe('the Monitor device (A11, M3.4)', () => {
  const storage = (initial: Record<string, string> = {}) => {
    const disk = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
    };
  };

  it('is kept across a restart, by id and name', () => {
    const disk = storage();
    createDeviceSettings(() => disk).set({ audioMonitor: { id: 'hp', name: 'Headphones' } });
    expect(createDeviceSettings(() => disk).get().audioMonitor).toEqual({
      id: 'hp',
      name: 'Headphones',
    });
  });

  it('reads as the system default from a settings file older than the feature', () => {
    const disk = storage({ 'wq.device': JSON.stringify({ viewerMode: false, audioOutput: null }) });
    expect(createDeviceSettings(() => disk).get().audioMonitor).toBeNull();
  });

  it('is found by name when its id changed, and never changes the output device', () => {
    const disk = storage();
    const settings = createDeviceSettings(() => disk);
    settings.set({ audioOutput: { id: 'hall', name: 'Hall' } });
    settings.set({ audioMonitor: { id: 'hp', name: 'Headphones' } });
    expect(settings.get().audioOutput).toEqual({ id: 'hall', name: 'Hall' });
    expect(findDevice([{ id: 'hp-2', name: 'Headphones' }], settings.get().audioMonitor)).toEqual({
      id: 'hp-2',
      name: 'Headphones',
    });
  });
});

describe('the built-in microphone warning (A16, M2.10)', () => {
  it('knows a Mac’s own microphones', () => {
    for (const label of [
      'MacBook Pro Microphone',
      'MacBook Air Microphone',
      'iMac Microphone',
      'Built-in Microphone',
    ]) {
      expect(isBuiltInInput(label), label).toBe(true);
    }
  });

  it('knows a Windows laptop’s own microphones', () => {
    expect(isBuiltInInput('Microphone Array (Realtek(R) Audio)')).toBe(true);
    expect(isBuiltInInput('Internal Microphone')).toBe(true);
  });

  it('does not warn about an interface or a virtual cable', () => {
    for (const label of [
      'AT2020USB+',
      'Scarlett 2i2 USB',
      'VB-Cable',
      'Microphone (USB Audio Device)',
    ]) {
      expect(isBuiltInInput(label), label).toBe(false);
    }
  });
});
