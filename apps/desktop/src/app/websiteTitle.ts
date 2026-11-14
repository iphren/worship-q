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
  }
  return title;
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
