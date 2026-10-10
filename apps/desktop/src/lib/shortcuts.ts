/** Keyboard shortcuts for presenting, shared by the operator window and the slideshow window. */

export type PresentAction =
  /** Another slide of the same run sheet item; never moves to another item. */
  | 'slide-next'
  | 'slide-previous'
  | 'item-next'
  | 'item-previous'
  /** The next or previous slide of the whole run sheet, as presenter remotes expect. */
  | 'next'
  | 'previous'
  /** Removes the lyrics and keeps the background. */
  | 'hide-lyrics'
  | 'toggle-blank';

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>;

export function presentAction(event: KeyPress): PresentAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowDown':
      return 'slide-next';
    case 'ArrowUp':
      return 'slide-previous';
    case 'ArrowRight':
      return 'item-next';
    case 'ArrowLeft':
      return 'item-previous';
    case 'PageDown':
    case ' ':
      return 'next';
    case 'PageUp':
      return 'previous';
    case 'Backspace':
      return 'hide-lyrics';
    case 'b':
    case 'B':
    case '.':
      return 'toggle-blank';
    default:
      return null;
  }
}

/** What an action needs of the session; kept narrow so it is easy to test. */
export interface PresentControls {
  readonly live: { blank: boolean } | null;
  stepInItem(by: 1 | -1): Promise<unknown>;
  stepItem(by: 1 | -1): Promise<unknown>;
  next(): Promise<unknown>;
  previous(): Promise<unknown>;
  setBlank(blank: boolean): Promise<unknown>;
}

export function runPresentAction(session: PresentControls, action: PresentAction): void {
  switch (action) {
    case 'slide-next':
      return void session.stepInItem(1);
    case 'slide-previous':
      return void session.stepInItem(-1);
    case 'item-next':
      return void session.stepItem(1);
    case 'item-previous':
      return void session.stepItem(-1);
    case 'next':
      return void session.next();
    case 'previous':
      return void session.previous();
    case 'hide-lyrics':
      return void session.setBlank(true);
    case 'toggle-blank':
      return void session.setBlank(!session.live?.blank);
  }
}
