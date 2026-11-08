import { describe, expect, it } from 'vitest';
import { deckIdOf, originalSource } from './mediaFiles';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const deck = {
  source: '主日 Talk.pptx',
  width: 1,
  height: 1,
  pages: [{ image: `deck-${ID}-001.jpg`, slide: 1, step: 0, text: [] }],
};
const video = {
  file: `video-${ID}.mp4`,
  source: 'Welcome.mp4',
  width: 1,
  height: 1,
  durationSeconds: 1,
  bytes: 1,
  autoplay: false,
};

describe('Download original (U18)', () => {
  it('reads a deck’s identifier from its images', () => {
    expect(deckIdOf({ deck })).toBe(ID);
    expect(deckIdOf({ deck: null })).toBeNull();
  });

  it('takes a deck’s original from the server, named after its source', () => {
    expect(originalSource({ deck, video: null }, null)).toEqual({
      server: `/api/v1/decks/${ID}/original?name=${encodeURIComponent('主日 Talk.pptx')}`,
    });
  });

  it('takes a video from this computer’s copy first, otherwise from the server', () => {
    expect(originalSource({ deck: null, video }, '/data/videos/v.mp4')).toEqual({
      local: '/data/videos/v.mp4',
    });
    expect(originalSource({ deck: null, video }, null)).toEqual({
      server: `/api/v1/files/video-${ID}.mp4`,
    });
  });

  it('has nothing to fetch for a deck whose images name no identifier', () => {
    const old = { ...deck, pages: [{ ...deck.pages[0]!, image: 'slide-1.jpg' }] };
    expect(originalSource({ deck: old, video: null }, null)).toBeNull();
  });
});
