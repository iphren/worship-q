/** The output app's messages, with the shared ones, and the shared language tools. */
import { common } from './en/common';
import { output } from './en/output';
import { common as commonHans } from './zh-hans/common';
import { output as outputHans } from './zh-hans/output';
import { common as commonHant } from './zh-hant/common';
import { output as outputHant } from './zh-hant/output';
import { pluralCategory, translator, type Params, type PluralBase } from './index';

const en = { ...common, ...output };

export type MessageKey = keyof typeof en;
export const messages = {
  en,
  'zh-Hans': { ...commonHans, ...outputHans },
  'zh-Hant': { ...commonHant, ...outputHant },
};
/** The interface text for a key in the current language. */
export const t = translator<Record<MessageKey, string>>(messages);
/** A message with a count, in the singular or plural form the language uses; `{count}` is set. */
export const tp = (key: PluralBase<MessageKey>, count: number, params?: Params): string =>
  t(`${key}.${pluralCategory(count)}` as MessageKey, { count, ...params });

export * from './index';
export { formatNodes, useLocale } from './react';
