import { describe, expect, it } from 'vitest';
import { presentAction, runPresentAction, slideKeyLabel, type PresentControls } from './shortcuts';

const press = (
  key: string,
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
) => presentAction({ key, metaKey: false, ctrlKey: false, altKey: false, ...modifiers });

const key = (value: string) => ({ key: value, metaKey: false, ctrlKey: false, altKey: false });

describe('presentAction', () => {
  it('steps through the slides of an item with up and down', () => {
    expect(press('ArrowDown')).toBe('slide-next');
    expect(press('ArrowUp')).toBe('slide-previous');
  });

  it('moves between run sheet items with left and right', () => {
    expect(press('ArrowRight')).toBe('item-next');
    expect(press('ArrowLeft')).toBe('item-previous');
  });

  it('hides the lyrics with backspace', () => {
    expect(press('Backspace')).toBe('hide-lyrics');
  });

  it('jumps to a slide of the item with the number row, then the letter rows', () => {
    expect(press('1')).toEqual({ slide: 0 });
    expect(press('0')).toEqual({ slide: 9 });
    expect(press('q')).toEqual({ slide: 10 });
    expect(press('a')).toEqual({ slide: 20 });
    expect(press('m')).toEqual({ slide: 35 });
    expect(press('Q')).toEqual({ slide: 10 });
  });

  it('keeps B for blanking unless the item has that many slides', () => {
    expect(press('b')).toEqual({ slide: 33, otherwise: 'toggle-blank' });
    expect(press('.')).toBe('toggle-blank');
  });

  it('ignores other keys and key combinations', () => {
    expect(press('!')).toBeNull();
    expect(press('Enter')).toBeNull();
    expect(press('1', { ctrlKey: true })).toBeNull();
    expect(press('ArrowDown', { metaKey: true })).toBeNull();
  });
});

describe('slideKeyLabel', () => {
  it('names the key of the first 36 slides only', () => {
    expect(slideKeyLabel(0)).toBe('1');
    expect(slideKeyLabel(10)).toBe('Q');
    expect(slideKeyLabel(35)).toBe('M');
    expect(slideKeyLabel(36)).toBeNull();
  });
});

describe('runPresentAction', () => {
  function controls(slides: number) {
    const calls: string[] = [];
    const session: PresentControls = {
      live: { blank: false },
      stepInItem: async () => true,
      stepItem: async () => true,
      next: async () => true,
      previous: async () => true,
      setBlank: async (blank) => calls.push(`blank:${blank}`),
      playSlide: async (slide) => {
        calls.push(`slide:${slide}`);
        return slide < slides;
      },
    };
    return { session, calls };
  }

  it('blanks with B when the item has no 34th slide', async () => {
    const { session, calls } = controls(5);
    runPresentAction(session, presentAction(key('b'))!);
    await Promise.resolve();
    expect(calls).toEqual(['slide:33', 'blank:true']);
  });

  it('jumps with B when the item has a 34th slide', async () => {
    const { session, calls } = controls(36);
    runPresentAction(session, presentAction(key('b'))!);
    await Promise.resolve();
    expect(calls).toEqual(['slide:33']);
  });
});
