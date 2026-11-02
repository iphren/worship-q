/** Record origins and shadows for two-version songs (D26, D31, D32, D36). */
import { PROTOCOL_HEADER, PROTOCOL_VERSION, type SyncRecord } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { openDatabase } from './db';
import { Instance } from './instance';

function clock(start = '2026-11-02T09:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now).toISOString(), advance: (ms = 1000) => (now += ms) };
}

const song = (
  id: string,
  title: string,
  updatedAt: string,
  extra: Record<string, unknown> = {},
): SyncRecord => ({
  kind: 'song',
  id,
  key: id,
  revision: 1,
  updatedAt,
  data: { title, lyrics: 'la', removedAt: null, ...extra },
});

async function setup() {
  const time = clock();
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const { workspace: managing, code: codeA } = instance.createWorkspace('Managing');
  const { workspace: north, code: codeB } = instance.createWorkspace('North');
  const { workspace: south, code: codeC } = instance.createWorkspace('South');
  instance.setManageLibrary(managing.id, true);
  const a = instance.enroll(codeA, 'A')!;
  const b1 = instance.enroll(codeB, 'B1')!;
  const b2 = instance.enroll(codeB, 'B2')!;
  const c = instance.enroll(codeC, 'C')!;
  const { app } = await buildServer({
    instance,
    dataDir: '/nonexistent',
    name: 'Test',
    sweep: false,
  });
  const headers = (token: string, protocol = PROTOCOL_VERSION) => ({
    authorization: `Bearer ${token}`,
    [PROTOCOL_HEADER]: String(protocol),
    'content-type': 'application/json',
  });
  // The church's song, then North's own version of it.
  instance.push(managing.id, a.device.id, [song('s1', 'Holy (church)', time.now())]);
  time.advance();
  instance.push(north.id, b1.device.id, [
    { ...song('s1', 'Holy (North)', time.now()), revision: 2 },
  ]);
  return { time, instance, app, headers, managing, north, south, a, b1, b2, c };
}

describe('pulling with origins (D31)', () => {
  it('gives a version 3 device the workspace’s version and the church’s as a shadow', async () => {
    const { app, headers, b1 } = await setup();
    const pulled = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?since=0',
      headers: headers(b1.token),
    });
    const records = pulled.json().records as SyncRecord[];
    expect(records.map((r) => [r.id, r.origin, r.shadow ?? false, r.data.title])).toEqual([
      ['s1', 'church', true, 'Holy (church)'],
      ['s1', 'workspace', false, 'Holy (North)'],
    ]);
    expect(pulled.json().manageLibrary).toBe(false);
  });

  it('gives a version 2 device exactly what it received before: the workspace’s version only', async () => {
    const { app, headers, b1 } = await setup();
    const pulled = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?since=0',
      headers: headers(b1.token, 2),
    });
    const records = pulled.json().records as SyncRecord[];
    expect(records).toHaveLength(1);
    expect(records[0]).not.toHaveProperty('origin');
    expect(records[0]).not.toHaveProperty('shadow');
    expect(records[0]!.data.title).toBe('Holy (North)');
  });

  it('marks the church’s record as the church’s, without a shadow, for a workspace with no version', async () => {
    const { app, headers, c, a } = await setup();
    const pulled = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?since=0',
      headers: headers(c.token),
    });
    const records = pulled.json().records as SyncRecord[];
    expect(records.map((r) => [r.origin, r.shadow])).toEqual([['church', undefined]]);
    const managing = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?since=0',
      headers: headers(a.token),
    });
    expect(managing.json().manageLibrary).toBe(true);
    expect(managing.json().records[0].origin).toBe('church');
  });

  it('never shadows backgrounds: a hidden church background stays hidden', async () => {
    const { instance, managing, north, a, b1 } = await setup();
    const stamp = instance.now();
    instance.push(managing.id, a.device.id, [
      {
        kind: 'background',
        id: 'bg',
        key: 'bg',
        revision: 1,
        updatedAt: stamp,
        data: { kind: 'image', fileName: 'bg.jpg', originalName: 'x', removedAt: null },
      },
    ]);
    instance.push(north.id, b1.device.id, [
      {
        kind: 'background',
        id: 'bg',
        key: 'bg',
        revision: 2,
        updatedAt: stamp,
        data: { kind: 'image', fileName: 'bg.jpg', originalName: 'x', removedAt: stamp },
      },
    ]);
    const records = instance
      .pull(north.id, 0, 500, 3)
      .records.filter((r) => r.kind === 'background');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ origin: 'workspace', data: { removedAt: stamp } });
  });

  it('keeps the church’s choice-free: useChurchVersion never enters the Church Library', async () => {
    const { instance, managing, a } = await setup();
    instance.push(managing.id, a.device.id, [
      song('s2', 'New', instance.now(), { useChurchVersion: true }),
    ]);
    const church = instance.pull(managing.id, 0, 500, 3).records.find((r) => r.id === 's2');
    expect(church?.data).not.toHaveProperty('useChurchVersion');
  });
});

