/** Upload limits per kind of media (media uploads plan, U1) and the formats each takes. */
import type { MediaLimits } from '@worship-q/protocol';

const MB = 1024 * 1024;

/** U1's defaults: images 25 MB, slide decks and PDFs 200 MB, videos 200 MB. */
export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  image: 25 * MB,
  deck: 200 * MB,
  video: 200 * MB,
};

/** Image formats `sharp` reads here (M0.1). HEIC is refused; see `HEIC_EXTENSIONS`. */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
/** iPhone photos, which the server cannot read; a Mac converts them first (U25). */
export const HEIC_EXTENSIONS = ['.heic', '.heif'];
/** Video containers that play in both webviews (M0.2). */
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm'];

export const HEIC_MESSAGE =
  'HEIC photos cannot be read here. Export the photo as JPEG and try again.';

/**
 * The limits set by the server administrator, in whole megabytes, for example
 * `WORSHIP_Q_MAX_VIDEO_MB=500`; a missing or unusable value keeps the default.
 */
export function mediaLimitsFromEnv(env: Record<string, string | undefined>): MediaLimits {
  const read = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value * MB) : fallback;
  };
  return {
    image: read('WORSHIP_Q_MAX_IMAGE_MB', DEFAULT_MEDIA_LIMITS.image),
    deck: read('WORSHIP_Q_MAX_DECK_MB', DEFAULT_MEDIA_LIMITS.deck),
    video: read('WORSHIP_Q_MAX_VIDEO_MB', DEFAULT_MEDIA_LIMITS.video),
  };
}

/** A file's download name for a `content-disposition` header, with a plain fallback. */
export function attachment(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Lets `limit` tasks run at once; the rest wait their turn. */
export function limiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((start) => waiting.push(start));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}
