import { describe, expect, it } from 'vitest';
import { isSaveShortcut } from './saveShortcut';

const press = (
  key: string,
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
) => isSaveShortcut({ key, metaKey: false, ctrlKey: false, altKey: false, ...modifiers });

describe('isSaveShortcut', () => {
  it('saves with Command or Control and S', () => {
    expect(press('s', { metaKey: true })).toBe(true);
    expect(press('s', { ctrlKey: true })).toBe(true);
  });

  it('saves with Shift or Caps Lock on', () => {
    expect(press('S', { metaKey: true })).toBe(true);
  });

  it('leaves S alone without a modifier, or with Option', () => {
    expect(press('s')).toBe(false);
    expect(press('s', { metaKey: true, altKey: true })).toBe(false);
    expect(press('d', { metaKey: true })).toBe(false);
  });
});
