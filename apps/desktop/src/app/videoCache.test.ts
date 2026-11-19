import type { VideoUse } from '@worship-q/store';
import { describe, expect, it } from 'vitest';
import {
  CLEANUP_AFTER_MS,
  CLEANUP_MIN_BYTES,
  removable,
  VideoCache,
  type VideoCacheDeps,
} from './videoCache';

const MB = 1024 * 1024;

function harness() {
  let today = '2026-11-08';
  /** Run sheets by date, each the files of its video items. */
  const runSheets = new Map<string, string[]>();
  /** Songs in the library, by file: their title, and whether removed. */
  const songs = new Map<string, { title: string; removed: boolean }>();
  const copies = new Set<string>();
  const sizes = new Map<string, number>();
  const fetched: string[] = [];
  const removed: string[] = [];
  const failing = new Set<string>();
  /** Files that cannot be deleted, as one open in a player on Windows. */
  const locked = new Set<string>();
  /** What the church server answers about each file: kept, not kept, or no answer. */
  const server = new Map<string, boolean | null>();
  const asked: string[] = [];
  let uploads: Record<string, string> = {};
  let snoozes: Record<string, string> = {};
  let connected = true;
  let live: string | null = null;
  let elapsed = 0;
  const deps: VideoCacheDeps = {
    today: () => today,
    wanted: async (from) => {
      const earliest = new Map<string, string>();
      for (const [date, files] of [...runSheets].sort(([a], [b]) => a.localeCompare(b))) {
        if (date < from) continue;
        for (const file of files) if (!earliest.has(file)) earliest.set(file, date);
      }
      return [...earliest].map(([file, date]) => ({ file, date }));
    },
    liveDate: () => live,
    list: async () => [...copies],
    fetch: async (file, progress) => {
      if (failing.has(file)) throw new Error('disk-full');
      progress(5, 10);
      progress(10, 10);
      fetched.push(file);
      copies.add(file);
    },
    remove: async (file) => {
      if (locked.has(file)) throw new Error('in use');
      copies.delete(file);
      removed.push(file);
    },
    connected: () => connected,
    uploads: { get: () => uploads, set: (value) => (uploads = value) },
    uses: async () => {
      const uses: VideoUse[] = [];
      for (const [file, song] of songs) {
        const dates = [...runSheets]
          .filter(([, files]) => files.includes(file))
          .map(([date]) => date)
          .sort();
        uses.push({ file, title: song.title, removed: song.removed, dates });
      }
      return uses;
    },
    elapsed: () => elapsed,
    serverHas: async (file) => {
      asked.push(file);
      return server.has(file) ? server.get(file)! : false;
    },
    copy: async (file) =>
      copies.has(file) ? { path: `/data/videos/${file}`, bytes: sizes.get(file) ?? 60 * MB } : null,
    snoozes: { get: () => snoozes, set: (value) => (snoozes = value) },
  };
  const cache = new VideoCache(deps);
  /** A song with a video, on the given run sheets, with a copy here. */
  const video = (file: string, dates: string[], options: { bytes?: number } = {}) => {
    songs.set(file, { title: file.replace(/\.mp4$/, ''), removed: false });
    for (const date of dates) runSheets.set(date, [...(runSheets.get(date) ?? []), file]);
    copies.add(file);
    if (options.bytes) sizes.set(file, options.bytes);
  };
  /** Thirty minutes later, and the minute's tick. */
  const after30 = async () => {
    elapsed = CLEANUP_AFTER_MS;
    await cache.tick();
  };
  return {
    cache,
    runSheets,
    songs,
    copies,
    sizes,
    fetched,
    removed,
    failing,
    locked,
    server,
    asked,
    video,
    after30,
    snoozes: () => snoozes,
    setSnoozes: (value: Record<string, string>) => (snoozes = value),
    setToday: (date: string) => (today = date),
    setConnected: (value: boolean) => (connected = value),
    setLive: (date: string | null) => (live = date),
    setElapsed: (ms: number) => (elapsed = ms),
  };
}

