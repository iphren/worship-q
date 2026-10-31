import { createLiveState } from '@worship-q/live-state';
import type { LiveSnapshot, OutputView } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildFrame, missingFonts } from './frame';

const look: OutputView['look'] = {
  fontFamily: 'Noto Sans SC',
  scale: 1.1,
  backgroundColor: '#112233',
  backgroundFile: { kind: 'image', fileName: 'bg.jpg' },
  linesPerPiece: 2,
  wrapLongLines: false,
};
const fileUrl = (name: string) => `/files/${name}`;

function snapshot(presented: LiveSnapshot['presented'], blank = false): LiveSnapshot {
  const state = createLiveState('rs1', '2026-10-11T09:00:00.000Z');
  return {
    revision: 1,
    coordinatorId: 'A',
    state: { ...state, blank },
    date: '2026-10-11',
    items: [],
    presented,
    devices: [],
  };
}

describe('browser output frames (M7.2)', () => {
  it('draws lyrics from the snapshot in the workspace’s look', () => {
    const frame = buildFrame({
      kind: 'slideshow',
      look,
      fileUrl,
      fontAvailable: true,
      snapshot: snapshot({
        itemId: 'i1',
        pieceId: 'p2',
        songId: 's1',
        title: 'Song',
        kind: 'lyrics',
        pieces: [
          { id: 'p1', lines: ['one'] },
          { id: 'p2', lines: ['two', 'three'] },
        ],
        background: null,
        websiteUrl: null,
        previous: false,
      }),
    });
    expect(frame).toMatchObject({
      layout: 'slideshow',
      fontFamily: 'Noto Sans SC',
      scale: 1.1,
      wrap: false,
      background: { color: '#112233', media: { kind: 'image', url: '/files/bg.jpg' } },
      pieceId: 'p2',
      song: {
        id: 's1',
        pieces: [
          { id: 'p1', lines: ['one'] },
          { id: 'p2', lines: ['two', 'three'] },
        ],
      },
    });
  });

  it('falls back to the default font when the browser lacks the workspace’s, and says which (M7.4)', () => {
    const frame = buildFrame({
      kind: 'subtitle',
      look,
      fileUrl,
      fontAvailable: false,
      snapshot: null,
    });
    expect(frame.fontFamily).toBeNull();
    expect(frame.wrap).toBe(false);
    expect(missingFonts(look, () => false)).toEqual(['Noto Sans SC']);
    expect(missingFonts(look, () => true)).toEqual([]);
    expect(missingFonts(null, () => false)).toEqual([]);
  });

  it('shows an imported slide as a picture on the slideshow only, and a blank screen as blank', () => {
    const deck = snapshot({
      itemId: 'i1',
      pieceId: 'img-2.jpg',
      songId: 's1',
      title: 'Deck',
      kind: 'deck',
      pieces: [
        { id: 'img-1.jpg', lines: [], image: 'img-1.jpg' },
        { id: 'img-2.jpg', lines: ['Title'], image: 'img-2.jpg' },
      ],
      background: null,
      websiteUrl: null,
      previous: false,
    });
    expect(
      buildFrame({ kind: 'slideshow', look, fileUrl, fontAvailable: true, snapshot: deck }),
    ).toMatchObject({
      picture: { url: '/files/img-2.jpg' },
      background: { color: '#000000', media: null },
      song: null,
    });
    expect(
      buildFrame({ kind: 'subtitle', look, fileUrl, fontAvailable: true, snapshot: deck }).picture,
    ).toBeNull();
    const blank = { ...deck, state: { ...deck.state, blank: true } };
    expect(
      buildFrame({ kind: 'slideshow', look, fileUrl, fontAvailable: true, snapshot: blank }),
    ).toMatchObject({
      blank: true,
      picture: null,
    });
  });

  it('shows only the background with nothing live, nothing presented, or the presentation ended', () => {
    const empty = buildFrame({
      kind: 'slideshow',
      look,
      fileUrl,
      fontAvailable: true,
      snapshot: null,
    });
    expect(empty.song).toBeNull();
    expect(empty.background.color).toBe('#112233');
    const ended = snapshot(null);
    ended.state = { ...ended.state, status: 'ended' };
    expect(
      buildFrame({ kind: 'slideshow', look, fileUrl, fontAvailable: true, snapshot: ended }).song,
    ).toBeNull();
  });
});
