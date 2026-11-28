/**
 * What an assistant may do to run sheets and songs (MCP plan, C5–C9), without the MCP
 * transport: workspace reach, songs, matching, edits, run sheet changes, passages, websites,
 * and that every write reaches desktops as a desktop's own push would.
 */
import { CATALOGUE, type PassageText, type Reference } from '@worship-q/bible';
import { PROTOCOL_VERSION, type ChurchSettings, type SyncRecord } from '@worship-q/protocol';
import { createLiveState } from '@worship-q/live-state';
import { describe, expect, it } from 'vitest';
import { BibleError } from '../bible';
import { openDatabase } from '../db';
import { Instance } from '../instance';
import {
  MAX_ITEMS_PER_CALL,
  McpContent,
  McpToolError,
  normalizeLyrics,
  titleKey,
  validDate,
  type McpBible,
} from './content';

function clock(start = '2026-11-28T09:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now).toISOString(), advance: (ms: number) => (now += ms) };
}

const text = (version: string, verses: number[], fums: string | null = null): PassageText => ({
  version,
  credit: version,
  provider: 'youversion',
  copyright: `© ${version}`,
  units: verses.map((verse) => ({
    chapter: 3,
    verses: [verse],
    label: String(verse),
    lines: [{ text: `Verse ${verse} in ${version}`, indent: 0 }],
  })),
  fumsToken: fums,
});

/** A Bible whose passages are made up; some books stand for each way a fetch fails. */
function fakeBible() {
  const fetched: string[] = [];
  const reported: string[][] = [];
  const bible: McpBible = {
    offered: (church: ChurchSettings) =>
      CATALOGUE.filter((v) => (church.bibleVersions ?? []).includes(v.id)),
    passages: {
      async get(version: string, reference: Reference) {
        fetched.push(`${version}:${reference.book}`);
        if (reference.book === 'OBA') throw new BibleError('not-found', 'no such verse');
        if (reference.book === 'PSA') throw new BibleError('too-large', 'too long');
        if (reference.book === 'JUD') throw new BibleError('unavailable', 'down');
        const verses: number[] = [];
        for (let v = reference.verse ?? 1; v <= (reference.endVerse ?? 3); v++) {
          verses.push(v);
        }
        return text(version, verses, version === 'NIVUK' ? 'fums-token' : null);
      },
    },
    fums: { report: (tokens) => void reported.push(tokens) },
  };
  return { bible, fetched, reported };
}

function setup() {
  const time = clock();
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const north = instance.createWorkspace('North').workspace;
  const south = instance.createWorkspace('South').workspace;
  const central = instance.createWorkspace('Central').workspace;
  instance.setLibraryTypes(central.id, ['songs']);
  instance.setChurchSetting('bibleVersions', ['NIVUK', 'CUNP-S', 'ESV']);
  const notified: string[] = [];
  const relay = {
    contentChanged: (workspaceId: string) => void notified.push(workspaceId),
    contentChangedAll: () => void notified.push('*'),
  };
  const fake = fakeBible();
  const user = instance.mcp.addUser(
    'sam@example.org',
    { allWorkspaces: false, workspaceIds: [north.id, central.id] },
    null,
  );
  const content = (userId = user.id) =>
    new McpContent({ instance, relay, bible: fake.bible }, instance.mcp.getUser(userId)!);

  /** A song as a desktop pushes it. */
  const desktopSong = (
    workspaceId: string,
    title: string,
    extra: Record<string, unknown> = {},
    updatedAt = time.now(),
  ) => {
    const id = crypto.randomUUID();
    const record: SyncRecord = {
      kind: 'song',
      id,
      key: id,
      revision: 1,
      updatedAt,
      data: {
        title,
        lyrics: 'Line one\nLine two\n\nLine three',
        lineIds: ['a', 'b', 'c'],
        author: 'Someone',
        copyright: '',
        ccli: null,
        year: null,
        background: null,
        deck: null,
        website: null,
        video: null,
        passage: null,
        createdAt: updatedAt,
        removedAt: null,
        ...extra,
      },
    };
    instance.push(workspaceId, 'desktop', [record]);
    return id;
  };
  /** A church song, as the managing workspace's desktop pushes it. */
  const churchSong = (title: string, extra: Record<string, unknown> = {}) =>
    desktopSong(central.id, title, extra);

  const desktopRunSheet = (
    workspaceId: string,
    date: string,
    songIds: string[],
    updatedAt = time.now(),
  ) => {
    const id = crypto.randomUUID();
    instance.push(workspaceId, 'desktop', [
      {
        kind: 'runSheet',
        id,
        key: date,
        revision: 3,
        updatedAt,
        data: {
          date,
          createdAt: updatedAt,
          items: songIds.map((songId) => ({
            id: crypto.randomUUID(),
            songId,
            revision: 1,
            createdAt: updatedAt,
            updatedAt,
          })),
        },
      },
    ]);
    return id;
  };

  const pulled = (workspaceId: string) =>
    instance.pull(workspaceId, 0, 500, PROTOCOL_VERSION).records;

  return {
    instance,
    time,
    north,
    south,
    central,
    notified,
    user,
    content,
    fake,
    desktopSong,
    churchSong,
    desktopRunSheet,
    pulled,
  };
}

async function refusal(work: () => unknown): Promise<McpToolError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof McpToolError) return error;
    throw error;
  }
  throw new Error('Expected a refusal');
}

describe('helpers', () => {
  it('accepts only real dates', () => {
    expect(validDate('2026-11-28')).toBe(true);
    expect(validDate('2028-02-29')).toBe(true);
    expect(validDate('2026-02-30')).toBe(false);
    expect(validDate('2026-13-01')).toBe(false);
    expect(validDate('28/11/2026')).toBe(false);
    expect(validDate('2026-1-5')).toBe(false);
    expect(validDate(20261128)).toBe(false);
  });

  it('tidies lyrics as the app keeps them', () => {
    expect(normalizeLyrics('\r\n\r\nA  \r\nB\t\r\n\r\n\r\n\r\nC　\n\n')).toBe('A\nB\n\nC');
  });

  it('folds titles across scripts, case and punctuation', () => {
    expect(titleKey('奇異恩典')).toBe(titleKey('奇异恩典'));
    expect(titleKey('Amazing Grace!')).toBe(titleKey('amazing grace'));
    expect(titleKey('10,000 Reasons (Bless the Lord)')).toBe(
      titleKey('10000 reasons bless the lord'),
    );
    expect(titleKey('Amazing Grace')).not.toBe(titleKey('Amazing Love'));
  });
});

