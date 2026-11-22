/**
 * Video playback in the live state (media uploads plan, U22, U23). The presented video item
 * has one clock for every screen: a position at a moment, and whether it has played on
 * since. Each video item remembers where it was left for as long as the live state lasts.
 */
import type { LiveState, LiveVideo } from '@worship-q/protocol';

/** A video within this much of its end counts as ended, and starts again from 0 (U22). */
export const END_SLACK_SECONDS = 0.5;

/**
 * What the reducer knows of a video item's piece. A length of 0 means it is not known (yet):
 * a YouTube video whose length could not be read, or a live stream, which has none (YouTube
 * control D4). Such a clock is never stopped or limited at an end.
 */
export interface VideoInfo {
  durationSeconds: number;
  autoplay: boolean;
  /** Where it starts the first time it is presented: a YouTube link's `t=` (D5). */
  startSeconds?: number;
}

/** Whether a video's length is known: false for 0 (`VideoInfo`). */
export function knowsLength(video: { durationSeconds: number }): boolean {
  return video.durationSeconds > 0;
}

/** Whether a position is at a known end, where playing starts again from 0. */
function atEnd(position: number, duration: number): boolean {
  return duration > 0 && position >= duration - END_SLACK_SECONDS;
}

/**
 * Where a video is at `now`: a playing one moves on with the clock, and one that played to
 * its end is reported paused there, without any command.
 */
export function videoAt(video: LiveVideo, now: string): LiveVideo {
  if (!video.playing) return video;
  const elapsed = Math.max(0, (Date.parse(now) - Date.parse(video.at)) / 1000);
  const position = video.position + elapsed;
  if (knowsLength(video) && position >= video.durationSeconds) {
    return { ...video, playing: false, position: video.durationSeconds, at: now };
  }
  return { ...video, position, at: now };
}

/** The position to show on screen at `now`, in seconds; for outputs and control bars. */
export function videoPosition(video: LiveVideo, now: string): number {
  return videoAt(video, now).position;
}

/** A position within the video, or only above 0 while its length is not known. */
const clamp = (seconds: number, duration: number) =>
  duration > 0 ? Math.min(Math.max(0, seconds), duration) : Math.max(0, seconds);

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

  // Still the same video item: only blanking matters (U22), and a length learned since.
  if (video && itemId === video.itemId && presentedVideo) {
    video = withLength(video, presentedVideo, now);
    if (after.blank && !before.blank && video.playing) {
      video = { ...video, playing: false, resumeOnUnblank: true, at: now };
    } else if (!after.blank && before.blank && video.resumeOnUnblank) {
      // Played again from where blanking stopped it, or where Autoplay waited.
      const from = atEnd(video.position, video.durationSeconds) ? 0 : video.position;
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
    const left = positions[itemId] ?? presentedVideo.startSeconds ?? 0;
    const position = atEnd(left, duration) ? 0 : clamp(left, duration);
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

/**
 * The clock with the piece's length, when it has become known or changed since the clock
 * was started: a YouTube video's length is filled in once its player knows it (D3). A
 * position past the new end leaves it paused there.
 */
function withLength(video: LiveVideo, info: VideoInfo, now: string): LiveVideo {
  const duration = info.durationSeconds;
  if (duration <= 0 || duration === video.durationSeconds) return video;
  const current = videoAt(video, now);
  if (current.position < duration) return { ...current, durationSeconds: duration };
  return { ...current, durationSeconds: duration, position: duration, playing: false };
}

/**
 * A play, pause or seek for the presented video item; null when it is for another item.
 * `info` is the presented piece's video, whose length may have become known meanwhile.
 */
export function applyVideoCommand(
  state: LiveState,
  command:
    | { type: 'videoPlay'; itemId: string }
    | { type: 'videoPause'; itemId: string }
    | { type: 'videoSeek'; itemId: string; seconds: number },
  now: string,
  info?: VideoInfo | null,
): LiveVideo | null {
  if (!state.video || state.video.itemId !== command.itemId) return null;
  if (state.presented?.itemId !== command.itemId) return null;
  const clock = videoAt(state.video, now);
  const video = info ? withLength(clock, info, now) : clock;
  const duration = video.durationSeconds;
  switch (command.type) {
    case 'videoPlay': {
      // Played at its end, it starts again.
      const position = atEnd(video.position, duration) ? 0 : video.position;
      return { ...video, playing: true, position, at: now, resumeOnUnblank: false };
    }
    case 'videoPause':
      return { ...video, playing: false, at: now, resumeOnUnblank: false };
    case 'videoSeek': {
      const position = clamp(command.seconds, duration);
      // A seek to the end leaves it paused there.
      const playing = video.playing && (duration <= 0 || position < duration);
      return { ...video, position, playing, at: now };
    }
  }
}
