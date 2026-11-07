import { describe, expect, it } from 'vitest';
import { isSearchShortcut } from './searchShortcut';

const press = (
  key: string,
  target: object | null = { tagName: 'BODY' },
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
) =>
  isSearchShortcut({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: target as EventTarget | null,
    ...modifiers,
  });

describe('isSearchShortcut', () => {
  it('searches with slash', () => {
    expect(press('/')).toBe(true);
    expect(press('/', null)).toBe(true);
  });

  it('leaves other keys and slash with a modifier alone', () => {
    expect(press('s')).toBe(false);
    expect(press('/', undefined, { metaKey: true })).toBe(false);
    expect(press('/', undefined, { ctrlKey: true })).toBe(false);
  });

  it('types slash into a field instead', () => {
    expect(press('/', { tagName: 'INPUT' })).toBe(false);
    expect(press('/', { tagName: 'TEXTAREA' })).toBe(false);
    expect(press('/', { tagName: 'SELECT' })).toBe(false);
    expect(press('/', { tagName: 'DIV', isContentEditable: true })).toBe(false);
  });
});
