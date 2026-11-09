import { describe, expect, it } from 'vitest';
import { EDGE_SPEED, EDGE_ZONE, edgeScrollStep } from './edgeScroll';

const box = { top: 100, bottom: 500, left: 0, right: 300 };

describe('scrolling a list while dragging near its edges', () => {
  it('does not scroll in the middle', () => {
    expect(edgeScrollStep(box, { x: 150, y: 300 })).toBe(0);
  });

  it('scrolls up near the top and down near the bottom', () => {
    expect(edgeScrollStep(box, { x: 150, y: 110 })).toBeLessThan(0);
    expect(edgeScrollStep(box, { x: 150, y: 490 })).toBeGreaterThan(0);
  });

  it('scrolls faster closer to the edge, at full speed on and just past it', () => {
    const near = edgeScrollStep(box, { x: 150, y: 500 - EDGE_ZONE + 5 });
    const nearer = edgeScrollStep(box, { x: 150, y: 495 });
    expect(nearer).toBeGreaterThan(near);
    expect(edgeScrollStep(box, { x: 150, y: 500 })).toBe(EDGE_SPEED);
    expect(edgeScrollStep(box, { x: 150, y: 520 })).toBe(EDGE_SPEED);
    expect(edgeScrollStep(box, { x: 150, y: 100 })).toBe(-EDGE_SPEED);
  });

  it('does not scroll beside the list or far beyond it', () => {
    expect(edgeScrollStep(box, { x: 400, y: 490 })).toBe(0);
    expect(edgeScrollStep(box, { x: 150, y: 500 + EDGE_ZONE + 1 })).toBe(0);
    expect(edgeScrollStep(box, { x: 150, y: 100 - EDGE_ZONE - 1 })).toBe(0);
  });

  it('splits a short list between its two zones', () => {
    const short = { top: 100, bottom: 140, left: 0, right: 300 };
    expect(edgeScrollStep(short, { x: 150, y: 110 })).toBeLessThan(0);
    expect(edgeScrollStep(short, { x: 150, y: 130 })).toBeGreaterThan(0);
  });
});
