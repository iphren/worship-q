/**
 * The level meter's arithmetic (task breakdown M2.4): the level of a block of samples, and a
 * peak held for a second by elapsed time, so a window whose animation frames slow down shows
 * the same thing, only less often.
 */

/** How long a peak stays before it falls back to the level. */
export const PEAK_HOLD_MS = 1000;
/** The quietest level shown, in dBFS; anything quieter reads as silence. */
export const METER_FLOOR_DB = -60;

/** The peak of a block of samples in dBFS, at least the floor. */
export function peakDb(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i]!);
    if (value > peak) peak = value;
  }
  if (peak <= 0) return METER_FLOOR_DB;
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(peak));
}

/** A level in dBFS as a share of the meter, 0 to 1. */
export function meterFraction(db: number): number {
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

/** Holds the highest level for a second of elapsed time. */
export class PeakHold {
  private peak = METER_FLOOR_DB;
  private peakAt = -Infinity;

  /** A new reading; returns the level and the peak to show. */
  push(levelDb: number, now: number): { level: number; peak: number } {
    if (levelDb >= this.peak || now - this.peakAt > PEAK_HOLD_MS) {
      this.peak = levelDb;
      this.peakAt = now;
    }
    return { level: levelDb, peak: this.peak };
  }
}

/** A peak this close to full scale is shown as clipping. */
export const CLIP_DB = -1;
