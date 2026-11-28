/** The presentation log on the server (service records M4.4, M4.5; rules §5.4). */
import { describe, expect, it } from 'vitest';
import { setupRecords } from './serviceRecords.testing';

describe('the presentation log on the server (§5.4)', () => {
  it('keeps an entry sent open and then closed as one row, and a repeat changes nothing', async () => {
    const { send, entry, presentationLog, time } = await setupRecords();
    const open = entry(0);
    expect((await send([open])).json()).toEqual({ stored: 1 });
    const closed = { ...open, endedAt: time.at(30) };
    expect((await send([closed])).json()).toEqual({ stored: 1 });
    expect((await send([closed])).json()).toEqual({ stored: 0 });
    const rows = presentationLog.range(null, null, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endedAt: time.at(30), closedByServer: false });
  });

  it('makes the row whole from a close alone', async () => {
    const { send, entry, presentationLog, time } = await setupRecords();
    await send([entry(0, { endedAt: time.at(10) })]);
    expect(presentationLog.range(null, null, null)[0]).toMatchObject({
      startedAt: time.at(0),
      endedAt: time.at(10),
      songId: 's1',
    });
  });

  it('never reopens a closed entry with a late repeat of its opening', async () => {
    const { send, entry, presentationLog, time } = await setupRecords();
    const open = entry(0);
    await send([{ ...open, endedAt: time.at(10) }]);
    await send([open]);
    expect(presentationLog.get(open.id)!.endedAt).toBe(time.at(10));
  });

  it('keeps a device of another workspace out of this one’s log', async () => {
    const { send, entry, presentationLog, stranger, workspace } = await setupRecords();
    const open = entry(0);
    await send([open]);
    await send([{ ...open, endedAt: open.startedAt }], stranger.token);
    expect(presentationLog.get(open.id)).toMatchObject({
      workspaceId: workspace.id,
      endedAt: null,
    });
  });

  it('accepts entries from any enrolled device of the workspace, and attributes them', async () => {
    const { send, entry, presentationLog, follower } = await setupRecords();
    const open = entry(0);
    await send([open], follower.token);
    expect(presentationLog.get(open.id)).toMatchObject({
      deviceId: follower.device.id,
      deviceName: 'Side desk',
    });
  });

  it('closes an earlier open entry when a later one starts, marked as the server’s', async () => {
    const { send, entry, presentationLog, time } = await setupRecords();
    const first = entry(0);
    const second = entry(20);
    await send([first]);
    await send([second]);
    expect(presentationLog.get(first.id)).toMatchObject({
      endedAt: time.at(20),
      closedByServer: true,
    });
    expect(presentationLog.get(second.id)!.endedAt).toBeNull();
  });

  it('closes at once an earlier entry that arrives afterwards still open', async () => {
    const { send, entry, presentationLog, time } = await setupRecords();
    const later = entry(20);
    const earlier = entry(0);
    await send([later]);
    await send([earlier]);
    expect(presentationLog.get(earlier.id)).toMatchObject({
      endedAt: time.at(20),
      closedByServer: true,
    });
    expect(presentationLog.get(later.id)!.endedAt).toBeNull();
  });

  it('takes the coordinator’s own earlier end over the server’s', async () => {
    const { send, entry, presentationLog, time } = await setupRecords();
    const first = entry(0);
    await send([first]);
    await send([entry(20)]);
    await send([{ ...first, endedAt: time.at(15) }]);
    expect(presentationLog.get(first.id)).toMatchObject({
      endedAt: time.at(15),
      closedByServer: false,
    });
  });

  it('closes an open entry at the live state’s last activity when it expires (M4.5)', async () => {
    const { send, entry, presentationLog, instance, workspace, coordinator, time } =
      await setupRecords();
    const open = entry(0);
    await send([open]);
    const state = {
      status: 'live' as const,
      runSheetId: 'rs1',
      presented: null,
      lastShown: {},
      video: null,
      videoPositions: {},
      blank: false,
      revision: 1,
      appliedCommandIds: [],
      startedAt: time.at(0),
      updatedAt: time.at(0),
      lastActiveAt: time.at(600),
    };
    instance.putLive(
      workspace.id,
      coordinator.device.id,
      {
        revision: 1,
        coordinatorId: coordinator.device.id,
        state,
        date: '2026-11-15',
        items: [],
        presented: null,
        devices: [],
      },
      [],
    );
    time.advance(60 * 60_000);
    expect(presentationLog.closeExpired()).toBe(0);
    time.advance(5 * 60 * 60_000);
    expect(presentationLog.closeExpired()).toBe(1);
    expect(presentationLog.get(open.id)).toMatchObject({
      endedAt: state.lastActiveAt,
      closedByServer: true,
    });
  });

  it('stores the clock offset from the batch, and a day-late entry keeps its own times', async () => {
    const { send, entry, presentationLog, time } = await setupRecords();
    const late = entry(0, { endedAt: time.at(30) });
    time.advance(24 * 60 * 60_000);
    await send([late], undefined, new Date(Date.parse(time.now()) - 2000).toISOString());
    expect(presentationLog.get(late.id)).toMatchObject({
      startedAt: late.startedAt,
      endedAt: late.endedAt,
      clockOffsetMs: -2000,
    });
  });

  it('keeps entries shorter than a second that reach it: the floor is the desktop’s', async () => {
    const { send, entry, presentationLog, time } = await setupRecords();
    const short = entry(0, { endedAt: new Date(Date.parse(time.at(0)) + 400).toISOString() });
    await send([short]);
    expect(presentationLog.get(short.id)).not.toBeNull();
  });

  it('refuses a malformed batch', async () => {
    const { app, headers } = await setupRecords();
    const answer = await app.inject({
      method: 'POST',
      url: '/api/v1/presentation-log',
      headers: headers(),
      payload: { sentAt: 'now', entries: [{ id: 'x' }] },
    });
    expect(answer.statusCode).toBe(400);
  });
});

describe('the migration (M1.3)', () => {
  it('brings a database from 2.4.1 up, and round-trips both tables', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { openDatabase } = await import('./db');
    const { undoMcpMigration } = await import('./mcp/migration.testing');
    const dir = mkdtempSync(join(tmpdir(), 'worship-q-migrate-'));
    try {
      const path = join(dir, 'instance.db');
      const before = openDatabase(path);
      const version = Number(before.prepare('PRAGMA user_version').get()!.user_version);
      // The migrations since then are undone too, so that they run again.
      undoMcpMigration(before);
      before.exec('DROP TABLE stored_upload');
      before.exec('DROP TABLE presentation_log');
      before.exec('DROP TABLE audio_recording');
      before.exec(`DELETE FROM counter WHERE name = 'log'`);
      before.exec(`PRAGMA user_version = ${version - 3}`);
      before.close();
      const after = openDatabase(path);
      expect(Number(after.prepare('PRAGMA user_version').get()!.user_version)).toBe(version);
      const tables = after
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all()
        .map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining(['audio_recording', 'presentation_log']));
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
