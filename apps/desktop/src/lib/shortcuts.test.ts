import { describe, expect, it } from 'vitest';
import { presentAction } from './shortcuts';

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

  it('ignores other keys and key combinations', () => {
    expect(press('a')).toBeNull();
    expect(press('ArrowDown', { metaKey: true })).toBeNull();
  });
});
