import { describe, expect, it } from 'vitest';
import { VideoCache, type VideoCacheDeps } from './videoCache';

function harness() {
  let today = '2026-11-08';
  const runSheets = new Map<string, string[]>();
  const copies = new Set<string>();
  const fetched: string[] = [];
  const failing = new Set<string>();
  let uploads: Record<string, string> = {};
  let connected = true;
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
    list: async () => [...copies],
    fetch: async (file, progress) => {
      if (failing.has(file)) throw new Error('disk-full');
      progress(5, 10);
      progress(10, 10);
      fetched.push(file);
      copies.add(file);
    },
    remove: async (file) => {
      copies.delete(file);
    },
    connected: () => connected,
    uploads: { get: () => uploads, set: (value) => (uploads = value) },
  };
  const cache = new VideoCache(deps);
  return {
    cache,
    runSheets,
    copies,
    fetched,
    failing,
    setToday: (date: string) => (today = date),
    setConnected: (value: boolean) => (connected = value),
  };
}

describe('the video cache (U8, U9)', () => {
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

  it('fetches the earliest run sheet’s first, one at a time', async () => {
    const h = harness();
    h.runSheets.set('2026-11-22', ['later.mp4']);
    h.runSheets.set('2026-11-15', ['sooner.mp4']);
    await h.cache.pass();
    expect(h.fetched).toEqual(['sooner.mp4', 'later.mp4']);
  });

  it('deletes a copy the day after its last date, and keeps one used later too', async () => {
    const h = harness();
    h.runSheets.set('2026-11-08', ['a.mp4', 'b.mp4']);
    h.runSheets.set('2026-11-15', ['b.mp4']);
    await h.cache.pass();
    h.setToday('2026-11-09');
    await h.cache.pass();
    expect([...h.copies].sort()).toEqual(['b.mp4']);
    h.setToday('2026-11-16');
    await h.cache.pass();
    expect([...h.copies]).toEqual([]);
  });

  it('does not fetch a video in the library only, and keeps the uploader’s copy on its day', async () => {
    const h = harness();
    h.copies.add('mine.mp4');
    h.cache.uploaded('mine.mp4');
    await h.cache.pass();
    expect(h.copies.has('mine.mp4')).toBe(true);
    expect(h.fetched).toEqual([]);
    h.setToday('2026-11-09');
    await h.cache.pass();
    expect(h.copies.has('mine.mp4')).toBe(false);
  });

  it('fetches again a video added back after its copy was deleted', async () => {
    const h = harness();
    h.runSheets.set('2026-11-08', ['a.mp4']);
    await h.cache.pass();
    h.runSheets.set('2026-11-08', []);
    await h.cache.pass();
    expect(h.copies.size).toBe(0);
    h.runSheets.set('2026-11-08', ['a.mp4']);
    await h.cache.pass();
    expect(h.fetched).toEqual(['a.mp4', 'a.mp4']);
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

  it('deletes copies that never belonged to any record', async () => {
    const h = harness();
    h.copies.add('left-by-a-crash.mp4');
    await h.cache.pass();
    expect(h.copies.size).toBe(0);
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
