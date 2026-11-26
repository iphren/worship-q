/** The invitation page's languages, chosen from the browser's (native apps plan). */
export type Language = 'en' | 'zh-Hans' | 'zh-Hant';

/**
 * The store pages, filled in when the apps are published (plan M6). Empty, a store is not
 * shown; with neither, the page says the app is not in the stores yet.
 */
export const STORES: readonly { label: 'appStore' | 'googlePlay'; url: string }[] = [
  { label: 'appStore', url: '' },
  { label: 'googlePlay', url: '' },
];

export const WORDS = {
  en: {
    lang: 'en',
    invitationFor: 'This invitation is for {server}.',
    continueTo: 'Continue to {server}',
    orGetApp: 'Or get the Worship Q app:',
    needsApp: 'This presentation needs the Worship Q app.',
    notYetInStores: 'The Worship Q app is not in the app stores yet.',
    invalid: 'This invitation link is incomplete. Ask for the QR code again.',
    appStore: 'App Store',
    googlePlay: 'Google Play',
  },
  'zh-Hans': {
    lang: 'zh-Hans',
    invitationFor: '此邀请用于 {server}。',
    continueTo: '继续前往 {server}',
    orGetApp: '或者下载 Worship Q 应用：',
    needsApp: '此演示需要 Worship Q 应用。',
    notYetInStores: 'Worship Q 应用尚未上架应用商店。',
    invalid: '此邀请链接不完整，请重新获取二维码。',
    appStore: 'App Store',
    googlePlay: 'Google Play',
  },
  'zh-Hant': {
    lang: 'zh-Hant',
    invitationFor: '此邀請用於 {server}。',
    continueTo: '繼續前往 {server}',
    orGetApp: '或下載 Worship Q 應用程式：',
    needsApp: '此簡報需要 Worship Q 應用程式。',
    notYetInStores: 'Worship Q 應用程式尚未在應用程式商店上架。',
    invalid: '此邀請連結不完整，請重新索取 QR 碼。',
    appStore: 'App Store',
    googlePlay: 'Google Play',
  },
} satisfies Record<Language, Record<string, string>>;

/** The first of the browser's languages the page has, or English. */
export function languageOf(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const language = tag.toLowerCase();
    if (language === 'en' || language.startsWith('en-')) return 'en';
    if (language === 'zh' || language.startsWith('zh-')) {
      return /hant|-tw|-hk|-mo/.test(language) ? 'zh-Hant' : 'zh-Hans';
    }
  }
  return 'en';
}
