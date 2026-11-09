import { describe, expect, it } from 'vitest';
import {
  keyPress,
  presentAction,
  runPresentAction,
  slideKeyLabel,
  videoKeys,
  type PresentControls,
} from './shortcuts';

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

  it('leaves slash to the search shortcut: it is no slide key', () => {
    expect(press('/')).toBeNull();
  });

  it('moves through the whole run sheet with page down and up, and enter', () => {
    expect(press('PageDown')).toBe('next');
    expect(press('PageUp')).toBe('previous');
    expect(press('Enter')).toBe('unblank-or-next');
  });

  it('hides or shows the lyrics with space, and with the period as remotes send it', () => {
    expect(press(' ')).toBe('toggle-blank-or-present');
    expect(press('.')).toBe('toggle-blank');
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
    expect(press('1', { ctrlKey: true })).toBeNull();
    expect(press('ArrowDown', { metaKey: true })).toBeNull();
  });
});

describe('keys while a video item is live (M6.5)', () => {
  const video = (key: string, keys: 'keyed' | 'live' = 'keyed') =>
    presentAction({ key, metaKey: false, ctrlKey: false, altKey: false }, { video: keys });

  it('plays or pauses with Space, also while blank, instead of hiding the lyrics', () => {
    expect(video(' ')).toBe('video-toggle');
  });

  it('jumps through the video with Up and Down', () => {
    expect(video('ArrowUp')).toBe('video-back');
    expect(video('ArrowDown')).toBe('video-forward');
  });

  it('moves the keys to another item with Left and Right, as for any item', () => {
    expect(video('ArrowLeft')).toBe('item-previous');
    expect(video('ArrowRight')).toBe('item-next');
  });

  it('leaves every other key as it is', () => {
    expect(video('Enter')).toBe('unblank-or-next');
    expect(video('PageDown')).toBe('next');
    expect(video('.')).toBe('toggle-blank');
    expect(video('Delete')).toBe('clear');
    expect(video('1')).toEqual({ slide: 0 });
  });

  it('does what it does otherwise with a song live', () => {
    expect(press(' ')).toBe('toggle-blank-or-present');
    expect(press('ArrowDown')).toBe('slide-next');
  });

  it('keeps Space on the video, and Up and Down on the slides, once the keys move away', () => {
    expect(video(' ', 'live')).toBe('video-toggle');
    expect(video('ArrowDown', 'live')).toBe('slide-next');
    expect(video('ArrowUp', 'live')).toBe('slide-previous');
    expect(video('ArrowRight', 'live')).toBe('item-next');
    expect(video('1', 'live')).toEqual({ slide: 0 });
  });

  it('jumps through the video only while the slide keys are on it', () => {
    const live = { itemId: 'v' };
    expect(videoKeys({ video: live, browsedItemId: null })).toBe('keyed');
    expect(videoKeys({ video: live, browsedItemId: 'v' })).toBe('keyed');
    // Another item keyed: Space still plays or pauses the video.
    expect(videoKeys({ video: live, browsedItemId: 'song' })).toBe('live');
    // A video item keyed without presenting it: the slide keys.
    expect(videoKeys({ video: null, browsedItemId: 'v' })).toBeNull();
  });

  it('passes on only what decides a key, from the slideshow window', () => {
    // A whole event cannot be sent between windows; what decides the key can.
    const event = {
      key: 'ArrowDown',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
      target: {},
    };
    expect(keyPress(event)).toEqual({
      key: 'ArrowDown',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    });
  });
});

describe('runPresentAction', () => {
  const controls = (blank: boolean, presented: unknown = { itemId: 'song' }) => {
    const calls: string[] = [];
    const record = (name: string) => async () => void calls.push(name);
    const session: PresentControls = {
      live: { blank, presented },
      stepInItem: record('stepInItem'),
      browseItem: record('browseItem'),
      next: record('next'),
      previous: record('previous'),
      unblankOrNext: record('unblankOrNext'),
      setBlank: async (value) => void calls.push(`setBlank(${value})`),
      playSlide: record('playSlide'),
      clear: record('clear'),
      video: { playing: false },
      videoPlay: async (playing) => void calls.push(`videoPlay(${playing})`),
      videoSeek: async (to) => void calls.push(`videoSeek(${to.by})`),
    };
    return { session, calls };
  };

  it('plays, pauses and jumps while a video is live (M6.5)', () => {
    const { session, calls } = controls(false);
    for (const action of ['video-toggle', 'video-back', 'video-forward'] as const)
      runPresentAction(session, action);
    expect(calls).toEqual(['videoPlay(true)', 'videoSeek(-10)', 'videoSeek(10)']);
  });

  it('hides and shows the lyrics with space while a slide is on screen', () => {
    const shown = controls(false);
    runPresentAction(shown.session, 'toggle-blank-or-present');
    const hidden = controls(true);
    runPresentAction(hidden.session, 'toggle-blank-or-present');
    expect([...shown.calls, ...hidden.calls]).toEqual(['setBlank(true)', 'setBlank(false)']);
  });

  it('presents with space when nothing is on screen, as enter does', () => {
    const { session, calls } = controls(false, null);
    runPresentAction(session, 'toggle-blank-or-present');
    expect(calls).toEqual(['unblankOrNext']);
  });

  it('leaves enter to the session, which knows whether to unblank or move on', () => {
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
