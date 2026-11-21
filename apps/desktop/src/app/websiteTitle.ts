import { youtubeVideo, type Website } from '@worship-q/protocol';
import { useEffect, useState } from 'react';
import { native } from '../platform/native';
import { pageTitle } from './pageTitle';

// Each address is read once while the app runs; typing it again, or adding it after the
// title showed, does not ask the site again.
const titles = new Map<string, Promise<string | null>>();
const KEPT = 50;

/** The title of the website at `url`, read from the site; null when it cannot be. */
export function websiteTitle(url: string): Promise<string | null> {
  let title = titles.get(url);
  if (!title) {
    if (titles.size >= KEPT) titles.delete(titles.keys().next().value!);
    title = pageTitle(url, native.fetchPageStart);
    titles.set(url, title);
    // A YouTube video's length is read meanwhile too, ready for the save.
    void youtubeLength(url);
  }
  return title;
}

const lengths = new Map<string, Promise<number | null>>();

/** A YouTube video's length, read once per address while the app runs; null otherwise. */
function youtubeLength(url: string): Promise<number | null> {
  const video = youtubeVideo(url);
  if (!video) return Promise.resolve(null);
  let length = lengths.get(video.id);
  if (!length) {
    if (lengths.size >= KEPT) lengths.delete(lengths.keys().next().value!);
    length = native.youtubeLength(video.id).catch(() => null);
    lengths.set(video.id, length);
  }
  return length;
}

/**
 * The website to save for `url` (YouTube control D3): a YouTube video's with its length,
 * kept from `before` when the address is the same, or read from YouTube. A length that
 * cannot be read is left out; the slideshow fills it in once its player knows it.
 */
export async function websiteFor(url: string, before?: Website | null): Promise<Website> {
  if (before?.url === url && before.durationSeconds !== undefined) return before;
  const seconds = await youtubeLength(url);
  return seconds ? { url, durationSeconds: seconds } : { url };
}

/**
 * The title of the website at `url`, once the address has stayed the same for a moment, so
 * a site is not asked for every letter typed. Null until then, and for no address.
 */
export function useWebsiteTitle(url: string | null): string | null {
  const [found, setFound] = useState<{ url: string; title: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let current = true;
    const timer = setTimeout(() => {
      void websiteTitle(url).then((title) => current && setFound({ url, title }));
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [url]);
  return found && found.url === url ? found.title : null;
}