describe('workspaces', () => {
  it('reaches only the workspaces given, by id or name', () => {
    const { content, north, south } = setup();
    const c = content();
    expect(c.listWorkspaces().map((w) => w.name)).toEqual(['North', 'Central']);
    expect(c.workspace(north.id).id).toBe(north.id);
    expect(c.workspace('north').id).toBe(north.id);
    // One out of reach reads as one that does not exist.
    expect(() => c.workspace(south.id)).toThrow(McpToolError);
    expect(() => c.workspace('South')).toThrow(/No workspace/);
    expect(() => c.workspace('nonexistent')).toThrow(/No workspace/);
  });

  it('asks which workspace when there are several and none was named', async () => {
    const { content } = setup();
    expect((await refusal(() => content().workspace(undefined))).code).toBe('workspace-required');
  });

  it('uses the only workspace when the user has one', () => {
    const { instance, content, user, north } = setup();
    instance.mcp.updateUser(user.id, { allWorkspaces: false, workspaceIds: [north.id] });
    expect(content().workspace(undefined).id).toBe(north.id);
  });

  it('refuses everything when the user has no workspaces', async () => {
    const { instance, content, user } = setup();
    instance.mcp.updateUser(user.id, { allWorkspaces: false, workspaceIds: [] });
    expect((await refusal(() => content().listRunSheets(undefined))).code).toBe('no-workspaces');
    expect(content().listWorkspaces()).toEqual([]);
  });

  it('includes workspaces made later when given all of them', () => {
    const { instance, content, user } = setup();
    instance.mcp.updateUser(user.id, { allWorkspaces: true, workspaceIds: [] });
    instance.createWorkspace('Later');
    expect(
      content()
        .listWorkspaces()
        .map((w) => w.name),
    ).toEqual(['North', 'South', 'Central', 'Later']);
  });

  it('tells today and the next meeting date in the workspace’s timezone', () => {
    const { instance, content, north, time } = setup();
    instance.push(north.id, 'desktop', [
      {
        kind: 'workspace',
        id: north.id,
        key: north.id,
        revision: 2,
        updatedAt: time.now(),
        data: { name: 'North', timezone: 'Pacific/Auckland', meetingDays: [0] },
      },
    ]);
    // 09:00 UTC on Saturday 28 November is 22:00 the same day in Auckland (UTC+13).
    const [info] = content().listWorkspaces();
    expect(info).toMatchObject({
      timezone: 'Pacific/Auckland',
      today: '2026-11-28',
      todayWeekday: 'Saturday',
      meetingDays: ['Sunday'],
      nextMeetingDate: '2026-11-29',
      bibleVersions: ['NIVUK'],
    });
  });

  it('falls back to UTC for a timezone it does not know', () => {
    const { instance, content, north, time } = setup();
    instance.push(north.id, 'desktop', [
      {
        kind: 'workspace',
        id: north.id,
        key: north.id,
        revision: 2,
        updatedAt: time.now(),
        data: { name: 'North', timezone: 'Mars/Olympus', meetingDays: [6] },
      },
    ]);
    expect(content().listWorkspaces()[0]).toMatchObject({
      timezone: 'UTC',
      nextMeetingDate: '2026-11-28',
    });
  });
});

