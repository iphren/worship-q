import { describe, expect, it } from 'vitest';
import {
  columnsFit,
  layoutKeysMismatch,
  presentLayoutFor,
  scrollToCentre,
  scrollToNearest,
  scrollToStart,
} from './presentLayout';

describe('the layout shown', () => {
  it('fits 16rem columns with 12 px gaps', () => {
    expect(columnsFit(0)).toBe(0);
    expect(columnsFit(256)).toBe(1);
    expect(columnsFit(791)).toBe(2);
    expect(columnsFit(792)).toBe(3);
    expect(columnsFit(1800)).toBe(6);
  });

  it('shows columns only from two wide, with no gap or overlap at the switch', () => {
    expect(columnsFit(523)).toBe(1);
    expect(columnsFit(524)).toBe(2);
    expect(presentLayoutFor(523, 'horizontal')).toBe('vertical');
    expect(presentLayoutFor(524, 'horizontal')).toBe('horizontal');
    expect(presentLayoutFor(0, 'horizontal')).toBe('vertical');
  });

  it('always stacks the items when that is chosen', () => {
    expect(presentLayoutFor(2400, 'vertical')).toBe('vertical');
  });
});

describe('arrow keys against the layout', () => {
  it('matches columns with the default keys, the defaults, and a stack with swapped keys', () => {
    expect(layoutKeysMismatch('horizontal', false)).toBeNull();
    expect(layoutKeysMismatch('vertical', true)).toBeNull();
  });

  it('says how the other two go against it', () => {
    expect(layoutKeysMismatch('vertical', false)).toBe('vertical-default');
    expect(layoutKeysMismatch('horizontal', true)).toBe('horizontal-swapped');
  });
});

describe('scrolling', () => {
  // A container from 100 to 500 on the page, scrolled 200 of at most 1000.
  const container = { start: 100, end: 500, scroll: 200, max: 1000 };

  it('brings an element to the start, on either side of it', () => {
    expect(scrollToStart(container, { start: 350, end: 450 })).toBe(450);
    expect(scrollToStart(container, { start: 50, end: 150 })).toBe(150);
    expect(scrollToStart(container, { start: 100, end: 200 })).toBe(200);
  });

  it('stays put when the element to keep would leave the far end', () => {
    expect(scrollToStart(container, { start: 300, end: 350 }, { start: 600, end: 750 })).toBeNull();
    expect(scrollToStart(container, { start: 300, end: 350 }, { start: 600, end: 700 })).toBe(400);
  });

  it('stops at either end of what can scroll', () => {
    expect(scrollToStart(container, { start: 1500, end: 1600 })).toBe(1000);
    expect(scrollToStart(container, { start: -500, end: -400 })).toBe(0);
  });

  it('moves as little as it can to bring an element into view', () => {
    expect(scrollToNearest(container, { start: 200, end: 300 })).toBe(200);
    expect(scrollToNearest(container, { start: 450, end: 550 })).toBe(250);
    expect(scrollToNearest(container, { start: 50, end: 150 })).toBe(150);
    // Longer than the container: its start shows.
    expect(scrollToNearest(container, { start: 300, end: 900 })).toBe(400);
  });

  it('centres an element as far as it can scroll', () => {
    expect(scrollToCentre(container, { start: 700, end: 800 })).toBe(650);
    expect(scrollToCentre(container, { start: 0, end: 100 })).toBe(0);
    expect(scrollToCentre(container, { start: 1900, end: 2000 })).toBe(1000);
  });
});
