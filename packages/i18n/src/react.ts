import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale, type ActiveLocale } from './index';

/** The current interface language; a component using it renders again when it changes. */
export function useLocale(): ActiveLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