describe('Delete our version (D32)', () => {
  it('drops the workspace’s version, returns the church’s, and brings it to the other devices', async () => {
    const { app, headers, instance, north, b1, b2, time } = await setup();
    // B2 is up to date, so its cursor is past both records.
    const before = instance.pull(north.id, 0, 500, 3);
    expect(before.records).toHaveLength(2);
    time.advance();
    const restored = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/restore',
      headers: headers(b1.token),
      payload: { kind: 'song', key: 's1' },
    });
    expect(restored.json().record).toMatchObject({
      id: 's1',
      origin: 'church',
      data: { title: 'Holy (church)' },
    });
    expect(restored.json().record.shadow).toBeUndefined();
    // B2 pulls from where it was and receives the church's record, no longer a shadow.
    const after = instance.pull(north.id, before.cursor, 500, 3);
    expect(after.records.map((r) => [r.origin, r.shadow, r.data.title])).toEqual([
      ['church', undefined, 'Holy (church)'],
    ]);
    // Another workspace's pull is not disturbed by the re-sequencing: the record it may
    // receive again is the same one.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/restore',
      headers: headers(b2.token),
      payload: { kind: 'song', key: 's1' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('refuses when the church has no live record to go back to', async () => {
    const { app, headers, instance, b1 } = await setup();
    instance.deleteChurch('song', 's1');
    const restored = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/restore',
      headers: headers(b1.token),
      payload: { kind: 'song', key: 's1' },
    });
    expect(restored.statusCode).toBe(409);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/restore',
      headers: headers(b1.token),
      payload: { kind: 'runSheet', key: 'x' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('turning Manage Church Library on with two-version songs (D36)', () => {
  it('flags overrides the church changed since, and drops versions set aside for the church’s', async () => {
    const { instance, managing, north, a, b1, time } = await setup();
    // A second church song North made a version of, then chose the church's for.
    instance.push(managing.id, a.device.id, [song('s2', 'Grace (church)', time.now())]);
    time.advance();
    instance.push(north.id, b1.device.id, [
      { ...song('s2', 'Grace (North)', time.now(), { useChurchVersion: true }), revision: 2 },
    ]);
    // The church edits s1 after North's version of it.
    time.advance();
    instance.push(managing.id, a.device.id, [
      { ...song('s1', 'Holy (church, edited)', time.now()), revision: 2 },
    ]);

    expect(instance.libraryPlan(north.id)).toEqual({
      songs: [],
      backgrounds: [],
      overrides: [
        { title: 'Holy (North)', churchChangedSince: true, usesChurchVersion: false },
        { title: 'Grace (North)', churchChangedSince: false, usesChurchVersion: true },
      ],
      hidden: [],
    });
    time.advance();
    instance.setManageLibrary(north.id, true);
    const titles = Object.fromEntries(
      instance
        .pull(north.id, 0, 500, 3)
        .records.filter((r) => r.kind === 'song')
        .map((r) => [r.id, r.data.title]),
    );
    expect(titles).toEqual({ s1: 'Holy (North)', s2: 'Grace (church)' });
    expect(instance.pull(north.id, 0, 500, 3).records.every((r) => r.origin === 'church')).toBe(
      true,
    );
  });
});
