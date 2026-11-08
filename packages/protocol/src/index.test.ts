import { describe, expect, it } from 'vitest';
import {
  CapabilitiesSchema,
  cleanSongFields,
  CoordinatorToFollowerSchema,
  FollowerToCoordinatorSchema,
  OBS_PROTOCOL_VERSION,
  ObsStateSchema,
  RemoteToHostSchema,
  DeckSchema,
  invalidSongFields,
  itemBadge,
  libraryTypeOf,
  SnapshotItemSchema,
  snapshotWithoutVideos,
  songBadge,
  SongFieldsSchema,
  maxSongYear,
  MIN_PROTOCOL_VERSION,
  negotiateProtocol,
  PROTOCOL_VERSION,
  SyncRecordSchema,
  updateNeededBy,
  websiteUrl,
  type LiveSnapshot,
} from './index';

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
        website: null,
        video: null,
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
      website: null,
      video: null,
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
      website: null,
      video: null,
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

describe('media records (media uploads plan)', () => {
  const fields = {
    title: 'Welcome',
    lyrics: '',
    author: '',
    copyright: '',
    ccli: null,
    year: null,
    background: null,
    deck: null,
    website: null,
  };
  const video = {
    file: 'video-0f8fad5b-d9cb-469f-a165-70867728950e.mp4',
    source: 'Welcome.mp4',
    width: 1920,
    height: 1080,
    durationSeconds: 42.5,
    bytes: 1000,
  };

  it('reads a song from before videos with none, and a video from before Autoplay with it off', () => {
    expect(SongFieldsSchema.parse(fields).video).toBeNull();
    expect(SongFieldsSchema.parse({ ...fields, video }).video).toEqual({
      ...video,
      autoplay: false,
    });
  });

  it('reads a deck without a kind, or with one it does not know, as slides', () => {
    const deck = { source: 'a.pptx', width: 1, height: 1, pages: [] };
    expect(DeckSchema.parse(deck).kind).toBeUndefined();
    expect(DeckSchema.parse({ ...deck, kind: 'hologram' }).kind).toBeUndefined();
    expect(DeckSchema.parse({ ...deck, kind: 'image' }).kind).toBe('image');
  });

  it('counts a video song as media (stored as `slides`), never songs or websites', () => {
    expect(libraryTypeOf('song', { video })).toBe('slides');
    expect(libraryTypeOf('songRevision', { video, deck: null, website: null })).toBe('slides');
    expect(libraryTypeOf('song', { video: null })).toBe('songs');
  });
});

describe('website addresses', () => {
  it('completes an address typed without a scheme', () => {
    expect(websiteUrl(' example.org/live ')).toBe('https://example.org/live');
    expect(websiteUrl('http://example.org')).toBe('http://example.org/');
    expect(websiteUrl('localhost:8080')).toBe('https://localhost:8080/');
  });

  it('rejects anything that is not a web address', () => {
    expect(websiteUrl('')).toBeNull();
    expect(websiteUrl('javascript:alert(1)')).toBeNull();
    expect(websiteUrl('file:///etc/passwd')).toBeNull();
    expect(websiteUrl('http://')).toBeNull();
  });
});

describe('a refused protocol version', () => {
  it('blames the server when it reported an older version than this app accepts', () => {
    expect(updateNeededBy(MIN_PROTOCOL_VERSION - 1)).toBe('server');
  });

  it('blames the app when the server is newer', () => {
    expect(updateNeededBy(PROTOCOL_VERSION + 1)).toBe('app');
  });

  it('blames the app when the server said nothing, as servers before this field were newer', () => {
    expect(updateNeededBy(undefined)).toBe('app');
    expect(updateNeededBy(null)).toBe('app');
    expect(updateNeededBy('1')).toBe('app');
  });
});