describe('the video cache (U8)', () => {
  it('fetches videos of today’s and later run sheets, not past ones', async () => {
    const h = harness();
    h.runSheets.set('2026-11-08', ['today.mp4']);
    h.runSheets.set('2026-11-15', ['next.mp4']);
    h.runSheets.set('2026-11-01', ['past.mp4']);
    await h.cache.pass();
    expect(h.fetched).toEqual(['today.mp4', 'next.mp4']);
    expect(h.cache.status('today.mp4')).toEqual({ kind: 'ready' });
    expect(h.cache.status('past.mp4')).toBeUndefined();
  });

  it('fetches the live run sheet’s videos after its date has passed', async () => {
    const h = harness();
    h.runSheets.set('2026-11-08', ['live.mp4']);
    h.runSheets.set('2026-11-12', ['between.mp4']);
    h.setLive('2026-11-08');
    h.setToday('2026-11-09');
    await h.cache.pass();
    expect(h.fetched).toEqual(['live.mp4', 'between.mp4']);
  });

  it('fetches the earliest run sheet’s first, one at a time', async () => {
    const h = harness();
    h.runSheets.set('2026-11-22', ['later.mp4']);
    h.runSheets.set('2026-11-15', ['sooner.mp4']);
    await h.cache.pass();
    expect(h.fetched).toEqual(['sooner.mp4', 'later.mp4']);
  });

  it('never deletes anything in a pass (U29)', async () => {
    const h = harness();
    h.copies.add('left-by-a-crash.mp4');
    h.video('past.mp4', ['2026-11-01']);
    await h.cache.pass();
    h.setToday('2026-12-25');
    await h.cache.pass();
    expect(h.removed).toEqual([]);
  });

  it('says why a fetch failed, and tries again on the next pass', async () => {
    const h = harness();
    h.runSheets.set('2026-11-08', ['a.mp4']);
    h.failing.add('a.mp4');
    await h.cache.pass();
    expect(h.cache.status('a.mp4')).toEqual({
      kind: 'failed',
      message: 'Not enough space on this computer.',
    });
    h.failing.clear();
    await h.cache.pass();
    expect(h.cache.status('a.mp4')).toEqual({ kind: 'ready' });
  });

  it('waits without the server, showing what it still needs', async () => {
    const h = harness();
    h.setConnected(false);
    h.runSheets.set('2026-11-08', ['a.mp4']);
    await h.cache.pass();
    expect(h.cache.status('a.mp4')).toEqual({ kind: 'waiting' });
    expect(h.fetched).toEqual([]);
  });

  it('runs one pass at a time, and once more when asked meanwhile', async () => {
    const h = harness();
    h.runSheets.set('2026-11-08', ['a.mp4']);
    const first = h.cache.pass();
    h.runSheets.set('2026-11-15', ['b.mp4']);
    const second = h.cache.pass();
    await Promise.all([first, second]);
    expect(h.fetched).toEqual(['a.mp4', 'b.mp4']);
  });
});

describe('which copies are removed (U29)', () => {
  const use = (file: string, dates: string[], removed = false): VideoUse => ({
    file,
    title: file,
    removed,
    dates,
  });
  const today = '2026-11-08';

  it('removes copies used only by past run sheets, and keeps those used today or later', () => {
    const uses = [
      use('past.mp4', ['2026-11-01']),
      use('both.mp4', ['2026-11-01', '2026-11-15']),
      use('today.mp4', ['2026-11-08']),
    ];
    expect(removable(['past.mp4', 'both.mp4', 'today.mp4'], uses, today, null)).toEqual([
      'past.mp4',
    ]);
  });

  it('keeps the live run sheet’s videos, even when its date has passed', () => {
    expect(removable(['a.mp4'], [use('a.mp4', ['2026-11-01'])], today, '2026-11-01')).toEqual([]);
  });

  it('keeps a video on no run sheet, however old', () => {
    expect(removable(['library.mp4'], [use('library.mp4', [])], today, null)).toEqual([]);
  });

  it('removes a copy no song names, or only removed songs do', () => {
    const uses = [use('deleted.mp4', ['2026-11-01'], true), use('unused.mp4', [], true)];
    expect(removable(['deleted.mp4', 'unused.mp4', 'replaced.mp4'], uses, today, null)).toEqual([
      'deleted.mp4',
      'unused.mp4',
      'replaced.mp4',
    ]);
  });

  it('keeps a removed song’s copy while a current, upcoming or live run sheet presents it', () => {
    // A run sheet still presents a song removed from the library, marked removed.
    const uses = [
      use('upcoming.mp4', ['2026-11-15'], true),
      use('today.mp4', ['2026-11-08'], true),
      use('live.mp4', ['2026-11-01'], true),
    ];
    expect(removable(['upcoming.mp4', 'today.mp4', 'live.mp4'], uses, today, '2026-11-01')).toEqual(
      [],
    );
  });

  it('keeps a copy uploaded today', () => {
    expect(removable(['new.mp4'], [], today, null, new Set(['new.mp4']))).toEqual([]);
  });
});

