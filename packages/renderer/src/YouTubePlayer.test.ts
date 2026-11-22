import { describe, expect, it } from 'vitest';
import {
  captionTrack,
  clockJumped,
  YOUTUBE_SEEK_PAUSE_MS,
  YT_STATE,
  youtubeStep,
} from './YouTubePlayer';

const T0 = Date.parse('2026-11-21T10:00:00.000Z');
const clock = (playing: boolean, position: number, durationSeconds = 200) => ({
  playing,
  position,
  at: new Date(T0).toISOString(),
  durationSeconds,
});
const step = (over: Partial<Parameters<typeof youtubeStep>[0]>) =>
  youtubeStep({
    clock: clock(true, 0),
    nowMs: T0,
    current: 0,
    state: YT_STATE.playing,
    live: false,
    jumped: false,
    lastSeekMs: 0,
    ...over,
  });

describe('a YouTube player following the clock (YouTube control D2)', () => {
  it('plays a cued or paused player while the clock plays, and pauses a running one', () => {
    expect(step({ state: YT_STATE.cued })).toMatchObject({ play: true, pause: false });
    expect(step({ state: YT_STATE.paused })).toMatchObject({ play: true });
    expect(step({ state: YT_STATE.buffering })).toMatchObject({ play: false, pause: false });
    expect(step({ clock: clock(false, 0), state: YT_STATE.playing })).toMatchObject({
      play: false,
      pause: true,
    });
  });

  it('follows a jump at once, and leaves small drift alone while playing', () => {
    expect(step({ clock: clock(true, 60), current: 10, jumped: true }).seekTo).toBe(60);
    expect(step({ clock: clock(true, 10), current: 9.2, lastSeekMs: -1e9 }).seekTo).toBeNull();
    expect(step({ clock: clock(true, 10), current: 5, lastSeekMs: -1e9 }).seekTo).toBe(10);
  });

  it('does not seek again soon after a seek, unless the clock jumped', () => {
    const recent = T0 - YOUTUBE_SEEK_PAUSE_MS + 500;
    expect(step({ clock: clock(true, 10), current: 5, lastSeekMs: recent }).seekTo).toBeNull();
    expect(
      step({ clock: clock(true, 10), current: 5, lastSeekMs: recent, jumped: true }).seekTo,
    ).toBe(10);
  });

  it('moves a live stream only between playing and paused', () => {
    const live = step({ clock: clock(true, 500, 0), current: 9_946_783, live: true, jumped: true });
    expect(live).toEqual({ seekTo: null, play: false, pause: false });
    expect(step({ clock: clock(false, 500, 0), live: true }).pause).toBe(true);
  });

  it('runs on with no end while the length is unknown, and stops at a known end', () => {
    const later = T0 + 300_000;
    expect(step({ clock: clock(true, 0, 0), nowMs: later, current: 300 })).toMatchObject({
      seekTo: null,
      pause: false,
    });
    expect(step({ clock: clock(true, 0, 200), nowMs: later, current: 200 }).pause).toBe(true);
  });

  it('starts an unstarted player where the clock is', () => {
    expect(step({ clock: clock(true, 60), state: YT_STATE.unstarted, jumped: true })).toMatchObject(
      {
        seekTo: 60,
        play: true,
      },
    );
  });

  it('tells a command from the same clock sent again', () => {
    expect(clockJumped(null, clock(true, 0), T0)).toBe(true);
    expect(clockJumped(clock(true, 0), clock(false, 0), T0)).toBe(true);
    expect(clockJumped(clock(true, 0), clock(true, 30), T0)).toBe(true);
    const again = { ...clock(true, 5), at: new Date(T0 + 5000).toISOString() };
    expect(clockJumped(clock(true, 0), again, T0 + 5000)).toBe(false);
  });
});

describe('choosing a caption track', () => {
  const tracks = [{ languageCode: 'en' }, { languageCode: 'zh-Hans' }, { languageCode: 'de' }];

  it('takes the page’s language, by its exact code or its base language', () => {
    expect(captionTrack(tracks, ['zh-Hans', 'en'])).toEqual({ languageCode: 'zh-Hans' });
    expect(captionTrack(tracks, ['zh-CN'])).toEqual({ languageCode: 'zh-Hans' });
    expect(captionTrack(tracks, ['de-AT', 'en'])).toEqual({ languageCode: 'de' });
  });

  it('falls back to the video’s first track, and to none when it has none', () => {
    expect(captionTrack(tracks, ['fr'])).toEqual({ languageCode: 'en' });
    expect(captionTrack([], ['en'])).toBeNull();
    expect(captionTrack(undefined, ['en'])).toBeNull();
  });
});
