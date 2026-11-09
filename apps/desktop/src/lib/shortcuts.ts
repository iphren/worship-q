/** Keyboard shortcuts for presenting, shared by the operator window and the slideshow window. */

export type PresentAction =
  /**
   * Another slide of the same run sheet item; never moves to another item. After moving to
   * another item, its first or last slide.
   */
  | 'slide-next'
  | 'slide-previous'
  /** Moves the slide keys to another run sheet item; what is on screen stays. */
  | 'item-next'
  | 'item-previous'
  /** The next or previous slide of the whole run sheet, as presenter remotes expect. */
  | 'next'
  | 'previous'
  /**
   * Shows the lyrics again while blank, otherwise the same as `next`; after moving to another
   * item, presents its first slide.
   */
  | 'unblank-or-next'
  /** Removes the lyrics and keeps the background. */
  | 'hide-lyrics'
  | 'toggle-blank'
  /**
   * Hides or shows the lyrics while a slide is on screen; with nothing on screen, the same as
   * `unblank-or-next`, so the key always does something.
   */
  | 'toggle-blank-or-present'
  /** Takes the slide off the screen, staying live. */
  | 'clear'
  /** A slide of the browsed or presented item by its position, counted from zero. */
  | { slide: number }
  /** While a video item is live (M6.5): play or pause it, and jump 10 s back or forward. */
  | 'video-toggle'
  | 'video-back'
  | 'video-forward';

/** How far Up and Down jump through a live video. */
export const VIDEO_JUMP_SECONDS = 10;

/**
 * The keys that jump to a slide of the presented item, in slide order: the number row, then
 * the letter rows. Slides beyond these have no key.
 */
export const SLIDE_KEYS = '1234567890qwertyuiopasdfghjklzxcvbnm';

/** The key that jumps to the slide at this position, as shown to the operator. */
export function slideKeyLabel(slide: number): string | null {
  return SLIDE_KEYS[slide]?.toUpperCase() ?? null;
}

/** A key press as the slideshow window passes it on to the operator window. */
export type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>;

/** Just what `presentAction` reads of a key press, so it can be sent between windows. */
export function keyPress(event: KeyPress): KeyPress {
  const { key, metaKey, ctrlKey, altKey } = event;
  return { key, metaKey, ctrlKey, altKey };
}

/**
 * What the keys do to a live video (M6.5): nothing without one (null); play or pause it while
 * the slide keys are on another item (`live`); and also jump through it while they are on the
 * video item (`keyed`).
 */
export type VideoKeys = 'keyed' | 'live' | null;

/**
 * The action of a key. Up and Down move within the keyed item and Left and Right between
 * items; Space hides or shows the lyrics and Enter moves on through the whole run sheet. While
 * a video item is live, Space plays or pauses it instead, wherever the slide keys are; while
 * the slide keys are on it, Up and Down jump back and forward through it (U21, M6.5). Every
 * other key does what it does otherwise.
 */
export function presentAction(
  event: KeyPress,
  context: { video?: VideoKeys } = {},
): PresentAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (context.video && event.key === ' ') return 'video-toggle';
  if (context.video === 'keyed') {
    switch (event.key) {
      case 'ArrowUp':
        return 'video-back';
      case 'ArrowDown':
        return 'video-forward';
    }
  }
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
      return 'next';
    case 'Enter':
      return 'unblank-or-next';
    case ' ':
      return 'toggle-blank-or-present';
    case 'PageUp':
      return 'previous';
    case 'Backspace':
      return 'hide-lyrics';
    case '.':
      return 'toggle-blank';
    case 'Delete':
      return 'clear';
  }
  const key = event.key.toLowerCase();
  const slide = key.length === 1 ? SLIDE_KEYS.indexOf(key) : -1;
  return slide < 0 ? null : { slide };
}

/** What an action needs of the session; kept narrow so it is easy to test. */
export interface PresentControls {
  readonly live: { blank: boolean; presented: unknown } | null;
  stepInItem(by: 1 | -1): Promise<unknown>;
  browseItem(by: 1 | -1): Promise<unknown>;
  next(): Promise<unknown>;
  previous(): Promise<unknown>;
  unblankOrNext(): Promise<unknown>;
  setBlank(blank: boolean): Promise<unknown>;
  clear(): Promise<unknown>;
  playSlide(slide: number): Promise<unknown>;
  readonly video: { playing: boolean } | null;
  videoPlay(playing: boolean): Promise<unknown>;
  videoSeek(to: { by: number }): Promise<unknown>;
}

export function runPresentAction(session: PresentControls, action: PresentAction): void {
  if (typeof action === 'object') return void session.playSlide(action.slide);
  switch (action) {
    case 'slide-next':
      return void session.stepInItem(1);
    case 'slide-previous':
      return void session.stepInItem(-1);
    case 'item-next':
      return void session.browseItem(1);
    case 'item-previous':
      return void session.browseItem(-1);
    case 'next':
      return void session.next();
    case 'previous':
      return void session.previous();
    case 'unblank-or-next':
      return void session.unblankOrNext();
    case 'hide-lyrics':
      return void session.setBlank(true);
    case 'toggle-blank':
      return void session.setBlank(!session.live?.blank);
    case 'toggle-blank-or-present':
      return void (session.live?.presented
        ? session.setBlank(!session.live.blank)
        : session.unblankOrNext());
    case 'clear':
      return void session.clear();
    case 'video-toggle':
      return void session.videoPlay(!session.video?.playing);
    case 'video-back':
      return void session.videoSeek({ by: -VIDEO_JUMP_SECONDS });
    case 'video-forward':
      return void session.videoSeek({ by: VIDEO_JUMP_SECONDS });
  }
}

/**
 * What the keys do to a live video (M6.5): `keyed` while the slide keys have not been moved to
 * another item, `live` while they have, null without a live video.
 */
export function videoKeys(session: {
  readonly video: { itemId: string } | null;
  readonly browsedItemId: string | null;
}): VideoKeys {
  const video = session.video;
  if (!video) return null;
  return session.browsedItemId === null || session.browsedItemId === video.itemId
    ? 'keyed'
    : 'live';
}
