import { useEffect, useRef, type RefObject } from 'react';

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>;

/**
 * True for `/` pressed to search: not while typing in a field, where it is a character, nor
 * with a modifier held.
 */
export function isSearchShortcut(event: KeyPress): boolean {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as Partial<HTMLElement> | null;
  if (target?.isContentEditable) return false;
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
}

/**
 * `/` focuses the page's search field, on the Library, Calendar and Present pages. Nothing
 * happens while a dialog is open or when the page shows no search field. `reveal` shows the
 * field first when it is on a tab that is not shown.
 */
export function useSearchShortcut(
  field: RefObject<HTMLInputElement | null>,
  reveal?: () => void,
): void {
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event) || document.querySelector('[data-dialog]')) return;
      const input = field.current;
      if (!input) return;
      event.preventDefault();
      const focus = () => {
        input.focus();
        input.select();
      };
      // A field on a hidden tab cannot take the focus until the tab is shown.
      if (input.offsetParent !== null) return focus();
      revealRef.current?.();
      requestAnimationFrame(focus);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [field]);
}