describe('songs', () => {
  it('creates a song with line identities and a revision, and desktops receive it', () => {
    const { content, north, pulled, notified } = setup();
    const made = content().createSong(north.id, {
      title: '  Amazing Grace ',
      lyrics: 'Amazing grace\r\nhow sweet the sound\r\n\r\n\r\nThat saved a wretch',
      author: 'John Newton',
      ccli: '22025',
      year: 1779,
    });
    expect(made).toMatchObject({ title: 'Amazing Grace', revision: 1, inChurchLibrary: false });
    const records = pulled(north.id);
    const song = records.find((r) => r.kind === 'song')!;
    expect(song.id).toBe(made.songId);
    expect(song.data).toMatchObject({
      title: 'Amazing Grace',
      lyrics: 'Amazing grace\nhow sweet the sound\n\nThat saved a wretch',
      author: 'John Newton',
      ccli: '22025',
      year: 1779,
      deck: null,
      website: null,
      removedAt: null,
    });
    expect(song.data.lineIds).toHaveLength(3);
    const revision = records.find((r) => r.kind === 'songRevision')!;
    expect(revision.data).toMatchObject({
      songId: made.songId,
      revision: 1,
      title: 'Amazing Grace',
    });
    expect(notified).toEqual([north.id]);
  });

  it('puts a new song in the Church Library from a workspace that manages songs', () => {
    const { content, central, instance, notified, north, pulled } = setup();
    const made = content().createSong(central.id, { title: 'Shared', lyrics: 'One' });
    expect(made.inChurchLibrary).toBe(true);
    expect(
      instance.db
        .prepare(`SELECT 1 FROM church_record WHERE kind = 'song' AND key = ?`)
        .get(made.songId),
    ).toBeDefined();
    expect(notified).toEqual(['*']);
    // Every workspace's devices receive it.
    expect(pulled(north.id).some((r) => r.id === made.songId)).toBe(true);
  });

  it('refuses a song that is already there, in either script or with other punctuation', async () => {
    const { content, north, desktopSong, churchSong } = setup();
    desktopSong(north.id, '奇異恩典');
    churchSong('Amazing Grace (My Chains Are Gone)');
    const c = content();
    const traditional = await refusal(() =>
      c.createSong(north.id, { title: '奇异恩典', lyrics: 'x' }),
    );
    expect(traditional.code).toBe('duplicate-song');
    expect(traditional.detail.existing).toEqual([expect.objectContaining({ title: '奇異恩典' })]);
    const church = await refusal(() =>
      c.createSong(north.id, { title: 'amazing grace - my chains are gone', lyrics: 'x' }),
    );
    expect(church.code).toBe('duplicate-song');
    // A different song that happens to share the title may still be added.
    expect(
      c.createSong(north.id, { title: '奇异恩典', lyrics: 'x', allowDuplicate: true }).songId,
    ).toBeTruthy();
  });

  it('does not count deleted songs, hidden church songs or passages as duplicates', () => {
    const { content, north, desktopSong, churchSong, time, instance } = setup();
    desktopSong(north.id, 'Gone', { removedAt: time.now() });
    const hidden = churchSong('Hidden');
    // North hides the church's song: its own record under the same key, removed.
    instance.push(north.id, 'desktop', [
      {
        kind: 'song',
        id: hidden,
        key: hidden,
        revision: 2,
        updatedAt: new Date(Date.parse(time.now()) + 5).toISOString(),
        data: { title: 'Hidden', lyrics: '', removedAt: time.now() },
      },
    ]);
    desktopSong(north.id, 'John 3:16', {
      passage: { reference: 'JHN.3.16', texts: [text('NIVUK', [16])] },
    });
    const c = content();
    expect(c.createSong(north.id, { title: 'Gone', lyrics: 'x' }).songId).toBeTruthy();
    expect(c.createSong(north.id, { title: 'Hidden', lyrics: 'x' }).songId).toBeTruthy();
    expect(c.createSong(north.id, { title: 'John 3:16', lyrics: 'x' }).songId).toBeTruthy();
  });

  it('checks what it is given', async () => {
    const { content, north } = setup();
    const c = content();
    const codes = async (input: Parameters<McpContent['createSong']>[1]) =>
      (await refusal(() => c.createSong(north.id, input))).message;
    expect(await codes({ title: '  ', lyrics: 'x' })).toMatch(/title/);
    expect(await codes({ title: 'T', lyrics: '\n \n' })).toMatch(/lyrics/);
    expect(await codes({ title: 'x'.repeat(201), lyrics: 'x' })).toMatch(/200/);
    expect(await codes({ title: 'T', lyrics: 'x', ccli: '12-34' })).toMatch(/ccli/);
    expect(await codes({ title: 'T', lyrics: 'x', year: 2028 })).toMatch(/year/);
    expect(await codes({ title: 'T', lyrics: 'x', year: 0 })).toMatch(/year/);
    // A CCLI number written as people do is read as its digits; next year is allowed.
    const made = c.createSong(north.id, {
      title: 'T',
      lyrics: 'x',
      ccli: 'CCLI #7004',
      year: 2027,
    });
    expect(c.getSong(north.id, made.songId)).toMatchObject({ ccli: '7004', year: 2027 });
  });

  it('strips control characters from what it stores', () => {
    const { content, north } = setup();
    const made = content().createSong(north.id, {
      title: 'Bad\u0007 Title',
      lyrics: 'A\u007f line',
    });
    expect(content().getSong(north.id, made.songId)).toMatchObject({
      title: 'Bad Title',
      lyrics: 'A line',
    });
  });

  it('searches the workspace’s library like the app, and leaves out what it does not show', () => {
    const { content, north, south, desktopSong, churchSong, time, instance } = setup();
    desktopSong(north.id, '主祢是我力量');
    churchSong('Amazing Grace');
    const hidden = churchSong('Hidden Church Song');
    // The workspace hides a church song by storing it removed under the same key.
    desktopSong(south.id, 'South Only');
    desktopSong(north.id, 'Deleted Song', { removedAt: time.now() });
    desktopSong(north.id, 'Mark 1:1', {
      passage: { reference: 'MRK.1.1', texts: [text('NIVUK', [1])] },
    });
    const c = content();
    // Hide by writing the church song removed in North.
    instance.push(north.id, 'desktop', [
      {
        kind: 'song',
        id: hidden,
        key: hidden,
        revision: 2,
        updatedAt: new Date(Date.parse(time.now()) + 5).toISOString(),
        data: { title: 'Hidden Church Song', lyrics: '', removedAt: time.now() },
      },
    ]);
    const titles = (q: string) => c.searchSongs(north.id, q).songs.map((s) => s.title);
    expect(titles('zhu ni')).toEqual(['主祢是我力量']); // pinyin
    expect(titles('主你')).toEqual(['主祢是我力量']); // variant characters
    expect(titles('grace')).toEqual(['Amazing Grace']); // church songs
    expect(titles('hidden')).toEqual([]);
    expect(titles('south')).toEqual([]);
    expect(titles('deleted')).toEqual([]);
    expect(titles('mark')).toEqual([]);
    expect(titles('').sort()).toEqual(['Amazing Grace', '主祢是我力量']);
  });

  it('limits search results', () => {
    const { content, north, desktopSong } = setup();
    for (let i = 0; i < 60; i++) desktopSong(north.id, `Song ${i}`);
    const result = content().searchSongs(north.id, 'song', 500);
    expect(result.total).toBe(60);
    expect(result.songs).toHaveLength(50);
  });

  it('matches a list of titles as exact, likely or none', () => {
    const { content, north, desktopSong, churchSong } = setup();
    desktopSong(north.id, '恩典之路');
    churchSong('Way Maker');
    churchSong('Goodness of God');
    const { matches } = content().matchSongs(north.id, [
      '恩典之路',
      'way maker!',
      'Goodness',
      'Brand New Song',
    ]);
    expect(matches.map((m) => m.match)).toEqual(['exact', 'exact', 'likely', 'none']);
    expect(matches[2]!.candidates[0]).toMatchObject({ title: 'Goodness of God', kind: 'song' });
    expect(matches[3]!.candidates).toEqual([]);
  });

  it('refuses too many titles at once', async () => {
    const { content, north } = setup();
    expect((await refusal(() => content().matchSongs(north.id, Array(31).fill('x')))).code).toBe(
      'too-many-items',
    );
  });

  it('reads a song, but not one from a workspace out of reach', async () => {
    const { content, north, south, desktopSong } = setup();
    const id = desktopSong(north.id, 'Here');
    const elsewhere = desktopSong(south.id, 'There');
    expect(content().getSong(north.id, id)).toMatchObject({
      songId: id,
      title: 'Here',
      revision: 1,
      lyrics: 'Line one\nLine two\n\nLine three',
      inChurchLibrary: false,
      editable: true,
    });
    expect((await refusal(() => content().getSong(north.id, elsewhere))).code).toBe(
      'song-not-found',
    );
    expect((await refusal(() => content().getSong(south.id, elsewhere))).code).toBe(
      'workspace-not-found',
    );
  });
});

