/** The desktop app's messages, with the shared ones, and the shared language tools. */
import { common } from './en/common';
import { desktop } from './en/desktop';
import { translator } from './index';

const en = { ...common, ...desktop };

export type MessageKey = keyof typeof en;
export const messages = { en };
/** The interface text for a key in the current language. */
export const t = translator<Record<MessageKey, string>>(messages);

export * from './index';
export { useLocale } from './react';
