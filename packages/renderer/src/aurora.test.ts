import { describe, expect, it } from 'vitest';
import { AURORA_PERIOD_MS, auroraLights, auroraPhase } from './aurora';

describe('the built-in Default background', () => {
  it('ends each period exactly where it began, so it never jumps', () => {
    const start = auroraLights(0);
    const end = auroraLights(1 - 1e-9);
    end.forEach((light, i) => {
      expect(light.x).toBeCloseTo(start[i]!.x, 4);
      expect(light.y).toBeCloseTo(start[i]!.y, 4);
      expect(light.sx).toBeCloseTo(start[i]!.sx, 4);
      expect(light.angle).toBeCloseTo(start[i]!.angle, 6);
      expect(light.alpha).toBeCloseTo(start[i]!.alpha, 6);
    });
  });

  it('moves gently, and keeps every light faint', () => {
    // One thirtieth of a second apart, nothing moves more than a pixel of a 1080p screen.
    const step = 1 / 30 / (AURORA_PERIOD_MS / 1000);
    for (let p = 0; p < 1; p += 0.01) {
      const a = auroraLights(p);
      const b = auroraLights(p + step);
      a.forEach((light, i) => {
        expect(Math.hypot(light.x - b[i]!.x, light.y - b[i]!.y)).toBeLessThan(1);
        expect(light.alpha).toBeLessThan(0.3);
      });
    }
  });

  it('takes its moment from the clock, so every screen shows the same', () => {
    expect(auroraPhase(0)).toBe(0);
    expect(auroraPhase(AURORA_PERIOD_MS * 7 + AURORA_PERIOD_MS / 4)).toBeCloseTo(0.25);
  });
});
