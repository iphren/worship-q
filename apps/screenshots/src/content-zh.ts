// The screenshots' content for the Chinese website: songs whose words are the Chinese Union
// Version of 1919 (public domain), one of them with the King James Version line by line,
// Psalm 23 in both, and the sermon and video in Chinese. The English hymns stay in the
// library, as a Chinese church's library holds both (the interface language is not the
// content's). Traditional is converted from Simplified, characters only.

import type { Passage } from '@worship-q/bible';
import * as OpenCC from 'opencc-js';
import {
  ENGLISH,
  HYMNS,
  PSALM_23,
  type Content,
  type Hymn,
  type Sermon,
  type VideoItem,
} from './content';

const CUV = 'Chinese Union Version (1919). Public domain.';

const LORDS_PRAYER: Hymn = {
  title: '主祷文',
  author: '马太福音 6:9-13，和合本',
  year: 1919,
  lyrics: `我们在天上的父，
愿人都尊你的名为圣。
愿你的国降临，
愿你的旨意行在地上，如同行在天上。

我们日用的饮食，今日赐给我们。
免我们的债，如同我们免了人的债。
不叫我们遇见试探，
救我们脱离凶恶。

因为国度、权柄、荣耀，
全是你的，直到永远。阿们！`,
};

/** Two languages on one slide: each line of the Union Version followed by the King James. */
const PSALM_100: Hymn = {
  title: '普天下当向耶和华欢呼',
  author: '诗篇 100，和合本与 KJV',
  year: 1919,
  lyrics: `普天下当向耶和华欢呼！
Make a joyful noise unto the LORD, all ye lands.
你们当乐意事奉耶和华，当来向他歌唱！
Serve the LORD with gladness: come before his presence with singing.

你们当晓得耶和华是神！
Know ye that the LORD he is God:
我们是他造的，也是属他的；
it is he that hath made us, and not we ourselves;
我们是他的民，也是他草场上的羊。
we are his people, and the sheep of his pasture.

当称谢进入他的门；当赞美进入他的院。
Enter into his gates with thanksgiving, and into his courts with praise:
当感谢他，称颂他的名！
be thankful unto him, and bless his name.
因为耶和华本为善，他的慈爱存到永远；
For the LORD is good; his mercy is everlasting;
他的信实直到万代。
and his truth endureth to all generations.`,
};

const PSALM_121: Hymn = {
  title: '我要向山举目',
  author: '诗篇 121，和合本',
  year: 1919,
  lyrics: `我要向山举目；
我的帮助从何而来？
我的帮助从造天地的耶和华而来。

他必不叫你的脚摇动；
保护你的必不打盹！
保护以色列的，
也不打盹也不睡觉。

你出你入，耶和华要保护你，
从今时直到永远。`,
};

const line = (text: string, indent = 0) => ({ text, indent });

/** Psalm 23 in the Union Version, beside the King James Version. */
const PSALM_23_CUV: Passage = {
  reference: 'PSA.23',
  texts: [
    {
      version: 'CUNP-S',
      credit: '和合本',
      provider: 'freeuse',
      copyright: CUV,
      fumsToken: null,
      units: [
        { chapter: 23, verses: [], label: '', title: true, lines: [line('（大卫的诗。）')] },
        { chapter: 23, verses: [1], label: '1', lines: [line('耶和华是我的牧者，我必不至缺乏。')] },
        {
          chapter: 23,
          verses: [2],
          label: '2',
          lines: [line('他使我躺卧在青草地上，领我在可安歇的水边。')],
        },
        {
          chapter: 23,
          verses: [3],
          label: '3',
          lines: [line('他使我的灵魂苏醒，为自己的名引导我走义路。')],
        },
        {
          chapter: 23,
          verses: [4],
          label: '4',
          lines: [
            line('我虽然行过死荫的幽谷，也不怕遭害，因为你与我同在；你的杖，你的竿，都安慰我。'),
          ],
        },
        {
          chapter: 23,
          verses: [5],
          label: '5',
          lines: [line('在我敌人面前，你为我摆设筵席；你用油膏了我的头，使我的福杯满溢。')],
        },
        {
          chapter: 23,
          verses: [6],
          label: '6',
          lines: [line('我一生一世必有恩惠慈爱随着我；我且要住在耶和华的殿中，直到永远。')],
        },
      ],
    },
    PSALM_23.texts.find((text) => text.version === 'KJV')!,
  ],
};

const SERMON: Sermon = {
  kind: 'sermon',
  title: '好牧人',
  source: '好牧人.pptx',
  slides: [
    { heading: '好牧人', lines: ['诗篇 23 · 约翰福音 10:11'] },
    { heading: '一、他供应', lines: ['“耶和华是我的牧者，我必不至缺乏。”', '诗篇 23:1'] },
    { heading: '二、他复兴', lines: ['“他使我的灵魂苏醒。”', '诗篇 23:3'] },
    { heading: '三、他同在', lines: ['“我也不怕遭害，因为你与我同在。”', '诗篇 23:4'] },
  ],
};

const WELCOME: VideoItem = {
  kind: 'video',
  title: '欢迎',
  source: '欢迎.mp4',
  durationSeconds: 95,
};

const SIMPLIFIED: Content = {
  hymns: [LORDS_PRAYER, PSALM_100, PSALM_121, ...HYMNS],
  runSheet: [
    WELCOME,
    '普天下当向耶和华欢呼',
    PSALM_23_CUV,
    SERMON,
    '主祷文',
    'Amazing Grace',
    '我要向山举目',
  ],
  lastWeek: ['我要向山举目', 'Be Thou My Vision', '主祷文'],
  workspaceName: '主日崇拜',
  scenes: {
    passage: '耶和华是我的牧者，我必不至缺乏。',
    song: '我们在天上的父，',
    bilingual: '普天下当向耶和华欢呼！',
    calendarSong: '普天下当向耶和华欢呼',
    librarySong: '主祷文',
    libraryLine: '因为国度、权柄、荣耀，',
  },
};

const toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });

/** The same content in Traditional characters; the Bible's Traditional edition beside KJV. */
function traditional(content: Content): Content {
  const convert = <T>(value: T): T => JSON.parse(toTraditional(JSON.stringify(value))) as T;
  const converted = convert(content);
  const passage = converted.runSheet.find(
    (entry): entry is Passage => typeof entry === 'object' && 'texts' in entry,
  );
  if (passage) passage.texts[0]!.version = 'CUNP-T';
  return converted;
}

/** The screenshots' content in an interface language. */
export function contentFor(language: string | undefined): Content {
  if (language?.toLowerCase() === 'zh-hans') return SIMPLIFIED;
  if (language?.toLowerCase() === 'zh-hant') return traditional(SIMPLIFIED);
  return ENGLISH;
}
