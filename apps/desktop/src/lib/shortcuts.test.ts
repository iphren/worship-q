import { describe, expect, it } from 'vitest';
import {
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

describe('keys while a video item is live (M6.5)', () => {
  const video = (key: string) =>
    presentAction({ key, metaKey: false, ctrlKey: false, altKey: false }, { video: true });

  it('plays or pauses with Space, also while blank, instead of unblank-or-next', () => {
    expect(video(' ')).toBe('video-toggle');
  });

  it('jumps through the video with Left and Right', () => {
    expect(video('ArrowLeft')).toBe('video-back');
    expect(video('ArrowRight')).toBe('video-forward');
  });

  it('moves to the previous and next item with Up and Down', () => {
    expect(video('ArrowUp')).toBe('present-previous-item');
    expect(video('ArrowDown')).toBe('present-next-item');
  });

  it('leaves every other key as it is', () => {
    expect(video('PageDown')).toBe('next');
    expect(video('.')).toBe('toggle-blank');
    expect(video('Delete')).toBe('clear');
    expect(video('1')).toEqual({ slide: 0 });
  });

  it('does what it does today with a song live', () => {
    expect(press(' ')).toBe('unblank-or-next');
    expect(press('ArrowLeft')).toBe('item-previous');
  });

  it('acts on the video only while the slide keys are on it', () => {
    const live = { itemId: 'v' };
    expect(videoKeys({ video: live, browsedItemId: null })).toBe(true);
    expect(videoKeys({ video: live, browsedItemId: 'v' })).toBe(true);
    // A video item keyed without presenting it, or another item keyed: the slide keys.
    expect(videoKeys({ video: live, browsedItemId: 'song' })).toBe(false);
    expect(videoKeys({ video: null, browsedItemId: 'v' })).toBe(false);
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
      video: { playing: false },
      videoPlay: async (playing) => void calls.push(`videoPlay(${playing})`),
      videoSeek: async (to) => void calls.push(`videoSeek(${to.by})`),
      presentItem: async (by) => void calls.push(`presentItem(${by})`),
    };
    return { session, calls };
  };

  it('plays, pauses, jumps and moves between items while a video is live (M6.5)', () => {
    const { session, calls } = controls(false);
    for (const action of [
      'video-toggle',
      'video-back',
      'video-forward',
      'present-next-item',
      'present-previous-item',
    ] as const)
      runPresentAction(session, action);
    expect(calls).toEqual([
      'videoPlay(true)',
      'videoSeek(-10)',
      'videoSeek(10)',
      'presentItem(1)',
      'presentItem(-1)',
    ]);
  });

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