describe('when copies are removed (U29)', () => {
  it('removes nothing before 30 minutes', async () => {
    const h = harness();
    h.server.set('past.mp4', true);
    h.video('past.mp4', ['2026-11-01']);
    h.setElapsed(CLEANUP_AFTER_MS - 1);
    await h.cache.tick();
    expect(h.removed).toEqual([]);
  });

  it('removes at 30 minutes by the clock, however slowly the timer fired', async () => {
    const h = harness();
    h.server.set('past.mp4', true);
    h.video('past.mp4', ['2026-11-01']);
    // A single tick, the first, arriving late: it is the elapsed time that counts.
    h.setElapsed(CLEANUP_AFTER_MS + 5 * 60_000);
    await h.cache.tick();
    expect(h.removed).toEqual(['past.mp4']);
  });

  it('removes once per launch, not again later in the same run', async () => {
    const h = harness();
    h.server.set('a.mp4', true);
    h.server.set('b.mp4', true);
    h.video('a.mp4', ['2026-11-01']);
    await h.after30();
    h.video('b.mp4', ['2026-11-02']);
    h.setElapsed(90 * 60_000);
    await h.cache.tick();
    expect(h.removed).toEqual(['a.mp4']);
  });

  it('keeps last week’s copies when its run sheet was made live in the first 30 minutes', async () => {
    const h = harness();
    h.server.set('last-week.mp4', true);
    h.video('last-week.mp4', ['2026-11-01']);
    h.setLive('2026-11-01');
    await h.after30();
    expect(h.removed).toEqual([]);
  });

  it('keeps a copy whose item was copied into today’s run sheet in the first 30 minutes', async () => {
    const h = harness();
    h.server.set('a.mp4', true);
    h.video('a.mp4', ['2026-11-01']);
    h.runSheets.set('2026-11-08', ['a.mp4']);
    await h.after30();
    expect(h.removed).toEqual([]);
  });

  it('a new launch waits its own 30 minutes', async () => {
    const h = harness();
    h.video('a.mp4', ['2026-11-01']);
    h.server.set('a.mp4', true);
    h.setElapsed(29 * 60_000);
    await h.cache.tick();
    // The app quits; the next launch has a cache of its own.
    const next = new VideoCache((h.cache as unknown as { deps: VideoCacheDeps }).deps);
    h.setElapsed(10 * 60_000);
    await next.tick();
    expect(h.removed).toEqual([]);
  });
});

