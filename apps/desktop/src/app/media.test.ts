import type { ServerInfo } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  dialogExtensions,
  isHeic,
  mediaKindOf,
  mediaOffer,
  megabytes,
  offerProblem,
  replacementKinds,
  sizeProblem,
  songMediaKind,
  titleFromFile,
} from './media';

const MB = 1024 * 1024;
const limits = { image: 25 * MB, deck: 200 * MB, video: 200 * MB };
const info = (extra: Partial<ServerInfo> = {}): ServerInfo => ({
  name: 'Church',
  protocolVersion: 5,
  minProtocolVersion: 2,
  decks: true,
  outputs: true,
  media: { images: true, videos: true, limits },
  ...extra,
});

describe('file kinds (U12, U25)', () => {
  it.each([
    ['talk.PPTX', 'slides'],
    ['Talk.Key', 'slides'],
    ['notes.pdf', 'pdf'],
    ['IMG.JPG', 'image'],
    ['a.jpeg', 'image'],
    ['a.webp', 'image'],
    ['a.gif', 'image'],
    ['a.mp4', 'video'],
    ['a.MOV', 'video'],
    ['a.m4v', 'video'],
    ['a.webm', 'video'],
    ['IMG_0001.heic', 'image'],
    ['IMG_0001.HEIF', 'image'],
    ['slides.pdf.mp4', 'video'],
    ['C:\\Users\\pat\\Videos\\Welcome.mp4', 'video'],
    ['/Users/pat/Movies/Welcome.mov', 'video'],
  ])('%s is %s', (name, kind) => {
    expect(mediaKindOf(name)).toBe(kind);
  });

  it.each(['notes.txt', 'letter.docx', 'README', 'name.', '.mp4', '/Users/pat/.mp4'])(
    '%s is nothing Worship Q can show',
    (name) => {
      expect(mediaKindOf(name)).toBeNull();
    },
  );

  it('knows which photos need converting', () => {
    expect(isHeic('IMG.HEIC')).toBe(true);
    expect(isHeic('a.heif')).toBe(true);
    expect(isHeic('a.jpg')).toBe(false);
  });

  it('offers the same formats in the file dialog', () => {
    expect(dialogExtensions(['video'])).toEqual(['mp4', 'm4v', 'mov', 'webm']);
    expect(dialogExtensions(['slides', 'pdf', 'image', 'video'])).toContain('heic');
  });
});

describe('sizes (U1, U2, U7)', () => {
  it('takes a file exactly at its limit and refuses one byte more', () => {
    expect(sizeProblem('video', 200 * MB, limits)).toBeNull();
    expect(sizeProblem('video', 200 * MB + 1, limits)).toContain('200.0 MB; this server');
  });

  it('refuses an empty file', () => {
    expect(sizeProblem('image', 0, limits)).toBe('This file is empty.');
  });

  it('names the kind, the size and the server’s limit', () => {
    expect(sizeProblem('video', 640 * MB, limits)).toBe(
      'This video is 640 MB; this server accepts up to 200 MB. Export a smaller version and try again.',
    );
    expect(sizeProblem('image', 30 * MB, limits)).toContain('This image is 30 MB');
    expect(sizeProblem('slides', 300 * MB, limits)).toContain('This slide deck is 300 MB');
    expect(sizeProblem('pdf', 300 * MB, limits)).toContain('This PDF is 300 MB');
    // A deck and a PDF share the deck limit; an image has its own.
    expect(sizeProblem('pdf', 30 * MB, limits)).toBeNull();
  });

  it('rounds the size and the limit the same way, never showing them equal', () => {
    expect(megabytes(640 * MB, 200 * MB)).toEqual(['640', '200']);
    expect(megabytes(200.2 * MB, 200 * MB)).toEqual(['200.2', '200.0']);
  });
});

describe('what the server offers (U19)', () => {
  it('reads the offer and limits from info', () => {
    expect(mediaOffer(info())).toMatchObject({ decks: true, images: true, videos: true, limits });
  });

  it('offers decks only on a server from before media, and says images need an update', () => {
    const older = mediaOffer(info({ media: undefined }));
    expect(offerProblem('slides', older)).toBeNull();
    expect(offerProblem('pdf', older)).toBeNull();
    expect(offerProblem('image', older)).toBe(
      'Images and videos need an update of your church’s server.',
    );
    expect(offerProblem('video', older)).toBe(
      'Images and videos need an update of your church’s server.',
    );
  });

  it('offers images on a server that cannot convert slides', () => {
    const offer = mediaOffer(info({ decks: false }));
    expect(offerProblem('image', offer)).toBeNull();
    expect(offerProblem('slides', offer)).toBe('Your church’s server cannot convert slides yet.');
  });

  it('offers nothing without a server', () => {
    expect(mediaOffer(null)).toBeNull();
    expect(offerProblem('slides', null)).toContain('Connect to your church’s server');
  });
});

describe('titles and kinds of songs', () => {
  it('titles an item after its file, without the extension', () => {
    expect(titleFromFile('/x/Welcome video.mp4')).toBe('Welcome video');
    expect(titleFromFile('C:\\x\\主日.pptx')).toBe('主日');
    expect(titleFromFile('.mp4')).toBe('Untitled');
    expect(titleFromFile('a.b.jpg')).toBe('a.b');
  });

  it('tells a song’s media kind, from before kinds too', () => {
    const deck = (source: string, kind?: 'image') => ({
      source,
      ...(kind ? { kind } : {}),
      width: 1,
      height: 1,
      pages: [],
    });
    const none = { website: null, video: null };
    expect(songMediaKind({ ...none, deck: deck('a.pptx') })).toBe('slides');
    expect(songMediaKind({ ...none, deck: deck('a.PDF') })).toBe('pdf');
    expect(songMediaKind({ ...none, deck: deck('a.jpg', 'image') })).toBe('image');
    expect(songMediaKind({ ...none, deck: null })).toBeNull();
    expect(
      songMediaKind({
        website: null,
        deck: null,
        video: {
          file: 'video-x.mp4',
          source: 'a.mp4',
          width: 1,
          height: 1,
          durationSeconds: 1,
          bytes: 1,
          autoplay: false,
        },
      }),
    ).toBe('video');
  });

  it('replaces a deck kind with any deck kind, and a video only with a video (U26)', () => {
    expect(replacementKinds('pdf')).toEqual(['slides', 'pdf', 'image']);
    expect(replacementKinds('video')).toEqual(['video']);
  });
});
