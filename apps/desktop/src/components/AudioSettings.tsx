import { emitTo } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { AUDIO_OUTPUT_EVENT, OUTPUT_WINDOW } from '../app/output';
import {
  deviceSettings,
  findDevice,
  pickableDevices,
  type AudioDevice,
} from '../app/deviceSettings';
import { t } from '../i18n';

/**
 * Lists this computer's audio devices with their names. Names and usable ids need microphone
 * permission, so it is asked for, and the track stopped at once (M0.3). A computer with no
 * audio input lists none on Windows.
 */
export async function listAudioDevices(): Promise<{
  outputs: AudioDevice[];
  inputs: AudioDevice[];
}> {
  const media = navigator.mediaDevices;
  if (!media) return { outputs: [], inputs: [] };
  try {
    const stream = await media.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // Without permission, or with no input, the list has no names; it is still read.
  }
  const devices = await media.enumerateDevices().catch(() => []);
  return {
    outputs: pickableDevices(devices, 'audiooutput'),
    inputs: pickableDevices(devices, 'audioinput'),
  };
}

/**
 * This computer's audio devices (U24): where video sound plays, and the input for live audio
 * broadcast. **System default** comes first; the choice is kept on this computer only.
 */
export function AudioSettings() {
  const [saved, setSaved] = useState(() => deviceSettings.get());
  const [devices, setDevices] = useState<{ outputs: AudioDevice[]; inputs: AudioDevice[] } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void listAudioDevices().then((listed) => active && setDevices(listed));
    return () => {
      active = false;
    };
  }, []);

  const choose = (key: 'audioOutput' | 'audioInput', device: AudioDevice | null) => {
    setSaved(deviceSettings.set({ [key]: device }));
    // An open slideshow switches at once, even mid-video; a storage event between windows
    // is not delivered reliably.
    if (key === 'audioOutput')
      void emitTo(OUTPUT_WINDOW, AUDIO_OUTPUT_EVENT).catch(() => undefined);
  };

  const picker = (
    key: 'audioOutput' | 'audioInput',
    label: string,
    available: AudioDevice[] | undefined,
  ) => {
    const chosen = saved[key];
    const found = available ? findDevice(available, chosen) : chosen;
    const missing = !!chosen && !!available && !found;
    return (
      <label className="block">
        <span className="label">{label}</span>
        <select
          className="field"
          value={found?.id ?? (missing ? 'missing' : '')}
          onChange={(event) => {
            const id = event.target.value;
            if (id === 'missing') return;
            choose(key, available?.find((device) => device.id === id) ?? null);
          }}
        >
          <option value="">{t('audio.systemDefault')}</option>
          {missing && <option value="missing">{chosen.name || chosen.id}</option>}
          {available?.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name || t('audio.unnamed')}
            </option>
          ))}
        </select>
        {missing && (
          <span className="mt-1 block text-xs text-amber-300">
            {t('audio.missing', { name: chosen.name || chosen.id })}
          </span>
        )}
      </label>
    );
  };

  return (
    <div className="space-y-3">
      {picker('audioOutput', t('audio.output'), devices?.outputs)}
      {picker('audioInput', t('audio.input'), devices?.inputs)}
      {devices && devices.outputs.length === 0 && (
        <p className="text-xs text-slate-400">{t('audio.noDevices')}</p>
      )}
    </div>
  );
}
