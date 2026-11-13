import { describe, expect, it } from 'vitest';
import { meterFraction, PeakHold, peakDb, METER_FLOOR_DB } from './meter';
import { DelayMeter, readStats, type StatsSample } from './stats';

const sample = (patch: Partial<StatsSample>): StatsSample => ({
  at: 0,
  bufferDelay: 0,
  emitted: 0,
  roundTrip: 0.026,
  relayed: false,
  ...patch,
});

describe('the delay figure (M3.6)', () => {
  it('is the buffer over the interval plus half the round trip, rounded to 10 ms', () => {
    const meter = new DelayMeter();
    meter.push('s', sample({ at: 0, bufferDelay: 100, emitted: 1_000_000 }));
    // Two seconds at 48 kHz, the buffer total up by 11,520 s: 120 ms; + 13 → 130.
    const figure = meter.push('s', sample({ at: 2000, bufferDelay: 11620, emitted: 1_096_000 }));
    expect(figure.delayMs).toBe(130);
    expect(figure.bufferMs).toBeCloseTo(120);
  });

  it('keeps the last figure in silence, and marks it old after 5 s', () => {
    const meter = new DelayMeter();
    meter.push('s', sample({ at: 0, bufferDelay: 0, emitted: 0 }));
    meter.push('s', sample({ at: 2000, bufferDelay: 11520, emitted: 96_000 }));
    expect(
      meter.push('s', sample({ at: 4000, bufferDelay: 11520, emitted: 96_000 })),
    ).toMatchObject({ delayMs: 130, stale: false });
    expect(
      meter.push('s', sample({ at: 8000, bufferDelay: 11520, emitted: 96_000 })),
    ).toMatchObject({ delayMs: 130, stale: true });
  });

  it('gives the same figure for readings 2 s and 4 s apart', () => {
    const a = new DelayMeter();
    a.push('s', sample({ at: 0, bufferDelay: 0, emitted: 0 }));
    const two = a.push('s', sample({ at: 2000, bufferDelay: 11520, emitted: 96_000 }));
    const b = new DelayMeter();
    b.push('s', sample({ at: 0, bufferDelay: 0, emitted: 0 }));
    const four = b.push('s', sample({ at: 4000, bufferDelay: 23040, emitted: 192_000 }));
    expect(four.delayMs).toBe(two.delayMs);
  });

  it('uses what there is, with no figure while the buffer is unknown', () => {
    const meter = new DelayMeter();
    meter.push('s', sample({ bufferDelay: null, emitted: null }));
    expect(
      meter.push('s', sample({ at: 2000, bufferDelay: null, emitted: null })).delayMs,
    ).toBeNull();
    const noRtt = new DelayMeter();
    noRtt.push('s', sample({ roundTrip: null }));
    expect(
      noRtt.push('s', sample({ at: 2000, bufferDelay: 11520, emitted: 96_000, roundTrip: null }))
        .delayMs,
    ).toBe(120);
  });

  it('says Relayed or Direct from the selected pair', () => {
    expect(new DelayMeter().push('s', sample({ relayed: true })).path).toBe('relayed');
    expect(new DelayMeter().push('s', sample({ relayed: false })).path).toBe('direct');
  });

  it('starts afresh on a new connection, never mixing the two', () => {
    const meter = new DelayMeter();
    meter.push('old', sample({ at: 0, bufferDelay: 0, emitted: 0 }));
    meter.push('old', sample({ at: 2000, bufferDelay: 40000, emitted: 96_000 }));
    expect(
      meter.push('new', sample({ at: 4000, bufferDelay: 1, emitted: 1000 })).delayMs,
    ).toBeNull();
  });
});

describe('reading the statistics', () => {
  const report = new Map<string, Record<string, unknown>>([
    [
      'in',
      {
        id: 'in',
        type: 'inbound-rtp',
        kind: 'audio',
        jitterBufferDelay: 5,
        jitterBufferEmittedCount: 48000,
      },
    ],
    ['t', { id: 't', type: 'transport', selectedCandidatePairId: 'p' }],
    [
      'p',
      {
        id: 'p',
        type: 'candidate-pair',
        localCandidateId: 'l',
        remoteCandidateId: 'r',
        currentRoundTripTime: 0.02,
      },
    ],
    ['l', { id: 'l', type: 'local-candidate', candidateType: 'host' }],
    ['r', { id: 'r', type: 'remote-candidate', candidateType: 'srflx' }],
  ]);

  it('finds the buffer, the round trip and the path', () => {
    expect(readStats(report, 7)).toEqual({
      at: 7,
      bufferDelay: 5,
      emitted: 48000,
      roundTrip: 0.02,
      relayed: false,
    });
  });

  it('calls a pair with a relay candidate on either side relayed', () => {
    const relayed = new Map(report);
    relayed.set('r', { id: 'r', type: 'remote-candidate', candidateType: 'relay' });
    expect(readStats(relayed, 0).relayed).toBe(true);
  });

  it('reads nothing from nothing', () => {
    expect(readStats(null, 1)).toEqual({
      at: 1,
      bufferDelay: null,
      emitted: null,
      roundTrip: null,
      relayed: null,
    });
  });
});

describe('the level meter (M2.4)', () => {
  it('reads silence, a normal level and clipping apart', () => {
    expect(peakDb(new Float32Array(128))).toBe(METER_FLOOR_DB);
    expect(peakDb(Float32Array.from([0.1, -0.05]))).toBeCloseTo(-20);
    expect(peakDb(Float32Array.from([1, -1]))).toBe(0);
    expect(meterFraction(-60)).toBe(0);
    expect(meterFraction(0)).toBe(1);
  });

  it('holds a peak for a second of elapsed time, however far apart the readings', () => {
    const hold = new PeakHold();
    expect(hold.push(-6, 0).peak).toBe(-6);
    expect(hold.push(-30, 900).peak).toBe(-6);
    // A hidden window: the next reading comes 2 s later, and the peak has gone.
    expect(hold.push(-30, 2900).peak).toBe(-30);
  });
});
