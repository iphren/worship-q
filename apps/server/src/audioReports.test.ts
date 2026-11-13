import type { AudioSignal, AudioState } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_IDLE_MS,
  ADMIN_SIGNAL_TTL_MS,
  AUDIO_REPORT_TTL_MS,
  AudioReports,
} from './audioReports';

function audio(ownerId: string, patch: Partial<AudioState> = {}): AudioState {
  return {
    ownerId,
    ownerName: `Computer ${ownerId}`,
    activatedAt: '2026-11-13T09:00:00.000Z',
    revision: 1,
    active: true,
    status: 'live',
    inputName: null,
    listeners: 0,
    ...patch,
  };
}

function setup(reachable = true) {
  let now = 0;
  const sent: { workspaceId: string; deviceId: string; name: string; signal: AudioSignal }[] = [];
  const reports = new AudioReports(
    () => now,
    (workspaceId, deviceId, name, signal) => {
      if (!reachable) return false;
      sent.push({ workspaceId, deviceId, name, signal });
      return true;
    },
  );
  return { reports, sent, advance: (ms: number) => (now += ms) };
}

describe('audio reports (A21, M5.5)', () => {
  it('replaces the broadcaster’s last report; another’s only with a later activation', () => {
    const { reports } = setup();
    expect(reports.put('w', 'A', audio('A'))).toBe(true);
    expect(reports.put('w', 'A', audio('A', { revision: 2, listeners: 3 }))).toBe(true);
    expect(reports.get('w')?.state.listeners).toBe(3);
    expect(reports.put('w', 'B', audio('B', { activatedAt: '2026-11-13T08:00:00.000Z' }))).toBe(
      false,
    );
    expect(reports.put('w', 'B', audio('B', { activatedAt: '2026-11-13T10:00:00.000Z' }))).toBe(
      true,
    );
    expect(reports.get('w')?.deviceId).toBe('B');
  });

  it('refuses a report from a device that is not the state’s owner', () => {
    const { reports } = setup();
    expect(reports.put('w', 'B', audio('A'))).toBe(false);
    expect(reports.get('w')).toBeNull();
  });

  it('forgets a report not renewed in 90 s, and clears at once on switching off', () => {
    const { reports, advance } = setup();
    reports.put('w', 'A', audio('A'));
    advance(AUDIO_REPORT_TTL_MS);
    expect(reports.get('w')).not.toBeNull();
    advance(1);
    expect(reports.get('w')).toBeNull();
    reports.put('w', 'A', audio('A'));
    reports.put('w', 'A', audio('A', { active: false, revision: 2 }));
    expect(reports.get('w')).toBeNull();
  });

  it('keeps one workspace’s report apart from another’s', () => {
    const { reports } = setup();
    reports.put('w1', 'A', audio('A'));
    expect(reports.get('w2')).toBeNull();
  });
});

describe('administrators listening (A14, A22, M5.7)', () => {
  it('makes a session on listen and hands the signal to the broadcaster, in the administrator’s name', () => {
    const { reports, sent } = setup();
    reports.put('w', 'A', audio('A'));
    const result = reports.adminSignal('w', 'admin-1', 'Pastor', null, { kind: 'listen' });
    expect(result).toEqual({ session: expect.stringMatching(/^admin-/) });
    const session = (result as { session: string }).session;
    expect(sent).toEqual([
      { workspaceId: 'w', deviceId: 'A', name: 'Pastor', signal: { kind: 'listen', session } },
    ]);
  });

  it('says not broadcasting, or unreachable, at once', () => {
    const quiet = setup();
    expect(quiet.reports.adminSignal('w', 'x', 'X', null, { kind: 'listen' })).toEqual({
      error: 'not-broadcasting',
    });
    const away = setup(false);
    away.reports.put('w', 'A', audio('A'));
    expect(away.reports.adminSignal('w', 'x', 'X', null, { kind: 'listen' })).toEqual({
      error: 'unreachable',
    });
  });

  it('queues the broadcaster’s answers for that session only, in order, each once', () => {
    const { reports } = setup();
    reports.put('w', 'A', audio('A'));
    const one = (
      reports.adminSignal('w', 'x', 'X', null, { kind: 'listen' }) as { session: string }
    ).session;
    const two = (
      reports.adminSignal('w', 'x', 'X', null, { kind: 'listen' }) as { session: string }
    ).session;
    expect(one).not.toBe(two);
    reports.fromBroadcaster('w', 'A', { kind: 'offer', session: one, sdp: 'v=0' });
    reports.fromBroadcaster('w', 'A', {
      kind: 'candidate',
      session: one,
      candidate: { candidate: 'c' },
    });
    reports.fromBroadcaster('w', 'B', { kind: 'offer', session: one, sdp: 'not the owner' });
    const first = reports.poll('w', 'x', one, 0)!;
    expect(first.signals.map((s) => s.signal.kind)).toEqual(['offer', 'candidate']);
    expect(first.first).toBe(true);
    const after = first.signals.at(-1)!.seq;
    const again = reports.poll('w', 'x', one, after)!;
    expect(again.signals).toEqual([]);
    expect(again.first).toBe(false);
    expect(reports.poll('w', 'x', two, 0)!.signals).toEqual([]);
  });

  it('refuses a poll or a signal for a session that is not the asker’s', () => {
    const { reports } = setup();
    reports.put('w', 'A', audio('A'));
    const session = (
      reports.adminSignal('w', 'x', 'X', null, { kind: 'listen' }) as { session: string }
    ).session;
    expect(reports.poll('w', 'someone-else', session, 0)).toBeNull();
    expect(
      reports.adminSignal('w', 'someone-else', 'Y', session, {
        kind: 'answer',
        session,
        sdp: 'v=0',
      }),
    ).toEqual({ error: 'no-session' });
  });

  it('closes a session that has not polled for 30 s, towards the broadcaster', () => {
    const { reports, sent, advance } = setup();
    reports.put('w', 'A', audio('A'));
    const session = (
      reports.adminSignal('w', 'x', 'X', null, { kind: 'listen' }) as { session: string }
    ).session;
    advance(ADMIN_SESSION_IDLE_MS + 1);
    reports.sweep();
    expect(sent.at(-1)!.signal).toEqual({ kind: 'close', session, reason: 'timeout' });
    expect(reports.poll('w', 'x', session, 0)).toBeNull();
  });

  it('drops answers older than 60 s', () => {
    const { reports, advance } = setup();
    reports.put('w', 'A', audio('A'));
    const session = (
      reports.adminSignal('w', 'x', 'X', null, { kind: 'listen' }) as { session: string }
    ).session;
    reports.fromBroadcaster('w', 'A', { kind: 'offer', session, sdp: 'v=0' });
    for (let i = 0; i < 3; i++) {
      advance(ADMIN_SIGNAL_TTL_MS / 3);
      reports.poll('w', 'x', session, 0);
    }
    advance(1);
    expect(reports.poll('w', 'x', session, 0)!.signals).toEqual([]);
  });
});
