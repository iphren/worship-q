import type { MonitorIdentity, OutputTarget } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { decideOutput, findMonitor, sameMonitor } from './monitors';

const laptop: MonitorIdentity = { name: 'Built-in', x: 0, y: 0, width: 2560, height: 1600 };
const projector: MonitorIdentity = { name: 'Projector', x: 2560, y: 0, width: 1920, height: 1080 };
const tv: MonitorIdentity = { name: 'TV', x: 2560, y: 0, width: 3840, height: 2160 };

const target = (monitor: MonitorIdentity, extra: Partial<OutputTarget> = {}): OutputTarget => ({
  monitor,
  enabled: true,
  allowOperatorScreen: false,
  ...extra,
});

describe('findMonitor', () => {
  it('recognises the same monitor', () => {
    expect(findMonitor(projector, [laptop, projector])).toEqual(projector);
    expect(sameMonitor(projector, { ...projector })).toBe(true);
  });

  it('recognises a monitor regardless of its index', () => {
    expect(findMonitor(projector, [projector, laptop])).toEqual(projector);
  });

  it('recognises a monitor after the display arrangement changed', () => {
    const moved = { ...projector, x: -1920 };
    expect(findMonitor(projector, [laptop, moved])).toEqual(moved);
  });

  it('recognises a monitor the system renamed at the same place and size', () => {
    const renamed = { ...projector, name: '\\\\.\\DISPLAY3' };
    expect(findMonitor(projector, [laptop, renamed])).toEqual(renamed);
  });

  it('does not mistake a different monitor for the remembered one', () => {
    expect(findMonitor(projector, [laptop, tv])).toBeNull();
    expect(findMonitor(projector, [laptop])).toBeNull();
  });
});

describe('decideOutput', () => {
  it('asks for a choice when no monitor was ever chosen', () => {
    expect(decideOutput(null, [laptop, projector], laptop)).toEqual({ kind: 'unset' });
  });

  it('opens on the remembered monitor', () => {
    expect(decideOutput(target(projector), [laptop, projector], laptop)).toEqual({
      kind: 'open',
      monitor: projector,
    });
  });

  it('reports a missing monitor instead of picking another screen', () => {
    expect(decideOutput(target(projector), [laptop], laptop)).toEqual({ kind: 'missing' });
    expect(decideOutput(target(projector), [laptop, tv], laptop)).toEqual({ kind: 'missing' });
  });

  it('never presents on the operator’s own screen without being asked', () => {
    // The laptop was the remembered output, e.g. chosen while the app sat on another screen.
    expect(decideOutput(target(laptop), [laptop], laptop)).toEqual({
      kind: 'operator-screen',
      monitor: laptop,
    });
  });

  it('presents on the operator’s screen when that was explicitly asked for', () => {
    expect(decideOutput(target(laptop, { allowOperatorScreen: true }), [laptop], laptop)).toEqual({
      kind: 'open',
      monitor: laptop,
    });
  });

  it('stays closed when the operator closed the slideshow', () => {
    expect(
      decideOutput(target(projector, { enabled: false }), [laptop, projector], laptop),
    ).toEqual({
      kind: 'closed',
    });
  });

  it('opens again when the monitor is plugged back in', () => {
    const saved = target(projector);
    expect(decideOutput(saved, [laptop], laptop).kind).toBe('missing');
    expect(decideOutput(saved, [laptop, projector], laptop).kind).toBe('open');
  });

  it('opens when the operator window’s monitor is unknown', () => {
    expect(decideOutput(target(projector), [projector], null).kind).toBe('open');
  });
});
