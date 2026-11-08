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
  /** Takes the slide off the screen, staying live. */
  | 'clear'
  /** A slide of the browsed or presented item by its position, counted from zero. */
  | { slide: number }
  /** While a video item is live (M6.5): play or pause it, and jump 10 s back or forward. */
  | 'video-toggle'
  | 'video-back'
  | 'video-forward'
  /** While a video item is live: present the next or previous run sheet item. */
  | 'present-next-item'
  | 'present-previous-item';

/** How far Left and Right jump through a live video. */
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

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>;

/**
 * The action of a key. While a video item is live and the slide keys are on it (`video`),
 * Space plays or pauses, Left and Right jump through the video, and Up and Down move to the
 * previous and next item (U21, M6.5); every other key does what it does otherwise.
 */
export function presentAction(
  event: KeyPress,
  context: { video?: boolean } = {},
): PresentAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (context.video) {
    switch (event.key) {
      case ' ':
        return 'video-toggle';
      case 'ArrowLeft':
        return 'video-back';
      case 'ArrowRight':
        return 'video-forward';
      case 'ArrowUp':
        return 'present-previous-item';
      case 'ArrowDown':
        return 'present-next-item';
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
    case ' ':
      return 'unblank-or-next';
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
  readonly live: { blank: boolean } | null;
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
  presentItem(by: 1 | -1): Promise<unknown>;
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
    case 'clear':
      return void session.clear();
    case 'video-toggle':
      return void session.videoPlay(!session.video?.playing);
    case 'video-back':
      return void session.videoSeek({ by: -VIDEO_JUMP_SECONDS });
    case 'video-forward':
      return void session.videoSeek({ by: VIDEO_JUMP_SECONDS });
    case 'present-next-item':
      return void session.presentItem(1);
    case 'present-previous-item':
      return void session.presentItem(-1);
  }
}

/**
 * Whether the keys act on a live video (M6.5): a video item is presented, and the slide keys
 * have not been moved to another item.
 */
export function videoKeys(session: {
  readonly video: { itemId: string } | null;
  readonly browsedItemId: string | null;
}): boolean {
  const video = session.video;
  return !!video && (session.browsedItemId === null || session.browsedItemId === video.itemId);
}
