/** Small helpers about media files: a deck's identifier, and reading a video's size. */
import type { Song } from '@worship-q/protocol';

/** The identifier in a deck's image names, `deck-<id>-001.jpg`, shared with its original. */
export function deckIdOf(song: Pick<Song, 'deck'>): string | null {
  const image = song.deck?.pages[0]?.image ?? '';
  return /^deck-([0-9a-f-]{36})-/.exec(image)?.[1] ?? null;
}

/**
 * Where **Download original** takes a media item's file from (U18): this computer's copy of
 * a video when it has one, otherwise the server's route for it. Null for a deck whose images
 * do not name an identifier, which has no original to ask for.
 */
export function originalSource(
  song: Pick<Song, 'deck' | 'video'>,
  localVideo: string | null,
): { local: string } | { server: string } | null {
  if (song.video) {
    return localVideo ? { local: localVideo } : { server: `/api/v1/files/${song.video.file}` };
  }
  const id = deckIdOf(song);
  if (!song.deck || !id) return null;
  return {
    server: `/api/v1/decks/${id}/original?name=${encodeURIComponent(song.deck.source)}`,
  };
}

/** How long the hidden player waits for a video before giving up (U14). */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * Loads a video in a hidden, muted player and reads its duration and picture size, as this
 * computer would play it (U14, M0.2). Fails when it does not load in time; a video with no
 * picture (ProRes on Windows loads as sound only) answers a width of 0.
 */
export function probeVideo(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ durationSeconds: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    const done = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
    };
    const timer = window.setTimeout(() => {
      done();
      reject(new Error('timed out'));
    }, timeoutMs);
    video.addEventListener('loadedmetadata', () => {
      const result = {
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      done();
      resolve(result);
    });
    video.addEventListener('error', () => {
      done();
      reject(new Error('cannot-play'));
    });
    video.src = url;
  });
}
