import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  indexText,
  keep,
  LocalText,
  normalise,
  searchText,
  type FreeUseComplete,
} from './localText';

const COMPLETE: FreeUseComplete = {
  books: [
    {
      id: 'JHN',
      chapters: [
        {
          chapter: {
            number: 3,
            content: [
              { type: 'heading', content: ['重生'] },
              { type: 'verse', number: 15, content: ['叫一切信他的都得永生', { noteId: 5 }, '。'] },
              {
                type: 'verse',
                number: 16,
                content: ['神爱世人，甚至将他的独生子赐给他们，叫一切信他的，不至灭亡，反得永生。'],
              },
              { type: 'line_break' },
              { type: 'verse', number: 17, content: ['因为神差他的儿子降世，不是要定世人的罪。'] },
            ],
          },
        },
      ],
    },
    {
      id: 'MAT',
      chapters: [
        {
          chapter: {
            number: 5,
            content: [
              {
                type: 'verse',
                number: 44,
                content: [
                  'But I tell you, love your enemies and pray for those who persecute you,',
                ],
              },
            ],
          },
        },
      ],
    },
  ],
};

const chapters = indexText(keep('test', COMPLETE));

describe('searching a whole version on the server', () => {
  it('sets punctuation, spaces and case aside', () => {
    expect(normalise('Love, your  Enemies!')).toBe('loveyourenemies');
    expect(normalise('神爱世人，甚至')).toBe('神爱世人甚至');
  });

  it('finds a quote within a verse, whatever its punctuation', () => {
    expect(searchText(chapters, '爱世人')).toEqual(['JHN.3.16']);
    expect(searchText(chapters, '神爱世人,甚至将他的独生子')).toEqual(['JHN.3.16']);
    expect(searchText(chapters, 'LOVE YOUR ENEMIES')).toEqual(['MAT.5.44']);
  });

  it('gives a range for a quote running across verses', () => {
    expect(searchText(chapters, '反得永生。因为神差他的儿子')).toEqual(['JHN.3.16-17']);
    // Too little of either verse: a chance join, not a quote.
    expect(searchText(chapters, '永生因为')).toEqual([]);
  });

  it('then finds verses holding every word, in any order', () => {
    expect(searchText(chapters, 'enemies pray')).toEqual(['MAT.5.44']);
    expect(searchText(chapters, '永生 世人')).toEqual(['JHN.3.16']);
    expect(searchText(chapters, 'hate enemies')).toEqual([]);
  });

  it('fetches a version once and keeps it in the data folder', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wq-text-')), 'text');
    let downloads = 0;
    const download = async () => {
      downloads++;
      return COMPLETE;
    };
    const text = new LocalText(dir, download);
    const [a, b] = await Promise.all([
      text.search('cmn_cu1', '世人'),
      text.search('cmn_cu1', '儿子'),
    ]);
    expect(a).toEqual(['JHN.3.16', 'JHN.3.17']);
    expect(b).toEqual(['JHN.3.17']);
    expect(downloads).toBe(1);
    expect(readdirSync(dir)).toEqual(['cmn_cu1.json']);
    // A restarted server reads it from the folder.
    expect(await new LocalText(dir, download).search('cmn_cu1', '世人')).toEqual([
      'JHN.3.16',
      'JHN.3.17',
    ]);
    expect(downloads).toBe(1);
  });
});
