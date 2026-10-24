import { describe, expect, it } from 'vitest';
import { cleanSongFields, invalidSongFields, maxSongYear } from './index';

const now = new Date('2026-10-17T09:00:00.000Z');

describe('song fields', () => {
  it('cleans fields entered by hand', () => {
    expect(
      cleanSongFields({
        title: '  耶和华你是我的神 ',
        lyrics: '耶和华\u007f 你是我的神\n\n  我要时时称颂\t你的名 ',
        author: ' 游智婷 ',
        copyright: '讚美之泉\n',
        ccli: ' ',
        year: 2006,
        background: null,
        deck: null,
      }),
    ).toEqual({
      title: '耶和华你是我的神',
      lyrics: '耶和华 你是我的神\n\n  我要时时称颂\t你的名 ',
      author: '游智婷',
      copyright: '讚美之泉',
      ccli: null,
      year: 2006,
      background: null,
      deck: null,
    });
  });

  it('keeps a CCLI number without surrounding spaces', () => {
    const fields = {
      title: '',
      lyrics: '',
      author: '',
      copyright: '',
      year: null,
      background: null,
      deck: null,
    };
    expect(cleanSongFields({ ...fields, ccli: ' 4702289 ' }).ccli).toBe('4702289');
  });

  it('accepts CCLI numbers of digits and years up to next year', () => {
    expect(maxSongYear(now)).toBe(2027);
    expect(invalidSongFields({ ccli: '14181', year: 1953 }, now)).toEqual([]);
    expect(invalidSongFields({ ccli: null, year: null }, now)).toEqual([]);
    expect(invalidSongFields({ ccli: '0', year: 800 }, now)).toEqual([]);
    expect(invalidSongFields({ ccli: null, year: 2027 }, now)).toEqual([]);
  });

  it('rejects other CCLI numbers and years', () => {
    expect(invalidSongFields({ ccli: '打開眾城門', year: 20155 }, now)).toEqual(['ccli', 'year']);
    expect(invalidSongFields({ ccli: '', year: 2028 }, now)).toEqual(['ccli', 'year']);
    expect(invalidSongFields({ ccli: '12 34', year: 2001.5 }, now)).toEqual(['ccli', 'year']);
  });
});
