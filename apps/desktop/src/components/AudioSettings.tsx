import { emitTo } from '@tauri-apps/api/event';
import { CLIP_DB, meterFraction, PeakHold, peakDb, type BrowserTrack } from '@worship-q/audio';
import { useEffect, useRef, useState } from 'react';
import { useApp, useAudio } from '../app/context';
import {
  deviceSettings,
  findDevice,
  isBuiltInInput,
  pickableDevices,
  type AudioDevice,
} from '../app/deviceSettings';
import { AUDIO_OUTPUT_EVENT, OUTPUT_WINDOW } from '../app/output';
import { t } from '../i18n';
import { broadcastAdvice, broadcastStatusText, broadcastTone } from './audioText';

interface ListedAudio {
  outputs: AudioDevice[];
  inputs: AudioDevice[];
  /** What **System default** is for inputs now, as the system names it. */
  defaultInput: string | null;
}

/**
 * Lists this computer's audio devices with their names. Names and usable ids need microphone
 * permission, so it is asked for, and the track stopped at once (M0.3). A computer with no
 * audio input lists none on Windows. Asking in the main window while it listens or
 * broadcasts changes nothing there (L6, W3).
 */
export async function listAudioDevices(): Promise<ListedAudio> {
  const media = navigator.mediaDevices;
  if (!media) return { outputs: [], inputs: [], defaultInput: null };
  try {
    const stream = await media.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // Without permission, or with no input, the list has no names; it is still read.
  }
  const devices = await media.enumerateDevices().catch(() => []);
  const fallback = devices.find((d) => d.kind === 'audioinput' && d.deviceId === 'default');
  const inputs = pickableDevices(devices, 'audioinput');
  return {
    outputs: pickableDevices(devices, 'audiooutput'),
    inputs,
    defaultInput: fallback?.label ?? inputs[0]?.name ?? null,
  };
}

type PickerKey = 'audioOutput' | 'audioInput' | 'audioMonitor';

/**
 * This computer's audio devices (U24, A11): where video sound plays, where **Listen** plays,
 * and the input for live audio with its broadcast switch, level meter and status (M2.9).
 * **System default** comes first; every choice is kept on this computer only.
 */
export function AudioSettings() {
  const { cloud } = useApp();
  const [saved, setSaved] = useState(() => deviceSettings.get());
  const [devices, setDevices] = useState<ListedAudio | null>(null);
  useEffect(() => {
    let active = true;
    const list = () => void listAudioDevices().then((listed) => active && setDevices(listed));
    list();
    navigator.mediaDevices?.addEventListener('devicechange', list);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener('devicechange', list);
    };
  }, []);

  const choose = (key: PickerKey, device: AudioDevice | null) => {
    setSaved(deviceSettings.set({ [key]: device }));
    // An open slideshow switches at once, even mid-video; a storage event between windows
    // is not delivered reliably.
    if (key === 'audioOutput')
      void emitTo(OUTPUT_WINDOW, AUDIO_OUTPUT_EVENT).catch(() => undefined);
    // A broadcast takes the new input, the old one stopped only once it is in place (§3.5).
    if (key === 'audioInput') cloud.audio.inputChosen(device);
    // **Listen** moves to the new device and stays on (M3.5).
    if (key === 'audioMonitor') void cloud.listen?.monitorChanged();
  };

  const picker = (key: PickerKey, label: string, available: AudioDevice[] | undefined) => {
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
        {missing && key !== 'audioInput' && (
          <span className="mt-1 block text-xs text-amber-300">
            {t('audio.missing', { name: chosen.name || chosen.id })}
          </span>
        )}
      </label>
    );
  };

  // The built-in microphone warning (A16), also for what **System default** resolves to.
  const inputLabel = saved.audioInput
    ? ((devices ? findDevice(devices.inputs, saved.audioInput)?.name : null) ??
      saved.audioInput.name)
    : (devices?.defaultInput ?? '');
  const builtIn = !!inputLabel && isBuiltInInput(inputLabel);

  return (
    <div className="space-y-3">
      {picker('audioOutput', t('audio.output'), devices?.outputs)}
      <div>
        {picker('audioMonitor', t('audio.monitor'), devices?.outputs)}
        <p className="mt-1 text-xs text-slate-400">{t('audio.monitorHint')}</p>
      </div>
      <div>
        {picker('audioInput', t('audio.input'), devices?.inputs)}
        {builtIn && <p className="mt-1 text-xs text-amber-300">{t('audio.builtIn')}</p>}
      </div>
      {devices && devices.outputs.length === 0 && (
        <p className="text-xs text-slate-400">{t('audio.noDevices')}</p>
      )}
      <BroadcastSettings />
    </div>
  );
}

