/**
 * Routing in the browser with the History API. The server serves the one page for every
 * /admin/* path, so links change the address without a reload.
 */
import { useSyncExternalStore, type MouseEvent } from 'react';
import { parseRoute, routePath, type Route } from './format';

const NAVIGATE = 'wq:navigate';

export function navigate(to: Route | string, replace = false): void {
  const path = typeof to === 'string' ? to : routePath(to);
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE, listener);
  };
}

// The snapshot is the address string, so React compares a primitive, not a fresh object.
const location = () => window.location.pathname + window.location.search;

export function useRoute(): Route {
  const address = useSyncExternalStore(subscribe, location);
  const [pathname, search = ''] = address.split('?', 2) as [string, string?];
  return parseRoute(pathname, search ? `?${search}` : '');
}

/** Lets a plain link be handled here unless the person asks the browser for a new tab. */
export function linkClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href') ?? '/admin/');
}
