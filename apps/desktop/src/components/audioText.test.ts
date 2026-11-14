import { describe, expect, it } from 'vitest';
import type { AudioShared } from '../app/audioShare';
import { prepareMonitor } from '../app/audioListen';
import {
  broadcastAdvice,
  broadcastStatusText,
  broadcastTone,
  delayText,
  listenStatusText,
  recordingNote,
  recordingStatusText,
} from './audioText';

const shared = (patch: Partial<AudioShared>): AudioShared => ({
  state: null,
  local: true,
  switchOn: true,
  input: 'live',
  inputName: 'Scarlett 2i2 USB',
  pickFailed: false,
  takenOverBy: null,
  sharingBlocked: false,
  recording: null,
  ...patch,
});

describe('the broadcast status in words (M2.9)', () => {
  it('says each status, with what to do where there is something to do', () => {
    expect(broadcastStatusText(shared({ switchOn: false }))).toBe('Off');
    expect(broadcastStatusText(shared({}))).toBe('Live');
    expect(broadcastStatusText(shared({ state: { listeners: 3 } as AudioShared['state'] }))).toBe(
      'Live · 3 listening',
    );
    expect(broadcastStatusText(shared({ input: 'waiting' }))).toBe(
      'Waiting for input: Scarlett 2i2 USB',
    );
    expect(broadcastStatusText(shared({ input: 'waiting', inputName: null }))).toBe(
      'Waiting for an audio input',
    );
    expect(broadcastStatusText(shared({ input: 'refused' }))).toBe('The microphone was refused');
    expect(broadcastStatusText(shared({ input: 'hidden' }))).toBe('Bring this window into view');
    expect(broadcastAdvice(shared({ input: 'refused' }))).toMatch(/Privacy/);
    expect(broadcastAdvice(shared({ input: 'hidden' }))).toMatch(/front/);
    expect(broadcastAdvice(shared({}))).toBeNull();
    expect(broadcastTone(shared({ input: 'refused' }))).toBe('error');
    expect(broadcastTone(shared({ input: 'hidden' }))).toBe('waiting');
  });
});

describe('Listen in words (M3.3, M5.4)', () => {
  it('names every state', () => {
    expect(listenStatusText({ kind: 'off' })).toBe('Not listening');
    expect(listenStatusText({ kind: 'playing' })).toBe('Playing');
    expect(listenStatusText({ kind: 'full' })).toMatch(/full/);
    expect(listenStatusText({ kind: 'unreachable', relay: false })).toMatch(/offers no relay/);
    expect(listenStatusText({ kind: 'unreachable', relay: true })).toMatch(/relay was tried/);
  });

  it('shows the delay and the path, and a dash for an unknown buffer', () => {
    expect(delayText({ delayMs: 130, bufferMs: 120, stale: false, path: 'direct' })).toBe(
      '130 ms · Direct',
    );
    expect(delayText({ delayMs: null, bufferMs: null, stale: false, path: null })).toBe('–');
    expect(delayText(null)).toBeNull();
  });
});

describe('the Monitor device on a press (§3.8)', () => {
  it('unlocks, then sets the device found by name, then returns', async () => {
    const order: string[] = [];
    const media = {
      getUserMedia: async () => {
        order.push('unlock');
        return { getTracks: () => [{ stop: () => order.push('stop') }] } as unknown as MediaStream;
      },
      enumerateDevices: async () =>
        [{ kind: 'audiooutput', deviceId: 'hp-2', label: 'Headphones' }] as MediaDeviceInfo[],
    };
    const id = await prepareMonitor(media, { id: 'hp-1', name: 'Headphones' }, async (sink) => {
      order.push(`sink:${sink}`);
    });
    expect(id).toBe('hp-2');
    expect(order).toEqual(['unlock', 'stop', 'sink:hp-2']);
  });

  it('plays on the system default when the device is missing', async () => {
    const sinks: string[] = [];
    const media = {
      getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
      enumerateDevices: async () => [] as MediaDeviceInfo[],
    };
    expect(
      await prepareMonitor(media, { id: 'x', name: 'Gone' }, async (s) => void sinks.push(s)),
    ).toBe('');
    expect(sinks).toEqual(['']);
  });
});

describe('the recording in words (service records M3.5)', () => {
  const recording = (patch: Partial<NonNullable<AudioShared['recording']>> = {}) => ({
    recording: true,
    idle: null,
    waitingBytes: 0,
    dropped: 0,
    churchRecords: true,
    ...patch,
  });

  it('says under the switch that the broadcast is recorded, only while the server records', () => {
    expect(recordingNote(shared({ recording: recording() }))).toMatch(/recorded on the church/);
    expect(recordingNote(shared({ recording: recording({ churchRecords: false }) }))).toBeNull();
    // A server older than recordings: nothing is said.
    expect(recordingNote(shared({ recording: null }))).toBeNull();
  });

  it('says only what is unusual: waiting to upload, dropped, or not recorded and why', () => {
    expect(recordingStatusText(shared({ recording: recording() }))).toBeNull();
    expect(
      recordingStatusText(shared({ recording: recording({ waitingBytes: 4000 }) })),
    ).toBeNull();
    expect(
      recordingStatusText(shared({ recording: recording({ waitingBytes: 3 * 1024 * 1024 }) })),
    ).toBe('3.0 MB of the recording waiting to upload');
    expect(
      recordingStatusText(shared({ recording: recording({ waitingBytes: 42 * 1024 * 1024 }) })),
    ).toBe('42 MB of the recording waiting to upload');
    expect(recordingStatusText(shared({ recording: recording({ dropped: 1 }) }))).toMatch(
      /dropped/,
    );
    expect(recordingStatusText(shared({ recording: recording({ churchRecords: false }) }))).toBe(
      'Not recorded: the church has turned recording off.',
    );
    expect(
      recordingStatusText(
        shared({ recording: recording({ recording: false, idle: 'unsupported' }) }),
      ),
    ).toBe('Not recorded: this computer cannot record audio.');
    expect(recordingStatusText(shared({ switchOn: false, recording: recording() }))).toBeNull();
    expect(recordingStatusText(shared({ recording: null }))).toBeNull();
  });
});
