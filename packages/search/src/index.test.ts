import { describe, expect, it } from 'vitest';
import { fold, parseQuery, rankSong, searchKeys, songKeys } from './index';

const pinyinOf = (text: string) => searchKeys(text).pinyin;

describe('fold', () => {
  it('treats Traditional and Simplified characters alike', () => {
    expect(fold('耶和華')).toBe('耶和华');
    expect(fold('讚美祢的聖名')).toBe('赞美你的圣名');
  });

  it('follows Taiwan usage', () => {
    expect(fold('活著')).toBe('活着');
    expect(fold('這裡')).toBe('这里');
  });

  it('reads 祢, 妳 and 祂 as 你 and 他', () => {
    expect(fold('祢是我的神')).toBe('你是我的神');
    expect(fold('妳')).toBe('你');
    expect(fold('在祂怀中')).toBe('在他怀中');
  });

  it('ignores letter case, full-width forms and Latin accents', () => {
    expect(fold('Ｊｅｓｕｓ')).toBe('jesus');
    expect(fold('Noël')).toBe('noel');
  });
});

describe('searchKeys', () => {
  it('produces the characters, the pinyin and the initials', () => {
    expect(searchKeys('耶和华')).toEqual({ text: '耶和华', pinyin: 'yehehua', initials: 'yhh' });
  });

  it('ignores spaces, punctuation and control characters', () => {
    expect(searchKeys('主啊，我要\u007f跟随你！\n\n跟随你')).toEqual(
      searchKeys('主啊我要跟随你跟随你'),
    );
  });

  it('keeps English words whole and takes their first letters', () => {
    expect(searchKeys("You're my God, 123")).toEqual({
      text: 'youremygod123',
      pinyin: 'youremygod123',
      initials: 'ymg123',
    });
  });

  it('mixes Chinese and English', () => {
    expect(searchKeys('我的诗歌 You are my song')).toEqual({
      text: '我的诗歌youaremysong',
      pinyin: 'wodeshigeyouaremysong',
      initials: 'wdsgyams',
    });
  });

  it('writes ü as v', () => {
    expect(pinyinOf('女')).toBe('nv');
  });

  it('gives Traditional text the same keys as Simplified', () => {
    expect(searchKeys('我們讚美祢')).toEqual(searchKeys('我们赞美你'));
  });

  describe('characters with several readings', () => {
    it('reads them from context', () => {
      expect(pinyinOf('你是我喜乐')).toBe('nishiwoxile');
      expect(pinyinOf('主的音乐')).toBe('zhudeyinyue');
      expect(pinyinOf('我要行在你的道路')).toBe('woyaoxingzainidedaolu');
      expect(pinyinOf('你的爱长阔高深')).toBe('nideaichangkuogaoshen');
      expect(pinyinOf('我们重生得救')).toBe('womenchongshengdejiu');
      expect(pinyinOf('主你差遣我')).toBe('zhunichaiqianwo');
      expect(pinyinOf('耶稣降临')).toBe('yesujianglin');
    });

    it('uses our readings for worship phrases', () => {
      expect(pinyinOf('我们得着生命')).toBe('womendezhaoshengming');
      expect(pinyinOf('我们降服在你面前')).toBe('womenxiangfuzainimianqian');
    });

    it('uses the common reading for a character on its own', () => {
      expect(pinyinOf('乐')).toBe('le');
      expect(pinyinOf('行')).toBe('xing');
      expect(pinyinOf('长')).toBe('chang');
      expect(pinyinOf('了')).toBe('le');
      expect(pinyinOf('了解')).toBe('liaojie');
    });

    it('reads 祢 as ni', () => {
      expect(pinyinOf('祢')).toBe('ni');
    });
  });
});

describe('parseQuery', () => {
  it('splits at anything that is not a word character', () => {
    expect(parseQuery(' 耶和華，yhh!  you’re ')).toEqual([
      { chinese: true, text: '耶和华', pinyin: 'yehehua' },
      { chinese: false, text: 'yhh', pinyin: 'yhh' },
      { chinese: false, text: 'youre', pinyin: 'youre' },
    ]);
  });

  it('returns no terms for an empty search', () => {
    expect(parseQuery('  ，。! ')).toEqual([]);
  });
});

describe('rankSong', () => {
  const song = songKeys({ title: '耶和华是我牧者', lyrics: '我必不至缺乏\n使我躺卧青草地' });
  const rank = (search: string) => rankSong(parseQuery(search), song);

  it('matches the same characters, the same sound, the pinyin and the initials', () => {
    expect(rank('耶和华')).not.toBeNull();
    expect(rank('耶和華')).not.toBeNull();
    expect(rank('夜河花')).not.toBeNull();
    expect(rank('yehehua')).not.toBeNull();
    expect(rank('yhh')).not.toBeNull();
    expect(rank('青草')).not.toBeNull();
    expect(rank('qcd')).not.toBeNull();
  });

  it('requires every term to match', () => {
    expect(rank('耶和华 青草')).not.toBeNull();
    expect(rank('耶和华 grace')).toBeNull();
    expect(rank('诗歌')).toBeNull();
  });

  it('ranks the start of the title first, then the title, then the lyrics', () => {
    const start = rank('耶和华')!;
    const title = rank('牧者')!;
    const homophone = rank('木者')!;
    const lyrics = rank('青草')!;
    const lyricsHomophone = rank('清草')!;
    expect(start).toBeLessThan(title);
    expect(title).toBeLessThan(homophone);
    expect(homophone).toBeLessThan(lyrics);
    expect(lyrics).toBeLessThan(lyricsHomophone);
  });

  it('ranks pinyin above initials', () => {
    expect(rank('muzhe')!).toBeLessThan(rank('mz')!);
  });
});
