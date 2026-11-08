/**
 * Video playback in the live state (media uploads plan, U22, U23). The presented video item
 * has one clock for every screen: a position at a moment, and whether it has played on
 * since. Each video item remembers where it was left for as long as the live state lasts.
 */
import type { LiveState, LiveVideo } from '@worship-q/protocol';

/** A video within this much of its end counts as ended, and starts again from 0 (U22). */
export const END_SLACK_SECONDS = 0.5;

/** What the reducer knows of a video item's piece. */
export interface VideoInfo {
  durationSeconds: number;
  autoplay: boolean;
}

/**
 * Where a video is at `now`: a playing one moves on with the clock, and one that played to
 * its end is reported paused there, without any command.
 */
export function videoAt(video: LiveVideo, now: string): LiveVideo {
  if (!video.playing) return video;
  const elapsed = Math.max(0, (Date.parse(now) - Date.parse(video.at)) / 1000);
  const position = video.position + elapsed;
  if (position >= video.durationSeconds) {
    return { ...video, playing: false, position: video.durationSeconds, at: now };
  }
  return { ...video, position, at: now };
}

/** The position to show on screen at `now`, in seconds; for outputs and control bars. */
export function videoPosition(video: LiveVideo, now: string): number {
  return videoAt(video, now).position;
}

const clamp = (seconds: number, duration: number) => Math.min(Math.max(0, seconds), duration);

/**
 * The video fields after a command changed what is presented or blank. `before` is the state
 * before the command, `after` the state with the command's other changes; `presentedVideo`
 * describes the presented item's video, when it has one.
 */
export function followPresentation(
  before: LiveState,
  after: LiveState,
  presentedVideo: VideoInfo | null,
  now: string,
): Pick<LiveState, 'video' | 'videoPositions'> {
  let video = before.video ? videoAt(before.video, now) : null;
  let positions = after.videoPositions;
  const itemId = after.presented?.itemId ?? null;

  // Still the same video item: only blanking matters (U22).
  if (video && itemId === video.itemId && presentedVideo) {
    if (after.blank && !before.blank && video.playing) {
      video = { ...video, playing: false, resumeOnUnblank: true, at: now };
    } else if (!after.blank && before.blank && video.resumeOnUnblank) {
      // Played again from where blanking stopped it, or where Autoplay waited.
      const from = video.position >= video.durationSeconds - END_SLACK_SECONDS ? 0 : video.position;
      video = { ...video, playing: true, position: from, resumeOnUnblank: false, at: now };
    }
    return { video, videoPositions: positions };
  }

  // Leaving a video item keeps where it was (U22).
  if (video) {
    positions = { ...positions, [video.itemId]: video.position };
    video = null;
  }

  // Entering a video item: from where it was left, playing with Autoplay unless blank (U23).
  if (itemId && presentedVideo) {
    const duration = presentedVideo.durationSeconds;
    const left = positions[itemId] ?? 0;
    const position = left >= duration - END_SLACK_SECONDS ? 0 : clamp(left, duration);
    const play = presentedVideo.autoplay && !after.blank;
    video = {
      itemId,
      playing: play,
      position,
      at: now,
      durationSeconds: duration,
      resumeOnUnblank: presentedVideo.autoplay && after.blank,
    };
  }
  return { video, videoPositions: positions };
}

/** A play, pause or seek for the presented video item; null when it is for another item. */
export function applyVideoCommand(
  state: LiveState,
  command:
    | { type: 'videoPlay'; itemId: string }
    | { type: 'videoPause'; itemId: string }
    | { type: 'videoSeek'; itemId: string; seconds: number },
  now: string,
): LiveVideo | null {
  if (!state.video || state.video.itemId !== command.itemId) return null;
  if (state.presented?.itemId !== command.itemId) return null;
  const video = videoAt(state.video, now);
  const duration = video.durationSeconds;
  switch (command.type) {
    case 'videoPlay': {
      // Played at its end, it starts again.
      const position = video.position >= duration - END_SLACK_SECONDS ? 0 : video.position;
      return { ...video, playing: true, position, at: now, resumeOnUnblank: false };
    }
    case 'videoPause':
      return { ...video, playing: false, at: now, resumeOnUnblank: false };
    case 'videoSeek': {
      const position = clamp(command.seconds, duration);
      // A seek to the end leaves it paused there.
      const playing = video.playing && position < duration;
      return { ...video, position, playing, at: now };
    }
  }
}
