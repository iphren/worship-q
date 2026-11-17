import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { getLocale, subscribeLocale, type ActiveLocale } from './index';

/** The current interface language; a component using it renders again when it changes. */
export function useLocale(): ActiveLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/**
 * A message whose placeholders are elements, such as a name in bold: `t('key')` leaves the
 * placeholders in, and this puts the elements in their places.
 */
export function formatNodes(template: string, params: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/\{(\w+)\}/);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, index) =>
      index % 2 === 1
        ? createElement(Fragment, { key: index }, part in params ? params[part] : `{${part}}`)
        : part,
    ),
  );
}
