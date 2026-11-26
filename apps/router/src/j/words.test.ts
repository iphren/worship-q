import { describe, expect, it } from 'vitest';
import { languageOf, WORDS } from './words';

describe('languageOf', () => {
  it('follows the first language the page has', () => {
    expect(languageOf(['fr-FR', 'zh-CN', 'en'])).toBe('zh-Hans');
    expect(languageOf(['en-GB', 'zh-TW'])).toBe('en');
    expect(languageOf(['zh-Hant-HK'])).toBe('zh-Hant');
    expect(languageOf(['zh-HK'])).toBe('zh-Hant');
    expect(languageOf(['zh'])).toBe('zh-Hans');
    expect(languageOf(['de'])).toBe('en');
    expect(languageOf([])).toBe('en');
  });
});

describe('WORDS', () => {
  it('has every sentence in every language, with the server where it belongs', () => {
    const keys = Object.keys(WORDS.en).sort();
    for (const words of Object.values(WORDS)) {
      expect(Object.keys(words).sort()).toEqual(keys);
      expect(words.invitationFor).toContain('{server}');
      expect(words.continueTo).toContain('{server}');
    }
  });

  it('keeps Chinese out of the English page', () => {
    expect(Object.values(WORDS.en).join('')).not.toMatch(/[㐀-鿿＀-￯]/);
  });
});
