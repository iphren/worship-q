/** English text every app shares: dates and the language choice. */
export const common = {
  'calendar.anyDay': 'Any day',
  'calendar.everyDay': 'Every day',

  'language.label': 'Language',
  'language.auto': 'Automatic',
  'language.autoHint': 'Follows the language of this computer or browser.',
  'language.pseudo': 'Test language',
} as const;

export type CommonKey = keyof typeof common;