describe('asking before removing local-only copies (U30)', () => {
  it('deletes silently only what the church server keeps', async () => {
    const h = harness();
    h.server.set('kept.mp4', true);
    h.server.set('only-here.mp4', false);
    h.video('kept.mp4', ['2026-11-01']);
    h.video('only-here.mp4', ['2026-11-01'], { bytes: 150 * MB });
    await h.after30();
    expect(h.removed).toEqual(['kept.mp4']);
    expect(h.cache.offer?.videos.map((v) => v.file)).toEqual(['only-here.mp4']);
  });

  it('removes and offers nothing when the church server cannot answer for one copy', async () => {
    const h = harness();
    h.server.set('a.mp4', true);
    h.server.set('b.mp4', null);
    h.video('a.mp4', ['2026-11-01']);
    h.video('b.mp4', ['2026-11-01'], { bytes: 200 * MB });
    await h.after30();
    expect(h.removed).toEqual([]);
    expect(h.cache.offer).toBeNull();
  });

  it('asks no server without a church server: every copy is local-only', async () => {
    const h = harness();
    h.setConnected(false);
    h.video('a.mp4', ['2026-11-01'], { bytes: 120 * MB });
    await h.after30();
    expect(h.asked).toEqual([]);
    expect(h.removed).toEqual([]);
    expect(h.cache.offer).toMatchObject({ totalBytes: 120 * MB });
  });

  it('offers nothing under 100 MB, and the copies wait', async () => {
    const h = harness();
    h.setConnected(false);
    h.video('a.mp4', ['2026-11-01'], { bytes: CLEANUP_MIN_BYTES - 1 });
    await h.after30();
    expect(h.cache.offer).toBeNull();
    expect(h.copies.has('a.mp4')).toBe(true);
  });

  it('shows each copy’s title, its path in the app’s folder and size', async () => {
    const h = harness();
    h.setConnected(false);
    h.video('Welcome loop.mp4', ['2026-11-01'], { bytes: 100 * MB });
    await h.after30();
    expect(h.cache.offer?.videos).toEqual([
      {
        file: 'Welcome loop.mp4',
        title: 'Welcome loop',
        path: '/data/videos/Welcome loop.mp4',
        bytes: 100 * MB,
      },
    ]);
  });

  it('removes the ticked copies, keeps the rest for 30 days, and says what was freed', async () => {
    const h = harness();
    h.setConnected(false);
    h.video('a.mp4', ['2026-11-01'], { bytes: 80 * MB });
    h.video('b.mp4', ['2026-11-01'], { bytes: 70 * MB });
    await h.after30();
    const result = await h.cache.removeSelected(['a.mp4']);
    expect(result).toEqual({ freedBytes: 80 * MB, removed: 1, failed: 0, needed: 0 });
    expect(h.copies.has('b.mp4')).toBe(true);
    expect(h.snoozes()).toEqual({ 'b.mp4': '2026-11-08' });
    expect(h.cache.offer).toBeNull();
  });

  it('keeps a ticked copy that a run sheet came to need while the window was open', async () => {
    const h = harness();
    h.setConnected(false);
    h.video('a.mp4', ['2026-11-01'], { bytes: 150 * MB });
    await h.after30();
    h.runSheets.set('2026-11-15', ['a.mp4']);
    const result = await h.cache.removeSelected(['a.mp4']);
    expect(result).toMatchObject({ removed: 0, needed: 1, freedBytes: 0 });
    expect(h.copies.has('a.mp4')).toBe(true);
  });

  it('counts a copy that could not be deleted as failed, not freed', async () => {
    const h = harness();
    h.setConnected(false);
    h.video('a.mp4', ['2026-11-01'], { bytes: 150 * MB });
    h.locked.add('a.mp4');
    await h.after30();
    const result = await h.cache.removeSelected(['a.mp4']);
    expect(result).toMatchObject({ removed: 0, failed: 1, freedBytes: 0 });
  });

  it('keeps every offered copy for 30 days when dismissed', async () => {
    const h = harness();
    h.setConnected(false);
    h.video('a.mp4', ['2026-11-01'], { bytes: 150 * MB });
    await h.after30();
    h.cache.dismissOffer();
    expect(h.cache.offer).toBeNull();
    expect(h.snoozes()).toEqual({ 'a.mp4': '2026-11-08' });
  });

  it('leaves out copies kept within 30 days, and offers them again after', async () => {
    const h = harness();
    h.setConnected(false);
    h.video('a.mp4', ['2026-11-01'], { bytes: 150 * MB });
    h.setSnoozes({ 'a.mp4': '2026-10-10' }); // 29 days ago
    await h.after30();
    expect(h.cache.offer).toBeNull();

    const later = harness();
    later.setConnected(false);
    later.video('a.mp4', ['2026-11-01'], { bytes: 150 * MB });
    later.setSnoozes({ 'a.mp4': '2026-10-08' }); // 31 days ago
    await later.after30();
    expect(later.cache.offer?.videos).toHaveLength(1);
    expect(later.snoozes()).toEqual({});
  });
});