const TONE: Record<ReturnType<typeof broadcastTone>, string> = {
  live: 'bg-emerald-400',
  waiting: 'bg-amber-400',
  error: 'bg-red-500',
  off: 'bg-slate-500',
};

/** The broadcast switch, its status with what to do, and the level meter (M2.9). */
function BroadcastSettings() {
  const { cloud } = useApp();
  const shared = useAudio();
  const advice = broadcastAdvice(shared);
  const elsewhere = !shared.local && shared.state ? shared.state.ownerName : null;
  return (
    <div className="space-y-2 border-t border-slate-700 pt-3 text-sm">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={shared.switchOn}
          onChange={(event) => cloud.audio.setSwitch(event.target.checked)}
        />
        <span>
          <span className="block">{t('audio.broadcast')}</span>
          <span className="block text-xs text-slate-400">{t('audio.broadcastHint')}</span>
        </span>
      </label>
      {shared.takenOverBy ? (
        <p className="notice border-sky-600 bg-sky-900/30 text-sky-100">
          {t('audio.takenOver', { name: shared.takenOverBy })}
        </p>
      ) : (
        elsewhere && (
          <p className="text-xs text-slate-400">{t('audio.elsewhere', { name: elsewhere })}</p>
        )
      )}
      {shared.switchOn && (
        <>
          <p className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE[broadcastTone(shared)]}`}
              aria-hidden="true"
            />
            <span>{broadcastStatusText(shared)}</span>
          </p>
          {advice && <p className="text-xs text-slate-400">{advice}</p>}
          {shared.pickFailed && <p className="text-xs text-amber-300">{t('audio.pickFailed')}</p>}
          <LevelMeter />
          {shared.sharingBlocked && (
            <p className="notice border-amber-500 bg-amber-900/30 text-amber-100">
              {t('audio.sharingBlocked')}
            </p>
          )}
          <p className="text-xs text-slate-400">{t('audio.keepAwake')}</p>
        </>
      )}
    </div>
  );
}

/**
 * The input's level, read from the local track through Web Audio on animation frames while
 * Settings is open, with the peak held for a second of elapsed time (M2.4). Nothing is read
 * while Settings is closed.
 */
function LevelMeter() {
  const { cloud } = useApp();
  useAudio();
  const track = (cloud.audio.track as BrowserTrack | null)?.track ?? null;
  const barRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    const peakMark = peakRef.current;
    if (!track || !bar || !peakMark) {
      if (bar) bar.style.width = '0%';
      if (peakMark) peakMark.style.left = '0%';
      return;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const hold = new PeakHold();
    let frame = 0;
    const read = () => {
      analyser.getFloatTimeDomainData(samples);
      const { level, peak } = hold.push(peakDb(samples), performance.now());
      bar.style.width = `${meterFraction(level) * 100}%`;
      peakMark.style.left = `${meterFraction(peak) * 100}%`;
      peakMark.className = `absolute top-0 h-full w-0.5 ${peak >= CLIP_DB ? 'bg-red-500' : 'bg-slate-200'}`;
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close().catch(() => undefined);
    };
  }, [track]);
  return (
    <div>
      <span className="label">{t('audio.level')}</span>
      <div
        className="relative h-2 overflow-hidden rounded bg-slate-800"
        role="meter"
        aria-label={t('audio.level')}
      >
        <div ref={barRef} className="h-full bg-emerald-500" style={{ width: '0%' }} />
        <div
          ref={peakRef}
          className="absolute top-0 h-full w-0.5 bg-slate-200"
          style={{ left: '0%' }}
        />
      </div>
    </div>
  );
}
