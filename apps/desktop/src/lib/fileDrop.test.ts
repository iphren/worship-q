import { describe, expect, it } from 'vitest';
import { dropIndex, pagePoint } from './fileDrop';

const rows = [
  { top: 100, bottom: 130 },
  { top: 134, bottom: 164 },
  { top: 168, bottom: 198 },
];

describe('where dropped files land (M4.4)', () => {
  it('goes before the first row above its middle', () => {
    expect(dropIndex(rows, 50)).toBe(0);
    expect(dropIndex(rows, 114)).toBe(0);
  });

  it('goes between rows, gaps included', () => {
    expect(dropIndex(rows, 116)).toBe(1);
    expect(dropIndex(rows, 132)).toBe(1);
    expect(dropIndex(rows, 160)).toBe(2);
  });

  it('goes last below the last row’s middle, and anywhere below the list', () => {
    expect(dropIndex(rows, 190)).toBe(3);
    expect(dropIndex(rows, 900)).toBe(3);
  });

  it('goes first in an empty run sheet', () => {
    expect(dropIndex([], 400)).toBe(0);
  });

  it('uses the rows where they are on screen, so a scrolled list works the same', () => {
    const scrolled = rows.map((row) => ({ top: row.top - 120, bottom: row.bottom - 120 }));
    expect(dropIndex(scrolled, 20)).toBe(1);
    expect(dropIndex(scrolled, 40)).toBe(2);
  });
});

describe('the drop position (M0.4)', () => {
  it('on macOS is in CSS pixels, less the strip under the title bar, at any scale', () => {
    expect(pagePoint({ x: 546, y: 558 }, 'macos', 2, 32)).toEqual({ x: 546, y: 526 });
    expect(pagePoint({ x: 546, y: 558 }, 'macos', 1, 32)).toEqual({ x: 546, y: 526 });
  });

  it('on Windows is in physical pixels, divided by the scale', () => {
    expect(pagePoint({ x: 208, y: 193 }, 'other', 1.25, 0)).toEqual({ x: 166.4, y: 154.4 });
    expect(pagePoint({ x: 300, y: 150 }, 'other', 1.5, 0)).toEqual({ x: 200, y: 100 });
  });
});
