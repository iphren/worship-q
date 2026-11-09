import { createLiveState } from '@worship-q/live-state';
import type { LiveSnapshot, OutputView } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildFrame, missingFonts } from './frame';
import { drifted, videoTarget } from './Slide';

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

  it('puts a song’s own background in place of the look’s, with its file when one is known', () => {
    const presented: LiveSnapshot['presented'] = {
      itemId: 'i1',
      pieceId: 'p1',
      songId: 's1',
      title: 'Song',
      kind: 'lyrics',
      pieces: [{ id: 'p1', lines: ['one'] }],
      background: { color: '#445566', assetId: 'bg2' },
      websiteUrl: null,
      previous: false,
    };
    const input = { kind: 'slideshow' as const, look, fileUrl, fontAvailable: true };
    expect(buildFrame({ ...input, snapshot: snapshot(presented) }).background).toEqual({
      color: '#445566',
      media: null,
    });
    expect(
      buildFrame({
        ...input,
        snapshot: snapshot(presented),
        songBackground: { kind: 'video', fileName: 'waves.mp4' },
      }).background,
    ).toEqual({ color: '#445566', media: { kind: 'video', url: '/files/waves.mp4' } });
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

describe('video items (media uploads M5.4, M5.5, M6.3)', () => {
  const file = 'video-0f8fad5b-d9cb-469f-a165-70867728950e.mp4';
  const presented: LiveSnapshot['presented'] = {
    itemId: 'v1',
    pieceId: 'video',
    songId: 's1',
    title: 'Welcome',
    kind: 'video',
    pieces: [
      {
        id: 'video',
        lines: ['1:30'],
        video: { file, durationSeconds: 90, width: 1920, height: 1080, autoplay: false },
      },
    ],
    background: { color: '#ff0000', assetId: null },
    websiteUrl: null,
    previous: false,
  };
  const clock = {
    itemId: 'v1',
    playing: true,
    position: 12,
    at: '2026-10-11T09:00:05.000Z',
    durationSeconds: 90,
    resumeOnUnblank: false,
  };
  const withClock = (blank = false): LiveSnapshot => {
    const base = snapshot(presented, blank);
    return { ...base, state: { ...base.state, video: clock } };
  };

  it('plays the video on the slideshow, on black, with the live state’s clock', () => {
    const frame = buildFrame({
      kind: 'slideshow',
      look,
      fileUrl,
      fontAvailable: true,
      snapshot: withClock(),
    });
    expect(frame).toMatchObject({
      song: null,
      picture: null,
      pieceId: 'video',
      background: { color: '#000000', media: null },
      video: { url: `/files/${file}`, playing: true, position: 12, durationSeconds: 90 },
    });
  });

  it('shows nothing on the subtitle overlay', () => {
    const frame = buildFrame({
      kind: 'subtitle',
      look,
      fileUrl,
      fontAvailable: true,
      snapshot: withClock(),
    });
    expect(frame.video ?? null).toBeNull();
    expect(frame.song).toBeNull();
  });

  it('keeps the video while blank, for the slideshow to hide', () => {
    const frame = buildFrame({
      kind: 'slideshow',
      look,
      fileUrl,
      fontAvailable: true,
      snapshot: withClock(true),
    });
    expect(frame.blank).toBe(true);
    expect(frame.background).toEqual({ color: '#000000', media: null });
  });
});

describe('following the live clock (M6.3)', () => {
  const video = {
    url: 'v.mp4',
    playing: true,
    position: 10,
    at: '2026-10-11T09:00:00.000Z',
    durationSeconds: 60,
  };
  const t = (seconds: number) => Date.parse(video.at) + seconds * 1000;

  it('moves a playing video on with the clock, never past its end', () => {
    expect(videoTarget(video, t(5))).toBe(15);
    expect(videoTarget(video, t(500))).toBe(60);
    expect(videoTarget({ ...video, playing: false }, t(5))).toBe(10);
  });

  it('moves the player only when it drifts more than half a second', () => {
    expect(drifted(10.4, 10)).toBe(false);
    expect(drifted(10.6, 10)).toBe(true);
    expect(drifted(9.4, 10)).toBe(true);
  });
});

describe('passage frames (P6.2)', () => {
  const columns = [
    {
      version: 'NIVUK',
      credit: 'NIVUK',
      units: [{ label: '5', lines: [{ text: 'But Jesus', indent: 0 }] }],
    },
    {
      version: 'CCB',
      credit: '当代译本',
      units: [{ label: '5', lines: [{ text: '耶稣', indent: 0 }] }],
    },
  ];
  const presented = (blank = false) =>
    snapshot(
      {
        itemId: 'i1',
        pieceId: 'v15:5',
        songId: 's1',
        title: 'Mark 15:5',
        kind: 'passage',
        pieces: [{ id: 'v15:5', lines: ['5 But Jesus'], passage: { columns } }],
        background: { color: '#203040', assetId: null },
        websiteUrl: null,
        previous: false,
      },
      blank,
    );
  const frame = (kind: 'slideshow' | 'subtitle', blank = false) =>
    buildFrame({ kind, look, fileUrl, fontAvailable: true, snapshot: presented(blank) });

  it('draws a passage on the slideshow, side by side, on the song’s background', () => {
    const shown = frame('slideshow');
    // Under the whole passage's reference, the item's title.
    expect(shown.passage).toEqual({ columns, headers: ['Mark 15:5'] });
    expect(shown.pieceId).toBe('v15:5');
    expect(shown.song).toBeNull();
    expect(shown.background.color).toBe('#203040');
  });

  it('draws nothing on the subtitle overlay', () => {
    const shown = frame('subtitle');
    expect(shown.passage ?? null).toBeNull();
    expect(shown.song).toBeNull();
  });

  it('hides it while blank', () => {
    expect(frame('slideshow', true).passage ?? null).toBeNull();
  });
});
