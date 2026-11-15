/**
 * The broadcast input's level, read from the local track through Web Audio on animation
 * frames, with the peak held for a second of elapsed time (M2.4). Read only while the
 * component that asks is mounted; the callback writes the reading straight to the page, so
 * a reading does not render React.
 */
import { meterFraction, PeakHold, peakDb, rmsDb, type BrowserTrack } from '@worship-q/audio';
import { useEffect, useRef } from 'react';
import { useApp, useAudio } from '../app/context';

export interface InputLevel {
  /** The average level as a share of the meter, 0 to 1. */
  level: number;
  /** The held peak as a share of the meter, 0 to 1. */
  peak: number;
}

const SILENT: InputLevel = { level: 0, peak: 0 };

/** Calls `show` with each reading, and with silence while there is no capture track. */
export function useInputLevel(show: (reading: InputLevel) => void): void {
  const { cloud } = useApp();
  useAudio();
  const track = (cloud.audio.track as BrowserTrack | null)?.track ?? null;
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    if (!track) {
      showRef.current(SILENT);
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
      const { peak } = hold.push(peakDb(samples), performance.now());
      showRef.current({
        level: meterFraction(rmsDb(samples)),
        peak: meterFraction(peak),
      });
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close().catch(() => undefined);
      showRef.current(SILENT);
    };
  }, [track]);
}
