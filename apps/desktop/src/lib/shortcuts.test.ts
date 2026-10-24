import { describe, expect, it } from 'vitest';
import { presentAction, runPresentAction, slideKeyLabel, type PresentControls } from './shortcuts';

const press = (
  key: string,
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
) => presentAction({ key, metaKey: false, ctrlKey: false, altKey: false, ...modifiers });

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

  it('clears the screen with delete', () => {
    expect(press('Delete')).toBe('clear');
  });

  it('moves through the whole run sheet with page down and up, and space', () => {
    expect(press('PageDown')).toBe('next');
    expect(press('PageUp')).toBe('previous');
    expect(press(' ')).toBe('unblank-or-next');
  });

  it('jumps to a slide of the item with the number row, then the letter rows', () => {
    expect(press('1')).toEqual({ slide: 0 });
    expect(press('0')).toEqual({ slide: 9 });
    expect(press('q')).toEqual({ slide: 10 });
    expect(press('a')).toEqual({ slide: 20 });
    expect(press('m')).toEqual({ slide: 35 });
    expect(press('Q')).toEqual({ slide: 10 });
  });

  it('jumps with B like any other letter', () => {
    expect(press('b')).toEqual({ slide: 33 });
  });

  it('ignores other keys and key combinations', () => {
    expect(press('!')).toBeNull();
    expect(press('Enter')).toBeNull();
    expect(press('1', { ctrlKey: true })).toBeNull();
    expect(press('ArrowDown', { metaKey: true })).toBeNull();
  });
});

describe('runPresentAction', () => {
  const controls = (blank: boolean) => {
    const calls: string[] = [];
    const record = (name: string) => async () => void calls.push(name);
    const session: PresentControls = {
      live: { blank },
      stepInItem: record('stepInItem'),
      browseItem: record('browseItem'),
      next: record('next'),
      previous: record('previous'),
      unblankOrNext: record('unblankOrNext'),
      setBlank: async (value) => void calls.push(`setBlank(${value})`),
      playSlide: record('playSlide'),
      clear: record('clear'),
    };
    return { session, calls };
  };

  it('leaves space to the session, which knows whether to unblank or move on', () => {
    const { session, calls } = controls(true);
    runPresentAction(session, 'unblank-or-next');
    expect(calls).toEqual(['unblankOrNext']);
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
