import type { AdminDevice, LiveSnapshot } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  errorText,
  expiryText,
  formatBytes,
  formatAge,
  formatDate,
  formatDuration,
  groupDevicesByWorkspace,
  isPast,
  normalizePairingCode,
  obsOutputText,
  onScreen,
  orderDevices,
  parseRoute,
  relativeTime,
  routePath,
  usedPercent,
} from './format';

describe('parseRoute', () => {
  it('reads the sign-in page with and without an error code', () => {
    expect(parseRoute('/admin/')).toEqual({ page: 'home', error: null });
    expect(parseRoute('/admin')).toEqual({ page: 'home', error: null });
    expect(parseRoute('/admin/', '?error=not-administrator')).toEqual({
      page: 'home',
      error: 'not-administrator',
    });
  });

  it('reads every page', () => {
    expect(parseRoute('/admin/workspaces')).toEqual({ page: 'workspaces' });
    expect(parseRoute('/admin/workspaces/')).toEqual({ page: 'workspaces' });
    expect(parseRoute('/admin/workspaces/ws%2F1')).toEqual({ page: 'workspace', id: 'ws/1' });
    expect(parseRoute('/admin/devices')).toEqual({ page: 'devices', pairCode: null });
    expect(parseRoute('/admin/library')).toEqual({ page: 'library' });
    expect(parseRoute('/admin/administrators')).toEqual({ page: 'administrators' });
    expect(parseRoute('/admin/settings')).toEqual({ page: 'settings' });
    expect(parseRoute('/admin/storage')).toEqual({ page: 'storage' });
  });

  it('opens the devices page for the pairing deep link', () => {
    expect(parseRoute('/admin/pair', '?code=ABCD-2345')).toEqual({
      page: 'devices',
      pairCode: 'ABCD-2345',
    });
    expect(parseRoute('/admin/pair')).toEqual({ page: 'devices', pairCode: null });
  });

  it('reports unknown paths', () => {
    expect(parseRoute('/admin/nothing')).toEqual({ page: 'not-found' });
    expect(parseRoute('/admin/devices/extra')).toEqual({ page: 'not-found' });
    expect(parseRoute('/admin/workspaces/a/b')).toEqual({ page: 'not-found' });
  });

  it('round-trips through routePath', () => {
    for (const path of [
      '/admin/',
      '/admin/workspaces',
      '/admin/workspaces/abc',
      '/admin/devices',
      '/admin/library',
      '/admin/administrators',
      '/admin/settings',
      '/admin/storage',
    ]) {
      expect(routePath(parseRoute(path))).toBe(path);
    }
    expect(routePath({ page: 'devices', pairCode: 'ABCD-2345' })).toBe(
      '/admin/pair?code=ABCD-2345',
    );
    expect(routePath({ page: 'home', error: 'no-email' })).toBe('/admin/?error=no-email');
  });
});

describe('normalizePairingCode', () => {
  it('drops dashes, spaces and case', () => {
    expect(normalizePairingCode('abcd-2345')).toBe('ABCD2345');
    expect(normalizePairingCode(' ABCD 2345 ')).toBe('ABCD2345');
  });
});