describe('editing songs', () => {
  it('edits a song, keeping the identity of the lines it did not change', () => {
    const { content, north, desktopSong, pulled, instance } = setup();
    const id = desktopSong(north.id, 'Old Title');
    const result = content().updateSong(north.id, id, 1, {
      title: 'New Title',
      lyrics: 'Line one\nLine two\n\nLine three\nLine four',
    });
    expect(result).toEqual({ songId: id, revision: 2, changed: true, workspaceVersion: false });
    const song = pulled(north.id).find((r) => r.kind === 'song' && r.id === id)!;
    expect(song.revision).toBe(2);
    expect(song.data).toMatchObject({ title: 'New Title', author: 'Someone' });
    expect((song.data.lineIds as string[]).slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect(song.data.lineIds).toHaveLength(4);
    const history = instance.records(north.id, 'songRevision').map((r) => r.record.data.revision);
    expect(history).toEqual([2]);
  });

  it('refuses an edit based on an old revision', async () => {
    const { content, north, desktopSong } = setup();
    const id = desktopSong(north.id, 'Song');
    content().updateSong(north.id, id, 1, { author: 'A' });
    const conflict = await refusal(() => content().updateSong(north.id, id, 1, { author: 'B' }));
    expect(conflict.code).toBe('revision-conflict');
    expect(conflict.detail).toEqual({ revision: 2 });
  });

  it('changes nothing when nothing differs', () => {
    const { content, north, desktopSong, notified } = setup();
    const id = desktopSong(north.id, 'Song');
    notified.length = 0;
    expect(
      content().updateSong(north.id, id, 1, { title: ' Song ', author: 'Someone' }),
    ).toMatchObject({
      changed: false,
      revision: 1,
    });
    expect(notified).toEqual([]);
  });

  it('makes the workspace’s own version of a church song in a workspace that does not manage songs', () => {
    const { content, north, south, churchSong, instance, pulled } = setup();
    const id = churchSong('Church Song');
    const result = content().updateSong(north.id, id, 1, { lyrics: 'Our words' });
    expect(result).toMatchObject({ revision: 2, workspaceVersion: true });
    // The church's is untouched; North has its own.
    const church = instance.db.prepare(`SELECT data FROM church_record WHERE key = ?`).get(id)!;
    expect(JSON.parse(String(church.data)).lyrics).toBe('Line one\nLine two\n\nLine three');
    expect(content().getSong(north.id, id)).toMatchObject({
      lyrics: 'Our words',
      inChurchLibrary: false,
      hasWorkspaceVersion: true,
    });
    // Other workspaces keep the church's.
    expect(pulled(south.id).find((r) => r.id === id)?.data.lyrics).toBe(
      'Line one\nLine two\n\nLine three',
    );
  });

  it('edits the church’s song from the workspace that manages songs', () => {
    const { content, central, churchSong, instance, notified } = setup();
    const id = churchSong('Church Song');
    notified.length = 0;
    const result = content().updateSong(central.id, id, 1, { title: 'Renamed' });
    expect(result).toMatchObject({ workspaceVersion: false, revision: 2 });
    const church = instance.db.prepare(`SELECT data FROM church_record WHERE key = ?`).get(id)!;
    expect(JSON.parse(String(church.data)).title).toBe('Renamed');
    expect(notified).toEqual(['*']);
  });

  it('edits the workspace’s version, switching to it, while the church’s is in use', () => {
    const { content, north, churchSong, instance, time } = setup();
    const id = churchSong('Church Song');
    instance.push(north.id, 'desktop', [
      {
        kind: 'song',
        id,
        key: id,
        revision: 2,
        updatedAt: new Date(Date.parse(time.now()) + 10).toISOString(),
        data: {
          title: 'Ours',
          lyrics: 'Our words',
          lineIds: ['z'],
          useChurchVersion: true,
          removedAt: null,
        },
      },
    ]);
    // The workspace shows the church's version.
    const shown = content().getSong(north.id, id);
    expect(shown).toMatchObject({ title: 'Church Song', revision: 1, inChurchLibrary: true });
    const result = content().updateSong(north.id, id, 1, { author: 'Edited' });
    expect(result.revision).toBe(3);
    expect(content().getSong(north.id, id)).toMatchObject({
      title: 'Church Song',
      author: 'Edited',
      inChurchLibrary: false,
    });
    const own = instance.db
      .prepare(`SELECT data FROM record WHERE workspace_id = ? AND key = ?`)
      .get(north.id, id)!;
    expect(JSON.parse(String(own.data)).useChurchVersion).toBe(false);
  });

  it('wins over a record from a desktop whose clock runs ahead', () => {
    const { content, north, desktopSong } = setup();
    const id = desktopSong(north.id, 'Song', {}, '2026-11-28T12:00:00.000Z');
    content().updateSong(north.id, id, 1, { title: 'Edited' });
    expect(content().getSong(north.id, id)).toMatchObject({ title: 'Edited', revision: 2 });
    expect(content().getSong(north.id, id).updatedAt > '2026-11-28T12:00:00.000Z').toBe(true);
  });

  it('refuses to edit passages, websites, slides, videos and deleted songs', async () => {
    const { content, north, desktopSong, time } = setup();
    const website = desktopSong(north.id, 'Site', { website: { url: 'https://example.org/' } });
    const passage = desktopSong(north.id, 'John 3:16', {
      passage: { reference: 'JHN.3.16', texts: [text('NIVUK', [16])] },
    });
    const deck = desktopSong(north.id, 'Deck', {
      deck: {
        id: crypto.randomUUID(),
        kind: 'pptx',
        pages: [{ image: 'a.jpg', thumbnail: 'a-t.jpg' }],
      },
    });
    const removed = desktopSong(north.id, 'Gone', { removedAt: time.now() });
    for (const id of [website, passage, deck]) {
      expect(
        (await refusal(() => content().updateSong(north.id, id, 1, { title: 'X' }))).code,
      ).toBe('not-editable');
    }
    expect(
      (await refusal(() => content().updateSong(north.id, removed, 1, { title: 'X' }))).code,
    ).toBe('song-not-found');
  });

  it('carries on the revision past the song’s history', () => {
    const { content, north, desktopSong, instance, time } = setup();
    const id = desktopSong(north.id, 'Song');
    // History from another device already reached revision 5.
    instance.push(north.id, 'desktop', [
      {
        kind: 'songRevision',
        id: 'r5',
        key: 'r5',
        revision: 1,
        updatedAt: time.now(),
        data: { songId: id, revision: 5, title: 'Song', lyrics: '' },
      },
    ]);
    expect(content().updateSong(north.id, id, 1, { title: 'Edited' }).revision).toBe(6);
  });
});

describe('run sheets', () => {
  it('adds songs to a date with no run sheet, which desktops then receive', async () => {
    const { content, north, desktopSong, pulled, notified } = setup();
    const a = desktopSong(north.id, 'A');
    const b = desktopSong(north.id, 'B');
    notified.length = 0;
    const result = await content().addToRunSheet(north.id, '2026-11-29', [
      { song: a },
      { song: b },
    ]);
    expect(result.items.map((i) => i.title)).toEqual(['A', 'B']);
    expect(result.addedItemIds).toHaveLength(2);
    const sheet = pulled(north.id).find((r) => r.kind === 'runSheet')!;
    expect(sheet.key).toBe('2026-11-29');
    // Past 1, so it is not taken for a run sheet a device only opened.
    expect(sheet.revision).toBeGreaterThanOrEqual(2);
    expect((sheet.data.items as { songId: string }[]).map((i) => i.songId)).toEqual([a, b]);
    expect(notified).toEqual([north.id]);
    expect(content().getRunSheet(north.id, '2026-11-29')).toMatchObject({
      exists: true,
      live: false,
    });
  });

  it('keeps the identifiers of items already there, and places new ones where asked', async () => {
    const { content, north, desktopSong, desktopRunSheet, instance } = setup();
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((t) => desktopSong(north.id, t));
    const runSheetId = desktopRunSheet(north.id, '2026-11-29', [a!, b!]);
    const before = content().getRunSheet(north.id, '2026-11-29');
    const [first, second] = before.items.map((i) => i.itemId);
    await content().addToRunSheet(north.id, '2026-11-29', [{ song: c! }], first);
    await content().addToRunSheet(north.id, '2026-11-29', [{ song: d! }], 'start');
    const after = content().getRunSheet(north.id, '2026-11-29');
    expect(after.items.map((i) => i.title)).toEqual(['D', 'A', 'C', 'B']);
    expect(after.items[1]!.itemId).toBe(first);
    expect(after.items[3]!.itemId).toBe(second);
    expect(after.revision).toBe(5);
    const stored = instance.db
      .prepare(`SELECT id FROM record WHERE kind = 'runSheet' AND key = '2026-11-29'`)
      .get();
    expect(stored?.id).toBe(runSheetId);
  });

  it('adds nothing when one item fails', async () => {
    const { content, north, desktopSong, desktopRunSheet, fake } = setup();
    const a = desktopSong(north.id, 'A');
    desktopRunSheet(north.id, '2026-11-29', [a]);
    const failed = await refusal(() =>
      content().addToRunSheet(north.id, '2026-11-29', [
        { passage: 'John 3:16' },
        { website: 'https://example.org' },
        { song: 'not-a-song' },
      ]),
    );
    expect(failed.code).toBe('song-not-found');
    expect(content().getRunSheet(north.id, '2026-11-29').items).toHaveLength(1);
    // The website was not made either.
    expect(content().searchSongs(north.id, 'example').songs).toEqual([]);
    void fake;
  });

  it('refuses a place that is not on the run sheet before fetching anything', async () => {
    const { content, north, fake } = setup();
    const failed = await refusal(() =>
      content().addToRunSheet(north.id, '2026-11-29', [{ passage: 'John 3:16' }], 'no-such-item'),
    );
    expect(failed.code).toBe('item-not-found');
    expect(fake.fetched).toEqual([]);
  });

  it('refuses bad dates, no items and too many items', async () => {
    const { content, north, desktopSong } = setup();
    const a = desktopSong(north.id, 'A');
    const c = content();
    expect((await refusal(() => c.addToRunSheet(north.id, '2026-02-30', [{ song: a }]))).code).toBe(
      'invalid-date',
    );
    expect(
      (await refusal(() => c.addToRunSheet(north.id, 'next sunday', [{ song: a }]))).code,
    ).toBe('invalid-date');
    expect((await refusal(() => c.addToRunSheet(north.id, '2026-11-29', []))).code).toBe(
      'no-items',
    );
    const many = Array.from({ length: MAX_ITEMS_PER_CALL + 1 }, () => ({ song: a }));
    expect((await refusal(() => c.addToRunSheet(north.id, '2026-11-29', many))).code).toBe(
      'too-many-items',
    );
    expect((await refusal(() => c.getRunSheet(north.id, '2026/11/29'))).code).toBe('invalid-date');
  });

  it('may add the same song twice', async () => {
    const { content, north, desktopSong } = setup();
    const a = desktopSong(north.id, 'A');
    const result = await content().addToRunSheet(north.id, '2026-11-29', [
      { song: a },
      { song: a },
    ]);
    expect(result.items.map((i) => i.songId)).toEqual([a, a]);
    expect(new Set(result.addedItemIds).size).toBe(2);
  });

  it('overrides a run sheet a desktop with a fast clock saved', async () => {
    const { content, north, desktopSong, desktopRunSheet } = setup();
    const a = desktopSong(north.id, 'A');
    const b = desktopSong(north.id, 'B');
    desktopRunSheet(north.id, '2026-11-29', [a], '2026-11-28T15:00:00.000Z');
    await content().addToRunSheet(north.id, '2026-11-29', [{ song: b }]);
    expect(
      content()
        .getRunSheet(north.id, '2026-11-29')
        .items.map((i) => i.title),
    ).toEqual(['A', 'B']);
  });

  it('says when the run sheet is being presented', async () => {
    const { content, north, desktopSong, desktopRunSheet, instance, time } = setup();
    const a = desktopSong(north.id, 'A');
    const runSheetId = desktopRunSheet(north.id, '2026-11-28', [a]);
    const state = createLiveState(runSheetId, time.now());
    instance.putLive(
      north.id,
      'desktop',
      {
        revision: 1,
        coordinatorId: 'desktop',
        state: { ...state, lastActiveAt: time.now(), updatedAt: time.now() },
        date: '2026-11-28',
        items: [],
        presented: null,
        devices: [],
      },
      [],
    );
    expect(content().getRunSheet(north.id, '2026-11-28').live).toBe(true);
    // Today is a Saturday, not one of North's meeting days, so the person confirmed it.
    expect(
      (await content().addToRunSheet(north.id, '2026-11-28', [{ song: a }], 'end', true)).live,
    ).toBe(true);
    expect(content().listRunSheets(north.id).liveDate).toBe('2026-11-28');
  });

  it('lists dates with run sheets around today, or in a range asked for', async () => {
    const { content, north, desktopSong, desktopRunSheet } = setup();
    const a = desktopSong(north.id, 'A');
    desktopRunSheet(north.id, '2026-11-22', [a, a]);
    desktopRunSheet(north.id, '2026-11-29', [a]);
    desktopRunSheet(north.id, '2025-01-05', [a]);
    const c = content();
    expect(c.listRunSheets(north.id).runSheets).toEqual([
      { date: '2026-11-22', items: 2 },
      { date: '2026-11-29', items: 1 },
    ]);
    expect(c.listRunSheets(north.id, '2025-01-01', '2025-01-31').runSheets).toEqual([
      { date: '2025-01-05', items: 1 },
    ]);
    expect((await refusal(() => c.listRunSheets(north.id, '2026-12-01', '2026-11-01'))).code).toBe(
      'invalid-range',
    );
    expect((await refusal(() => c.listRunSheets(north.id, '2020-01-01', '2026-01-01'))).code).toBe(
      'invalid-range',
    );
  });

  it('describes each item, including songs since deleted from the library', async () => {
    const { content, north, desktopSong, desktopRunSheet, instance, time } = setup();
    const a = desktopSong(north.id, 'A');
    const site = desktopSong(north.id, 'Site', { website: { url: 'https://example.org/' } });
    desktopRunSheet(north.id, '2026-11-29', [a, site, 'unknown-song']);
    instance.push(north.id, 'desktop', [
      {
        kind: 'song',
        id: a,
        key: a,
        revision: 2,
        updatedAt: new Date(Date.parse(time.now()) + 5).toISOString(),
        data: { title: 'A', lyrics: '', removedAt: time.now() },
      },
    ]);
    const items = content().getRunSheet(north.id, '2026-11-29').items;
    expect(items).toEqual([
      expect.objectContaining({ title: 'A', kind: 'song', deletedFromLibrary: true }),
      expect.objectContaining({ title: 'Site', kind: 'website', url: 'https://example.org/' }),
      expect.objectContaining({ kind: 'missing' }),
    ]);
  });

  it('moves an item, and changes nothing when it is already there', async () => {
    const { content, north, desktopSong, desktopRunSheet, notified } = setup();
    const [a, b, c] = ['A', 'B', 'C'].map((t) => desktopSong(north.id, t));
    desktopRunSheet(north.id, '2026-11-29', [a!, b!, c!]);
    const ids = content()
      .getRunSheet(north.id, '2026-11-29')
      .items.map((i) => i.itemId);
    const moved = content().moveRunSheetItem(north.id, '2026-11-29', ids[2]!, 'start');
    expect(moved.items.map((i) => i.title)).toEqual(['C', 'A', 'B']);
    expect(moved.changed).toBe(true);
    const toEnd = content().moveRunSheetItem(north.id, '2026-11-29', ids[2]!, 'end');
    expect(toEnd.items.map((i) => i.title)).toEqual(['A', 'B', 'C']);
    notified.length = 0;
    const same = content().moveRunSheetItem(north.id, '2026-11-29', ids[0]!, 'start');
    expect(same.changed).toBe(false);
    expect(notified).toEqual([]);
    const after = content().moveRunSheetItem(north.id, '2026-11-29', ids[0]!, ids[1]!);
    expect(after.items.map((i) => i.title)).toEqual(['B', 'A', 'C']);
    expect(
      (await refusal(() => content().moveRunSheetItem(north.id, '2026-11-29', ids[0]!, ids[0]!)))
        .code,
    ).toBe('item-not-found');
    expect(
      (await refusal(() => content().moveRunSheetItem(north.id, '2026-11-29', 'nope', 'start')))
        .code,
    ).toBe('item-not-found');
    expect(
      (await refusal(() => content().moveRunSheetItem(north.id, '2026-12-25', ids[0]!, 'start')))
        .code,
    ).toBe('item-not-found');
  });

  it('removes items, keeps their songs, and removes nothing when one is unknown', async () => {
    const { content, north, desktopSong, desktopRunSheet } = setup();
    const [a, b] = ['A', 'B'].map((t) => desktopSong(north.id, t));
    desktopRunSheet(north.id, '2026-11-29', [a!, b!]);
    const ids = content()
      .getRunSheet(north.id, '2026-11-29')
      .items.map((i) => i.itemId);
    const failed = await refusal(() =>
      content().removeRunSheetItems(north.id, '2026-11-29', [ids[0]!, 'nope']),
    );
    expect(failed.detail).toEqual({ unknown: ['nope'] });
    expect(content().getRunSheet(north.id, '2026-11-29').items).toHaveLength(2);
    const removed = content().removeRunSheetItems(north.id, '2026-11-29', [ids[0]!, ids[0]!]);
    expect(removed.removed).toBe(1);
    expect(removed.items.map((i) => i.title)).toEqual(['B']);
    expect(content().getSong(north.id, a!).title).toBe('A');
    // Emptied, it stays a run sheet devices take as changed.
    const empty = content().removeRunSheetItems(north.id, '2026-11-29', [ids[1]!]);
    expect(empty.items).toEqual([]);
    expect(content().getRunSheet(north.id, '2026-11-29').exists).toBe(false);
    expect(
      (await refusal(() => content().removeRunSheetItems(north.id, '2026-11-29', []))).code,
    ).toBe('no-items');
  });

  it('copies items from another week as new items pointing at the same songs', async () => {
    const { content, north, desktopSong, desktopRunSheet, pulled } = setup();
    const [welcome, notices, song] = ['Welcome', 'Notices', 'Song'].map((t) =>
      desktopSong(north.id, t),
    );
    desktopRunSheet(north.id, '2026-11-22', [welcome!, song!, notices!]);
    desktopRunSheet(north.id, '2026-11-29', [song!]);
    const last = content().getRunSheet(north.id, '2026-11-22').items;
    const copied = content().copyRunSheetItems(
      north.id,
      '2026-11-22',
      '2026-11-29',
      [last[0]!.itemId, last[2]!.itemId],
      'start',
    );
    expect(copied.items.map((i) => i.title)).toEqual(['Welcome', 'Notices', 'Song']);
    expect(copied.addedItemIds.some((id) => last.some((i) => i.itemId === id))).toBe(false);
    // The source is untouched.
    expect(
      content()
        .getRunSheet(north.id, '2026-11-22')
        .items.map((i) => i.itemId),
    ).toEqual(last.map((i) => i.itemId));
    // No song was duplicated.
    expect(pulled(north.id).filter((r) => r.kind === 'song')).toHaveLength(3);
    // Everything, to a date with none yet.
    expect(content().copyRunSheetItems(north.id, '2026-11-22', '2026-12-06').items).toHaveLength(3);
  });

  it('refuses copies to the same date, from an empty date, or of unknown items', async () => {
    const { content, north, desktopSong, desktopRunSheet } = setup();
    const a = desktopSong(north.id, 'A');
    desktopRunSheet(north.id, '2026-11-22', [a]);
    const c = content();
    expect(
      (await refusal(() => c.copyRunSheetItems(north.id, '2026-11-22', '2026-11-22'))).code,
    ).toBe('same-date');
    expect(
      (await refusal(() => c.copyRunSheetItems(north.id, '2026-11-15', '2026-11-29'))).code,
    ).toBe('nothing-to-copy');
    expect(
      (await refusal(() => c.copyRunSheetItems(north.id, '2026-11-22', '2026-11-29', ['nope'])))
        .code,
    ).toBe('item-not-found');
    expect(
      (await refusal(() => c.copyRunSheetItems(north.id, '2026-11-22', 'tomorrow'))).code,
    ).toBe('invalid-date');
  });

  it('never touches a workspace out of reach', async () => {
    const { content, south, desktopSong } = setup();
    const a = desktopSong(south.id, 'A');
    expect(
      (await refusal(() => content().addToRunSheet(south.id, '2026-11-29', [{ song: a }]))).code,
    ).toBe('workspace-not-found');
  });

  it('stops reaching a workspace as soon as access is taken away', async () => {
    const { instance, content, user, north, desktopSong } = setup();
    const a = desktopSong(north.id, 'A');
    const c = content();
    instance.mcp.updateUser(user.id, { allWorkspaces: false, workspaceIds: [] });
    // A tool call made with the user as now stored is refused.
    expect(
      (await refusal(() => content().addToRunSheet(north.id, '2026-11-29', [{ song: a }]))).code,
    ).toBe('no-workspaces');
    void c;
  });
});

describe('confirming the workspace and date (C10)', () => {
  /** North meets on Saturdays and Sundays, in London; today is Saturday 28 November. */
  function meetsAtWeekends(context: ReturnType<typeof setup>) {
    context.instance.push(context.north.id, 'desktop', [
      {
        kind: 'workspace',
        id: context.north.id,
        key: context.north.id,
        revision: 2,
        updatedAt: context.time.now(),
        data: { name: 'North', timezone: 'Europe/London', meetingDays: [6, 0] },
      },
    ]);
  }

  it('asks for confirmation before adding to a date already past', async () => {
    const context = setup();
    meetsAtWeekends(context);
    const { content, north, desktopSong, fake } = context;
    const a = desktopSong(north.id, 'A');
    const refused = await refusal(() =>
      content().addToRunSheet(north.id, '2026-11-22', [{ song: a }, { passage: 'John 3:16' }]),
    );
    expect(refused.code).toBe('confirm-date');
    expect(refused.message).toMatch(/already past/);
    expect(refused.message).toMatch(/ask the person/);
    expect(refused.detail).toMatchObject({
      workspace: 'North',
      date: '2026-11-22',
      weekday: 'Sunday',
      today: '2026-11-28',
      meetingDays: ['Sunday', 'Saturday'],
      nextMeetingDate: '2026-11-28',
    });
    // Nothing was fetched or written.
    expect(fake.fetched).toEqual([]);
    expect(content().getRunSheet(north.id, '2026-11-22').exists).toBe(false);
    // Once the person confirmed it, it goes through.
    const done = await content().addToRunSheet(north.id, '2026-11-22', [{ song: a }], 'end', true);
    expect(done.items).toHaveLength(1);
  });

  it('asks for confirmation before adding to a day the workspace does not meet', async () => {
    const context = setup();
    meetsAtWeekends(context);
    const { content, north, desktopSong } = context;
    const a = desktopSong(north.id, 'A');
    const refused = await refusal(() =>
      content().addToRunSheet(north.id, '2026-12-02', [{ song: a }]),
    );
    expect(refused.code).toBe('confirm-date');
    expect(refused.message).toMatch(
      /Wednesday, not one of North's meeting days \(Sunday, Saturday\)/,
    );
    expect(
      (await content().addToRunSheet(north.id, '2026-12-02', [{ song: a }], 'end', true)).weekday,
    ).toBe('Wednesday');
  });

  it('adds to today and coming meeting days without asking', async () => {
    const context = setup();
    meetsAtWeekends(context);
    const { content, north, desktopSong } = context;
    const a = desktopSong(north.id, 'A');
    for (const date of ['2026-11-28', '2026-11-29', '2026-12-05']) {
      expect((await content().addToRunSheet(north.id, date, [{ song: a }])).date).toBe(date);
    }
  });

  it('takes today in the workspace’s timezone, not the server’s', async () => {
    const context = setup();
    const { instance, north, time, content, desktopSong } = context;
    instance.push(north.id, 'desktop', [
      {
        kind: 'workspace',
        id: north.id,
        key: north.id,
        revision: 2,
        updatedAt: time.now(),
        data: { name: 'North', timezone: 'Pacific/Kiritimati', meetingDays: [6, 0] },
      },
    ]);
    const a = desktopSong(north.id, 'A');
    // 12:00 UTC on Saturday the 28th is 02:00 on Sunday the 29th in Kiritimati (UTC+14).
    time.advance(3 * 60 * 60 * 1000);
    expect(content().listWorkspaces()[0]!.today).toBe('2026-11-29');
    const refused = await refusal(() =>
      content().addToRunSheet(north.id, '2026-11-28', [{ song: a }]),
    );
    expect(refused.code).toBe('confirm-date');
    expect(refused.detail).toMatchObject({ today: '2026-11-29' });
    expect(
      (await content().addToRunSheet(north.id, '2026-11-29', [{ song: a }])).items,
    ).toHaveLength(1);
  });

  it('asks nothing about the day for a workspace that meets on any day', async () => {
    const context = setup();
    const { instance, north, time, content, desktopSong } = context;
    instance.push(north.id, 'desktop', [
      {
        kind: 'workspace',
        id: north.id,
        key: north.id,
        revision: 2,
        updatedAt: time.now(),
        data: { name: 'North', timezone: 'UTC', meetingDays: [] },
      },
    ]);
    const a = desktopSong(north.id, 'A');
    expect(
      (await content().addToRunSheet(north.id, '2026-12-02', [{ song: a }])).items,
    ).toHaveLength(1);
    // A past date is still asked about.
    expect(
      (await refusal(() => content().addToRunSheet(north.id, '2026-11-27', [{ song: a }]))).code,
    ).toBe('confirm-date');
  });

  it('asks about the date copied to, never the date copied from', async () => {
    const context = setup();
    meetsAtWeekends(context);
    const { content, north, desktopSong, desktopRunSheet } = context;
    const a = desktopSong(north.id, 'A');
    desktopRunSheet(north.id, '2026-11-22', [a]);
    // Copying from last week to this Sunday needs no confirmation.
    expect(content().copyRunSheetItems(north.id, '2026-11-22', '2026-11-29').items).toHaveLength(1);
    expect(
      (await refusal(() => content().copyRunSheetItems(north.id, '2026-11-22', '2026-12-01'))).code,
    ).toBe('confirm-date');
    expect(
      (await refusal(() => content().copyRunSheetItems(north.id, '2026-11-29', '2026-11-21'))).code,
    ).toBe('confirm-date');
    expect(
      content().copyRunSheetItems(north.id, '2026-11-22', '2026-12-01', undefined, 'end', true)
        .items,
    ).toHaveLength(1);
  });

  it('names the workspace, date and weekday in every run sheet result, to repeat to the person', async () => {
    const { content, north, desktopSong } = setup();
    const a = desktopSong(north.id, 'A');
    expect(content().getRunSheet(north.id, '2026-11-29')).toMatchObject({
      workspaceName: 'North',
      date: '2026-11-29',
      weekday: 'Sunday',
    });
    expect(await content().addToRunSheet(north.id, '2026-11-29', [{ song: a }])).toMatchObject({
      workspaceName: 'North',
      weekday: 'Sunday',
    });
  });

  it('asks which workspace when the person reaches several, and lists them', async () => {
    const { content, north, central, desktopSong } = setup();
    const a = desktopSong(north.id, 'A');
    const refused = await refusal(() =>
      content().addToRunSheet(undefined, '2026-11-29', [{ song: a }]),
    );
    expect(refused.code).toBe('workspace-required');
    expect(refused.detail.workspaces).toEqual([
      { id: north.id, name: 'North' },
      { id: central.id, name: 'Central' },
    ]);
    expect(content().getRunSheet(north.id, '2026-11-29').exists).toBe(false);
  });
});

describe('Bible passages', () => {
  it('adds a passage in the workspace’s versions, or the church’s default, and reports its use', async () => {
    const { content, north, instance, fake, time } = setup();
    // No choice of its own: the church's default.
    instance.setChurchSetting('bibleDefaultVersions', ['CUNP-S', 'NIVUK']);
    const first = await content().addToRunSheet(north.id, '2026-11-29', [
      { passage: '约翰福音3:16-17' },
    ]);
    expect(first.items[0]).toMatchObject({
      kind: 'bible',
      title: '约翰福音 3:16-17',
      versions: ['CUNP-S', 'NIVUK'],
    });
    expect(fake.reported).toEqual([['fums-token']]);
    // Its own choice wins.
    instance.push(north.id, 'desktop', [
      {
        kind: 'setting',
        id: 'bibleVersions',
        key: 'bibleVersions',
        revision: 1,
        updatedAt: time.now(),
        data: { value: ['ESV'] },
      },
    ]);
    const second = await content().addToRunSheet(north.id, '2026-11-29', [{ passage: 'jn 3.16' }]);
    expect(second.items[1]).toMatchObject({ title: 'John 3:16', versions: ['ESV'] });
    const song = content().getSong(north.id, second.items[1]!.songId);
    expect(song).toMatchObject({ kind: 'bible', reference: 'JHN.3.16', editable: false });
    expect(song.lyrics).toContain('Verse 16 in ESV');
  });

  it('uses the versions asked for, if the church offers them', async () => {
    const { content, north } = setup();
    const result = await content().addToRunSheet(north.id, '2026-11-29', [
      { passage: 'Mark 1:1-2', versions: ['esv', 'CUNP-S'] },
    ]);
    expect(result.items[0]).toMatchObject({ versions: ['ESV', 'CUNP-S'] });
    const refused = await refusal(() =>
      content().addToRunSheet(north.id, '2026-11-29', [{ passage: 'Mark 1:1', versions: ['KJV'] }]),
    );
    expect(refused.code).toBe('version-not-offered');
    expect(refused.detail.offered).toEqual(['NIVUK', 'ESV', 'CUNP-S']);
    expect(
      (
        await refusal(() =>
          content().addToRunSheet(north.id, '2026-11-29', [
            { passage: 'Mark 1:1', versions: ['ESV', 'NIVUK', 'CUNP-S'] },
          ]),
        )
      ).code,
    ).toBe('too-many-items');
  });

  it('keeps a passage out of the library', async () => {
    const { content, north } = setup();
    await content().addToRunSheet(north.id, '2026-11-29', [{ passage: 'John 3:16' }]);
    expect(content().searchSongs(north.id, 'john').songs).toEqual([]);
  });

  it('explains each way a passage can fail', async () => {
    const { content, north, instance } = setup();
    const code = async (passage: string) =>
      (await refusal(() => content().addToRunSheet(north.id, '2026-11-29', [{ passage }]))).code;
    expect(await code('not a reference')).toBe('invalid-reference');
    expect(await code('John')).toBe('invalid-reference');
    expect(await code('Obadiah 1:30')).toBe('passage-not-found');
    expect(await code('Psalm 119')).toBe('passage-too-large');
    expect(await code('Jude 1:1')).toBe('bible-unavailable');
    instance.setChurchSetting('bibleVersions', []);
    expect(await code('John 3:16')).toBe('bible-unavailable');
  });

  it('says so when the server has no Bible', async () => {
    const { instance, north, user } = setup();
    const c = new McpContent(
      {
        instance,
        relay: { contentChanged: () => undefined, contentChangedAll: () => undefined },
        bible: null,
      },
      instance.mcp.getUser(user.id)!,
    );
    expect(
      (await refusal(() => c.addToRunSheet(north.id, '2026-11-29', [{ passage: 'John 3:16' }])))
        .code,
    ).toBe('bible-unavailable');
  });
});

describe('websites', () => {
  it('adds a website, completing its address, titled by its host unless given one', async () => {
    const { content, north } = setup();
    const result = await content().addToRunSheet(north.id, '2026-11-29', [
      { website: 'example.org/live' },
      { website: 'https://youtu.be/dQw4w9WgXcQ', title: '  Video  ' },
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        kind: 'website',
        title: 'example.org',
        url: 'https://example.org/live',
      }),
      expect.objectContaining({
        kind: 'website',
        title: 'Video',
        url: 'https://youtu.be/dQw4w9WgXcQ',
      }),
    ]);
  });

  it('uses the library’s song for an address it already has, also twice in one call', async () => {
    const { content, north, desktopSong } = setup();
    const existing = desktopSong(north.id, 'Our Site', {
      website: { url: 'https://example.org/' },
    });
    const result = await content().addToRunSheet(north.id, '2026-11-29', [
      { website: 'https://example.org' },
      { website: 'https://other.example.org' },
      { website: 'other.example.org' },
    ]);
    expect(result.items[0]).toMatchObject({ songId: existing, title: 'Our Site' });
    expect(result.items[1]!.songId).toBe(result.items[2]!.songId);
    expect(
      content()
        .searchSongs(north.id, '')
        .songs.filter((s) => s.kind === 'website'),
    ).toHaveLength(2);
  });

  it('refuses what is not a web address', async () => {
    const { content, north } = setup();
    for (const website of [
      'javascript:alert(1)',
      'ftp://example.org',
      'two words',
      '',
      'mailto:a@b.org',
    ]) {
      expect(
        (await refusal(() => content().addToRunSheet(north.id, '2026-11-29', [{ website }]))).code,
      ).toBe('invalid-url');
    }
  });
});