describe('speaking an older server’s version (D26)', () => {
  it('speaks the server’s version when it is older and still accepted', () => {
    expect(negotiateProtocol(MIN_PROTOCOL_VERSION)).toBe(MIN_PROTOCOL_VERSION);
  });

  it('speaks its own version to a server as new or newer', () => {
    expect(negotiateProtocol(PROTOCOL_VERSION)).toBe(PROTOCOL_VERSION);
    expect(negotiateProtocol(PROTOCOL_VERSION + 5)).toBe(PROTOCOL_VERSION);
  });

  it('speaks its own version to a server too old or saying nothing, which then refuses', () => {
    expect(negotiateProtocol(MIN_PROTOCOL_VERSION - 1)).toBe(PROTOCOL_VERSION);
    expect(negotiateProtocol(undefined)).toBe(PROTOCOL_VERSION);
    expect(negotiateProtocol('2')).toBe(PROTOCOL_VERSION);
    expect(negotiateProtocol(2.5)).toBe(PROTOCOL_VERSION);
  });

  it('keeps this version at least one above the oldest accepted, so negotiation has a range', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThan(MIN_PROTOCOL_VERSION);
  });

  it('speaks version 3 to a server not yet updated for OBS control', () => {
    expect(PROTOCOL_VERSION).toBe(5);
    expect(negotiateProtocol(3)).toBe(3);
    expect(negotiateProtocol(4)).toBe(4);
    expect(negotiateProtocol(3)).toBeLessThan(OBS_PROTOCOL_VERSION);
  });
});

