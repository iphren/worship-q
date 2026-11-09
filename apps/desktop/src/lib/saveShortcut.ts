import { useEffect, useRef, type RefObject } from 'react';

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>;

/** True for ⌘S, or Ctrl+S off a Mac; with Shift or Caps Lock too, but not with Option. */
export function isSaveShortcut(event: KeyPress): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's';
}

/**
 * ⌘S / Ctrl+S saves the form, wherever the focus is: a click on a checkbox or a button
 * leaves it outside the form on a Mac. Only a form that is shown saves, so not the other
 * version of a song, nor a form behind a dialog; the first form shown takes the key.
 */
export function useSaveShortcut(form: RefObject<HTMLFormElement | null>, save: () => void): void {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event) || event.defaultPrevented) return;
      const element = form.current;
      if (!element || element.offsetParent === null) return;
      const dialogs = document.querySelectorAll('[data-dialog]');
      const top = dialogs[dialogs.length - 1];
      if (top && !top.contains(element)) return;
      event.preventDefault();
      saveRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form]);
}