describe('formatBytes', () => {
  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('keeps bytes whole and gives one decimal under ten', () => {
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12_345)).toBe('12 KB');
    expect(formatBytes(2_500_000)).toBe('2.5 MB');
    expect(formatBytes(48_000_000_000)).toBe('48 GB');
  });

  it('stays in terabytes above a terabyte', () => {
    expect(formatBytes(1_500_000_000_000)).toBe('1.5 TB');
    expect(formatBytes(2_000_000_000_000_000)).toBe('2,000 TB');
  });

  it('refuses nonsense', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('usedPercent', () => {
  it('shares the used part of the volume, clamped', () => {
    expect(usedPercent(25, 100)).toBe(75);
    expect(usedPercent(0, 0)).toBe(0);
    expect(usedPercent(150, 100)).toBe(0);
    expect(usedPercent(-10, 100)).toBe(100);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');

  it('speaks of the past', () => {
    expect(relativeTime('2026-11-02T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-11-02T11:59:00Z', now)).toBe('1 minute ago');
    expect(relativeTime('2026-11-02T11:15:00Z', now)).toBe('45 minutes ago');
    expect(relativeTime('2026-11-02T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-10-31T12:00:00Z', now)).toBe('2 days ago');
    expect(relativeTime('2026-08-02T12:00:00Z', now)).toBe('3 months ago');
    expect(relativeTime('2024-11-02T12:00:00Z', now)).toBe('2 years ago');
  });

  it('speaks of the future', () => {
    expect(relativeTime('2026-11-02T12:00:20Z', now)).toBe('in under a minute');
    expect(relativeTime('2026-11-02T12:12:00Z', now)).toBe('in 12 minutes');
    expect(relativeTime('2026-11-02T14:00:00Z', now)).toBe('in 2 hours');
  });

  it('does not throw on a bad timestamp', () => {
    expect(relativeTime('not a date', now)).toBe('unknown');
  });
});

describe('expiryText', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');

  it('says when the live state expires', () => {
    expect(expiryText('2026-11-02T12:30:00Z', now)).toBe('Expires in 30 minutes');
  });

  it('says an expiry in the past has passed', () => {
    expect(expiryText('2026-11-02T11:55:00Z', now)).toBe('Expired 5 minutes ago');
    expect(isPast('2026-11-02T11:55:00Z', now)).toBe(true);
    expect(isPast('2026-11-02T12:05:00Z', now)).toBe(false);
  });
});

describe('formatDate', () => {
  it('shows a run sheet date without shifting it by time zone', () => {
    expect(formatDate('2026-11-01')).toBe('Sunday 1st Nov');
    expect(formatDate('2026-11-12')).toBe('Thursday 12th Nov');
    expect(formatDate('garbage')).toBe('garbage');
  });
});

function snapshot(partial: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    revision: 3,
    coordinatorId: 'dev-1',
    date: '2026-11-01',
    items: [],
    presented: null,
    devices: [],
    state: {
      status: 'live',
      runSheetId: 'rs-1',
      presented: null,
      lastShown: {},
      video: null,
      videoPositions: {},
      blank: false,
      revision: 3,
      appliedCommandIds: [],
      startedAt: '2026-11-01T09:00:00Z',
      updatedAt: '2026-11-01T09:10:00Z',
      lastActiveAt: '2026-11-01T09:10:00Z',
    },
    ...partial,
  };
}

const presented = {
  itemId: 'item-1',
  pieceId: 'piece-2',
  songId: 'song-1',
  title: 'Amazing Grace',
  kind: 'lyrics' as const,
  pieces: [
    { id: 'piece-1', lines: ['Amazing grace', 'how sweet the sound'] },
    { id: 'piece-2', lines: ['That saved a wretch', 'like me'] },
  ],
  background: null,
  websiteUrl: null,
  previous: false,
};

describe('onScreen', () => {
  it('finds the presented piece by id', () => {
    expect(onScreen(snapshot({ presented }))).toEqual({
      blank: false,
      title: 'Amazing Grace',
      lines: ['That saved a wretch', 'like me'],
      pieceMissing: false,
    });
  });

  it('keeps the title when the piece is not among the pieces', () => {
    const result = onScreen(snapshot({ presented: { ...presented, pieceId: 'gone' } }));
    expect(result.title).toBe('Amazing Grace');
    expect(result.lines).toEqual([]);
    expect(result.pieceMissing).toBe(true);
  });

  it('reports a blank screen, with what is behind it', () => {
    const base = snapshot({ presented });
    const result = onScreen({ ...base, state: { ...base.state, blank: true } });
    expect(result.blank).toBe(true);
    expect(result.lines).toEqual(['That saved a wretch', 'like me']);
  });

  it('reports nothing presented', () => {
    expect(onScreen(snapshot())).toEqual({
      blank: false,
      title: null,
      lines: [],
      pieceMissing: false,
    });
  });

  it('names an untitled item', () => {
    expect(onScreen(snapshot({ presented: { ...presented, title: '' } })).title).toBe('Untitled');
  });
});

describe('orderDevices', () => {
  const device = (partial: Partial<AdminDevice>): AdminDevice => ({
    id: 'id',
    workspaceId: 'ws',
    workspaceName: 'Main',
    name: 'Laptop',
    createdAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    revokedAt: null,
    enrolledBy: 'code',
    approvedBy: null,
    connected: false,
    ...partial,
  });

  it('lists revoked devices last and groups the rest by workspace and name', () => {
    const ordered = orderDevices([
      device({ id: 'r1', name: 'Old', revokedAt: '2026-05-01T00:00:00Z' }),
      device({ id: 'b', workspaceName: 'Youth', name: 'Booth' }),
      device({ id: 'a', workspaceName: 'Main', name: 'Zed' }),
      device({ id: 'r2', name: 'Older', revokedAt: '2026-06-01T00:00:00Z' }),
      device({ id: 'c', workspaceName: 'Main', name: 'Alpha' }),
    ]);
    expect(ordered.map((d) => d.id)).toEqual(['c', 'a', 'b', 'r2', 'r1']);
  });

  it('groups by workspace name, then orders each group by device name', () => {
    const groups = groupDevicesByWorkspace([
      device({ id: 'y', workspaceId: 'w2', workspaceName: 'Sutton', name: 'Ren Win' }),
      device({ id: 'x', workspaceId: 'w2', workspaceName: 'Sutton', name: 'Iphren Air' }),
      device({
        id: 'r',
        workspaceId: 'w3',
        workspaceName: 'Bristol',
        name: 'Old',
        revokedAt: '2026-05-01T00:00:00Z',
      }),
      device({ id: 'm', workspaceId: 'w1', workspaceName: 'London', name: 'Mac mini' }),
      device({ id: 'a', workspaceId: 'w1', workspaceName: 'London', name: 'Air' }),
    ]);
    expect(groups.map((g) => [g.workspaceName, g.devices.map((d) => d.id)])).toEqual([
      ['Bristol', ['r']],
      ['London', ['a', 'm']],
      ['Sutton', ['x', 'y']],
    ]);
  });
});

describe('errorText', () => {
  it('explains known codes in plain words', () => {
    expect(errorText('not-administrator')).toMatch(/not an administrator/);
    expect(errorText('last-administrator')).toMatch(/last administrator cannot be removed/);
    expect(errorText('files-removed')).toMatch(/Files were removed/);
  });

  it('still names an unknown code', () => {
    expect(errorText('weird-thing')).toBe('Something went wrong (weird-thing).');
    expect(errorText('http-502', 502)).toBe('The server had a problem (http-502).');
  });
});

describe('OBS outputs', () => {
  const output = { active: true, phase: null, durationMs: 0, paused: false } as const;

  it('formats an image’s age', () => {
    expect(formatAge(4_400)).toBe('4 s');
    expect(formatAge(125_000)).toBe('2 min');
    expect(formatAge(7_300_000)).toBe('2 h');
  });

  it('formats running times', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('says what an output is doing, as the phone does', () => {
    expect(obsOutputText({ ...output, active: false, durationMs: null }, null)).toBe('Off');
    expect(obsOutputText({ ...output, phase: 'starting' }, 0)).toBe('Starting…');
    expect(obsOutputText({ ...output, phase: 'reconnecting' }, 5000)).toBe('Reconnecting…');
    expect(obsOutputText(output, 61_000)).toBe('1:01');
    expect(obsOutputText({ ...output, paused: true }, 61_000)).toBe('1:01 · Paused');
    expect(obsOutputText({ ...output, durationMs: null }, null)).toBe('On');
  });
});