describe('OBS messages (protocol version 4)', () => {
  const idle = { active: false, phase: null, durationMs: null, paused: false };
  const state = {
    ownerId: 'dev-a',
    ownerName: 'Streaming laptop',
    activatedAt: '2026-11-08T09:00:00.000Z',
    revision: 3,
    active: true,
    status: 'connected',
    scenes: ['Lyrics', '场景 2'],
    currentScene: 'Lyrics',
    favourites: ['Lyrics', null],
    stream: { active: true, phase: null, durationMs: 61_000, paused: false },
    record: idle,
    virtualCam: idle,
  };

  it('reads the OBS state both ways', () => {
    expect(ObsStateSchema.parse(state)).toEqual(state);
    expect(FollowerToCoordinatorSchema.parse({ type: 'obsState', state }).type).toBe('obsState');
    expect(CoordinatorToFollowerSchema.parse({ type: 'obsState', state: null })).toEqual({
      type: 'obsState',
      state: null,
    });
  });

  it('rejects a malformed state', () => {
    const bad = (patch: Record<string, unknown>) =>
      ObsStateSchema.safeParse({ ...state, ...patch }).success;
    expect(bad({ status: 'streaming' })).toBe(false);
    expect(bad({ scenes: [''] })).toBe(false);
    expect(bad({ favourites: ['Lyrics'] })).toBe(false);
    expect(bad({ revision: -1 })).toBe(false);
    expect(bad({ stream: { active: true } })).toBe(false);
    expect(bad({ ownerId: '' })).toBe(false);
  });

  it('takes commands that name the state wanted, never a toggle', () => {
    const command = (c: unknown) =>
      FollowerToCoordinatorSchema.safeParse({ type: 'obsCommand', id: 'c1', command: c }).success;
    expect(command({ type: 'setScene', scene: 'Camera' })).toBe(true);
    expect(command({ type: 'startStream' })).toBe(true);
    expect(command({ type: 'stopVirtualCam' })).toBe(true);
    expect(command({ type: 'toggleStream' })).toBe(false);
    expect(command({ type: 'setScene', scene: '' })).toBe(false);
    expect(
      RemoteToHostSchema.safeParse({
        type: 'obsCommand',
        id: 'p1',
        command: { type: 'stopRecord' },
      }).success,
    ).toBe(true);
    expect(RemoteToHostSchema.safeParse({ type: 'obsWatch', watching: true }).success).toBe(true);
  });

  it('carries answers with OBS’s code and comment', () => {
    expect(
      CoordinatorToFollowerSchema.parse({
        type: 'obsAck',
        id: 'c1',
        ok: false,
        code: 500,
        error: 'Output already running',
      }),
    ).toMatchObject({ code: 500 });
    expect(
      FollowerToCoordinatorSchema.safeParse({ type: 'obsAck', id: 'c1', ok: 'yes' }).success,
    ).toBe(false);
  });

  it('takes only small images as monitor snapshots, never another kind of address', () => {
    const snapshot = (image: string) =>
      CoordinatorToFollowerSchema.safeParse({ type: 'obsSnapshot', image, takenAt: 't' }).success;
    expect(snapshot('data:image/webp;base64,UklGRoY=')).toBe(true);
    expect(snapshot('data:image/jpg;base64,/9j/4AAQ')).toBe(true);
    expect(snapshot('javascript:alert(1)')).toBe(false);
    expect(snapshot('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(snapshot('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(snapshot('data:image/webp;base64,AAAA" onerror="x')).toBe(false);
    expect(snapshot(`data:image/webp;base64,${'A'.repeat(800_000)}`)).toBe(false);
  });

  it('still reads every version 3 message, with capabilities lacking `obs`', () => {
    const capabilities = { roles: ['coordinator'], appVersion: '1.4.1' };
    expect(CapabilitiesSchema.parse(capabilities).obs).toBeUndefined();
    expect(CapabilitiesSchema.parse({ ...capabilities, obs: true }).obs).toBe(true);
    for (const message of [
      {
        type: 'command',
        id: 'c',
        origin: { kind: 'operator', deviceId: 'd', name: 'n' },
        command: { type: 'next' },
      },
      { type: 'resync', have: 0 },
      { type: 'capabilities', capabilities },
      { type: 'phones', phones: [] },
    ]) {
      expect(FollowerToCoordinatorSchema.safeParse(message).success).toBe(true);
    }
    expect(CoordinatorToFollowerSchema.safeParse({ type: 'alive', revision: 4 }).success).toBe(
      true,
    );
  });
});

describe('record origins (D31)', () => {
  const record = { kind: 'song', id: 's1', key: 's1', revision: 1, updatedAt: 't', data: {} };

  it('reads records with and without an origin', () => {
    expect(SyncRecordSchema.parse(record).origin).toBeUndefined();
    expect(SyncRecordSchema.parse({ ...record, origin: 'church', shadow: true })).toMatchObject({
      origin: 'church',
      shadow: true,
    });
  });

  it('rejects an unknown origin', () => {
    expect(SyncRecordSchema.safeParse({ ...record, origin: 'elsewhere' }).success).toBe(false);
  });
});

describe('item badges (U12)', () => {
  const deck = (source: string, kind?: 'image') => ({
    source,
    ...(kind ? { kind } : {}),
    width: 1,
    height: 1,
    pages: [],
  });
  const none = { deck: null, website: null, video: null };

  it('marks a song by what it shows, and an ordinary song not at all', () => {
    expect(songBadge(none)).toBeNull();
    expect(songBadge({ ...none, deck: deck('a.pptx') })).toBe('slides');
    expect(songBadge({ ...none, deck: deck('a.PDF') })).toBe('pdf');
    expect(songBadge({ ...none, deck: deck('a.jpg', 'image') })).toBe('image');
    expect(songBadge({ ...none, website: { url: 'https://example.com' } })).toBe('website');
    expect(
      songBadge({
        deck: null,
        website: null,
        video: {
          file: 'v.mp4',
          source: 'v.mp4',
          width: 1,
          height: 1,
          durationSeconds: 1,
          bytes: 1,
          autoplay: false,
        },
      }),
    ).toBe('video');
  });

  it('takes an item’s badge, or one from its kind when an older device sent none', () => {
    expect(itemBadge({ kind: 'deck', badge: 'pdf' })).toBe('pdf');
    expect(itemBadge({ kind: 'deck' })).toBe('slides');
    expect(itemBadge({ kind: 'website' })).toBe('website');
    expect(itemBadge({ kind: 'video' })).toBe('video');
    expect(itemBadge({ kind: 'lyrics' })).toBeNull();
    expect(itemBadge({})).toBeNull();
  });

  it('reads a snapshot item without a badge, or with one it does not know', () => {
    const item = { itemId: 'i', songId: 's', title: 'T', removed: false, kind: 'deck', pieces: [] };
    expect(SnapshotItemSchema.parse(item).badge).toBeUndefined();
    expect(SnapshotItemSchema.parse({ ...item, badge: 'hologram' }).badge).toBeUndefined();
    expect(SnapshotItemSchema.parse({ ...item, badge: 'image' }).badge).toBe('image');
  });

  it('drops a video item’s badge for a device older than videos', () => {
    const snapshot = {
      items: [
        {
          itemId: 'v',
          songId: 's',
          title: 'V',
          removed: false,
          kind: 'video',
          badge: 'video',
          pieces: [],
        },
        {
          itemId: 'p',
          songId: 't',
          title: 'P',
          removed: false,
          kind: 'deck',
          badge: 'pdf',
          pieces: [],
        },
      ],
      presented: null,
    } as unknown as LiveSnapshot;
    const [video, pdf] = snapshotWithoutVideos(snapshot).items;
    expect(video?.kind).toBe('deck');
    expect(video?.badge).toBeUndefined();
    expect(pdf?.badge).toBe('pdf');
  });
});
