import type { ObsOutput, ObsState } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  liveFavourite,
  newerObsState,
  ObsHub,
  outputElapsed,
  switchTarget,
  type ObsOut,
} from './obs';

const idle: ObsOutput = { active: false, phase: null, durationMs: null, paused: false };

function obs(ownerId: string, patch: Partial<ObsState> = {}): ObsState {
  return {
    ownerId,
    ownerName: `Computer ${ownerId}`,
    activatedAt: '2026-11-08T09:00:00.000Z',
    revision: 1,
    active: true,
    status: 'connected',
    scenes: ['Lyrics', 'Camera', 'Blank'],
    currentScene: 'Lyrics',
    favourites: ['Lyrics', 'Camera'],
    stream: idle,
    record: idle,
    virtualCam: idle,
    ...patch,
  };
}

const to = (out: ObsOut[], device: string) =>
  out.filter((each) => each.to === device).map((each) => each.message);

describe('which OBS state wins (O9)', () => {
  it('takes any state when there is none', () => {
    expect(newerObsState(obs('A'), null)).toBe(true);
  });

  it('gives the state to the later activation', () => {
    const earlier = obs('A', { activatedAt: '2026-11-08T09:00:00.000Z' });
    const later = obs('B', { activatedAt: '2026-11-08T09:05:00.000Z' });
    expect(newerObsState(later, earlier)).toBe(true);
    expect(newerObsState(earlier, later)).toBe(false);
  });

  it('breaks a tie on the device id, the same way on every device', () => {
    const a = obs('A');
    const b = obs('B');
    expect(newerObsState(b, a)).toBe(true);
    expect(newerObsState(a, b)).toBe(false);
  });

  it('orders one activation’s states by revision, dropping a late older one', () => {
    expect(newerObsState(obs('A', { revision: 3 }), obs('A', { revision: 2 }))).toBe(true);
    expect(newerObsState(obs('A', { revision: 2 }), obs('A', { revision: 3 }))).toBe(false);
    expect(newerObsState(obs('A', { revision: 2 }), obs('A', { revision: 2 }))).toBe(false);
  });

  it('takes a new activation of the same computer whatever its revision', () => {
    const before = obs('A', { revision: 40 });
    const again = obs('A', { activatedAt: '2026-11-08T10:00:00.000Z', revision: 0 });
    expect(newerObsState(again, before)).toBe(true);
    expect(newerObsState(before, again)).toBe(false);
  });

  it('never lets a link that was turned off hold the state against an active one', () => {
    // Computer B turned its link off after A's; A's earlier activation is still good.
    const off = obs('B', { activatedAt: '2026-11-08T10:00:00.000Z', active: false });
    const on = obs('A', { activatedAt: '2026-11-08T09:00:00.000Z' });
    expect(newerObsState(on, off)).toBe(true);
    expect(newerObsState(off, on)).toBe(false);
  });

  it('settles a time that does not read without throwing, the same way everywhere', () => {
    const odd = obs('B', { activatedAt: 'not a time' });
    expect(newerObsState(odd, obs('A'))).toBe(newerObsState(odd, obs('A')));
    expect(newerObsState(obs('A'), odd)).toBe(!newerObsState(odd, obs('A')));
  });
});

describe('the switch button (O4)', () => {
  const view = (currentScene: string | null, favourites: [string | null, string | null]) => ({
    scenes: ['Lyrics', 'Camera', 'Blank'],
    currentScene,
    favourites,
  });

  it('switches to the other favourite when one is live', () => {
    expect(switchTarget(view('Lyrics', ['Lyrics', 'Camera']))).toBe('Camera');
    expect(switchTarget(view('Camera', ['Lyrics', 'Camera']))).toBe('Lyrics');
    expect(liveFavourite(view('Camera', ['Lyrics', 'Camera']))).toBe(1);
  });

  it('goes to the first favourite from a third scene', () => {
    expect(switchTarget(view('Blank', ['Lyrics', 'Camera']))).toBe('Lyrics');
    expect(switchTarget(view(null, ['Lyrics', 'Camera']))).toBe('Lyrics');
    expect(liveFavourite(view('Blank', ['Lyrics', 'Camera']))).toBeNull();
  });

  it('skips a favourite OBS no longer has, and goes nowhere when there is nothing to switch to', () => {
    expect(switchTarget(view('Blank', ['Gone', 'Camera']))).toBe('Camera');
    expect(switchTarget(view('Camera', ['Gone', 'Camera']))).toBeNull();
    expect(switchTarget(view('Blank', ['Gone', null]))).toBeNull();
    expect(switchTarget(view('Blank', [null, null]))).toBeNull();
  });

  it('treats the same scene chosen twice as one favourite', () => {
    expect(switchTarget(view('Blank', ['Camera', 'Camera']))).toBe('Camera');
    expect(switchTarget(view('Camera', ['Camera', 'Camera']))).toBeNull();
  });
});

describe('output timers', () => {
  const running = { active: true, phase: null, durationMs: 60_000, paused: false };

  it('adds the time since the state was received, on the receiver’s clock', () => {
    expect(outputElapsed(running, 1000, 6000)).toBe(65_000);
    // A clock that went backwards never makes the time shrink below what was sent.
    expect(outputElapsed(running, 6000, 1000)).toBe(60_000);
  });

  it('holds a paused recording still, and shows nothing for an idle output', () => {
    expect(outputElapsed({ ...running, paused: true }, 1000, 9000)).toBe(60_000);
    expect(outputElapsed(idle, 0, 1000)).toBeNull();
  });
});

describe('the coordinator forwarding OBS messages (M2.3)', () => {
  /** Coordinator C; followers A (the OBS computer), B, and V, a version 3 desktop. */
  function hub() {
    const h = new ObsHub('C');
    h.setAudience(['A', 'B']);
    return h;
  }

  it('passes the owner’s state to every device that takes OBS messages, and no other', () => {
    const h = hub();
    const out = h.receive('A', { type: 'obsState', state: obs('A') });
    expect(to(out, 'B')).toEqual([{ type: 'obsState', state: obs('A') }]);
    expect(to(out, 'C')).toEqual([{ type: 'obsState', state: obs('A') }]);
    // Not back to the owner, and never to V, which did not declare the capability.
    const recipients = out.filter((each) => each.message.type === 'obsState').map((e) => e.to);
    expect(recipients.sort()).toEqual(['B', 'C']);
    expect(out.some((each) => each.to === 'V')).toBe(false);
    expect(h.state).toEqual(obs('A'));
  });

  it('gives the last state to a device that connects later, and nothing when there is none', () => {
    const h = hub();
    expect(h.setAudience(['A', 'B', 'D'])).toEqual([
      { to: 'D', message: { type: 'obsState', state: null } },
    ]);
    h.receive('A', { type: 'obsState', state: obs('A') });
    expect(h.greet('B')).toEqual([{ to: 'B', message: { type: 'obsState', state: obs('A') } }]);
  });

  it('refuses a state a device sends in another device’s name', () => {
    const h = hub();
    expect(h.receive('B', { type: 'obsState', state: obs('A') })).toEqual([]);
    expect(h.state).toBeNull();
  });

  it('drops an older state of the same activation that arrives late', () => {
    const h = hub();
    h.receive('A', { type: 'obsState', state: obs('A', { revision: 5, currentScene: 'Camera' }) });
    expect(h.receive('A', { type: 'obsState', state: obs('A', { revision: 4 }) })).toEqual([]);
    expect(h.state?.currentScene).toBe('Camera');
  });

  it('hands the state to a later activation elsewhere, and tells the earlier one, which then turns off', () => {
    const h = hub();
    h.receive('A', { type: 'obsState', state: obs('A') });
    const later = obs('B', { activatedAt: '2026-11-08T09:30:00.000Z' });
    const out = h.receive('B', { type: 'obsState', state: later });
    expect(to(out, 'A')).toEqual([{ type: 'obsState', state: later }]);
    // A had not heard yet and sends its state again: it is told who holds the state now.
    const reply = h.receive('A', { type: 'obsState', state: obs('A', { revision: 2 }) });
    expect(reply).toEqual([{ to: 'A', message: { type: 'obsState', state: later } }]);
    expect(h.state).toEqual(later);
  });

  it('settles two activations that crossed on the way the same way whichever arrives first', () => {
    const a = obs('A', { activatedAt: '2026-11-08T09:30:00.000Z' });
    const b = obs('B', { activatedAt: '2026-11-08T09:30:01.000Z' });
    const first = hub();
    first.receive('A', { type: 'obsState', state: a });
    first.receive('B', { type: 'obsState', state: b });
    const second = hub();
    second.receive('B', { type: 'obsState', state: b });
    second.receive('A', { type: 'obsState', state: a });
    expect(first.state).toEqual(b);
    expect(second.state).toEqual(b);
  });

  it('lets the owner turn its link off, so the controls disappear everywhere, and lets another take over after', () => {
    const h = hub();
    h.receive('A', { type: 'obsState', state: obs('A') });
    const off = obs('A', { revision: 2, active: false });
    expect(to(h.receive('A', { type: 'obsState', state: off }), 'B')).toEqual([
      { type: 'obsState', state: off },
    ]);
    // B's link was activated earlier than A's, but A's is off now: B's is taken.
    const earlierB = obs('B', { activatedAt: '2026-11-08T08:00:00.000Z' });
    const out = h.receive('B', { type: 'obsState', state: earlierB });
    expect(h.state).toEqual(earlierB);
    expect(to(out, 'A')).toEqual([{ type: 'obsState', state: earlierB }]);
  });

  it('forwards a command to the owner and its answer to the device that asked only', () => {
    const h = hub();
    h.receive('A', { type: 'obsState', state: obs('A') });
    const command = { type: 'setScene' as const, scene: 'Camera' };
    expect(h.receive('B', { type: 'obsCommand', id: 'c1', command })).toEqual([
      { to: 'A', message: { type: 'obsCommand', id: 'c1', command } },
    ]);
    // Another device cannot answer for the owner.
    expect(h.receive('B', { type: 'obsAck', id: 'c1', ok: true })).toEqual([]);
    expect(h.receive('A', { type: 'obsAck', id: 'c1', ok: true })).toEqual([
      { to: 'B', message: { type: 'obsAck', id: 'c1', ok: true } },
    ]);
    // Answered once only.
    expect(h.receive('A', { type: 'obsAck', id: 'c1', ok: true })).toEqual([]);
  });

  it('answers a command at once when no device has OBS', () => {
    const h = hub();
    expect(
      h.receive('B', { type: 'obsCommand', id: 'c1', command: { type: 'startStream' } }),
    ).toEqual([{ to: 'B', message: { type: 'obsAck', id: 'c1', ok: false, error: 'no-obs' } }]);
    h.receive('A', { type: 'obsState', state: obs('A') });
    h.receive('A', { type: 'obsState', state: obs('A', { revision: 2, active: false }) });
    expect(
      h.receive('B', { type: 'obsCommand', id: 'c2', command: { type: 'startStream' } }),
    ).toEqual([{ to: 'B', message: { type: 'obsAck', id: 'c2', ok: false, error: 'no-obs' } }]);
  });

  it('carries the coordinator’s own command and answer like any other device’s', () => {
    const h = hub();
    h.receive('A', { type: 'obsState', state: obs('A') });
    h.receive('C', { type: 'obsCommand', id: 'c1', command: { type: 'stopRecord' } });
    expect(h.receive('A', { type: 'obsAck', id: 'c1', ok: false, code: 501 })).toEqual([
      { to: 'C', message: { type: 'obsAck', id: 'c1', ok: false, code: 501 } },
    ]);
  });

  it('forwards to the coordinator itself when it is the OBS computer', () => {
    const h = hub();
    h.receive('C', { type: 'obsState', state: obs('C') });
    expect(
      h.receive('B', { type: 'obsCommand', id: 'c1', command: { type: 'startRecord' } }),
    ).toEqual([
      { to: 'C', message: { type: 'obsCommand', id: 'c1', command: { type: 'startRecord' } } },
    ]);
    expect(h.receive('C', { type: 'obsAck', id: 'c1', ok: true })).toEqual([
      { to: 'B', message: { type: 'obsAck', id: 'c1', ok: true } },
    ]);
  });

  it('drops the state when its owner leaves, and fails the commands it had not answered', () => {
    const h = hub();
    h.receive('A', { type: 'obsState', state: obs('A') });
    h.receive('B', { type: 'obsCommand', id: 'c1', command: { type: 'stopStream' } });
    const out = h.setAudience(['B']);
    expect(to(out, 'B')).toEqual([
      { type: 'obsAck', id: 'c1', ok: false, error: 'owner-left' },
      { type: 'obsState', state: null },
    ]);
    expect(to(out, 'C')).toEqual([{ type: 'obsState', state: null }]);
    expect(h.state).toBeNull();
    // A late answer from the owner that left goes nowhere.
    expect(h.receive('A', { type: 'obsAck', id: 'c1', ok: true })).toEqual([]);
  });

  it('fails the waiting commands when another computer takes OBS over', () => {
    const h = hub();
    h.receive('A', { type: 'obsState', state: obs('A') });
    h.receive('C', { type: 'obsCommand', id: 'c1', command: { type: 'startStream' } });
    const out = h.receive('B', {
      type: 'obsState',
      state: obs('B', { activatedAt: '2026-11-08T10:00:00.000Z' }),
    });
    expect(to(out, 'C')).toContainEqual({
      type: 'obsAck',
      id: 'c1',
      ok: false,
      error: 'owner-left',
    });
  });

  it('forgets the question of a device that left, without failing anyone else’s', () => {
    const h = hub();
    h.setAudience(['A', 'B', 'D']);
    h.receive('A', { type: 'obsState', state: obs('A') });
    h.receive('B', { type: 'obsCommand', id: 'b1', command: { type: 'startStream' } });
    h.receive('D', { type: 'obsCommand', id: 'd1', command: { type: 'startStream' } });
    expect(h.setAudience(['A', 'B'])).toEqual([]);
    expect(h.receive('A', { type: 'obsAck', id: 'd1', ok: true })).toEqual([]);
    expect(h.receive('A', { type: 'obsAck', id: 'b1', ok: true })).toEqual([
      { to: 'B', message: { type: 'obsAck', id: 'b1', ok: true } },
    ]);
  });

  describe('the live monitor (O6, M5.1)', () => {
    it('tells the owner when the first device starts watching and when the last stops', () => {
      const h = hub();
      h.setAudience(['A', 'B', 'D']);
      h.receive('A', { type: 'obsState', state: obs('A') });
      expect(h.receive('B', { type: 'obsWatch', watching: true })).toEqual([
        { to: 'A', message: { type: 'obsWatch', watching: true } },
      ]);
      expect(h.receive('D', { type: 'obsWatch', watching: true })).toEqual([]);
      expect(h.receive('B', { type: 'obsWatch', watching: false })).toEqual([]);
      expect(h.receive('D', { type: 'obsWatch', watching: false })).toEqual([
        { to: 'A', message: { type: 'obsWatch', watching: false } },
      ]);
    });

    it('stops the owner’s screenshots when the last watcher disconnects without saying so', () => {
      const h = hub();
      h.receive('A', { type: 'obsState', state: obs('A') });
      h.receive('B', { type: 'obsWatch', watching: true });
      expect(h.setAudience(['A'])).toEqual([
        { to: 'A', message: { type: 'obsWatch', watching: false } },
      ]);
    });

    it('sends the images only to devices watching, never to the owner or anyone else', () => {
      const h = hub();
      h.setAudience(['A', 'B', 'D']);
      h.receive('A', { type: 'obsState', state: obs('A') });
      h.receive('B', { type: 'obsWatch', watching: true });
      h.receive('A', { type: 'obsWatch', watching: true });
      const image = {
        type: 'obsSnapshot' as const,
        image: 'data:image/webp;base64,AAAA',
        takenAt: 't',
      };
      expect(h.receive('A', image)).toEqual([{ to: 'B', message: image }]);
      // Only the owner's images are passed on.
      expect(h.receive('B', image)).toEqual([]);
    });

    it('does not count the owner watching its own panel as anyone else watching', () => {
      const h = hub();
      h.receive('A', { type: 'obsState', state: obs('A') });
      expect(h.receive('A', { type: 'obsWatch', watching: true })).toEqual([]);
    });

    it('tells a new owner that devices are already watching', () => {
      const h = hub();
      h.receive('A', { type: 'obsState', state: obs('A') });
      h.receive('C', { type: 'obsWatch', watching: true });
      const out = h.receive('B', {
        type: 'obsState',
        state: obs('B', { activatedAt: '2026-11-08T10:00:00.000Z' }),
      });
      expect(to(out, 'B')).toEqual([{ type: 'obsWatch', watching: true }]);
    });

    it('tells an owner that comes back where watching stands, even if nothing changed meanwhile', () => {
      const h = hub();
      h.receive('A', { type: 'obsState', state: obs('A') });
      // A reconnected and forgot; nobody watches, and it must hear so to stop shooting.
      expect(h.greet('A')).toEqual([
        { to: 'A', message: { type: 'obsState', state: obs('A') } },
        { to: 'A', message: { type: 'obsWatch', watching: false } },
      ]);
      // After its owner left and came back, its new state is told the same.
      h.receive('B', { type: 'obsWatch', watching: true });
      h.setAudience(['B']);
      h.setAudience(['A', 'B']);
      const out = h.receive('A', { type: 'obsState', state: obs('A', { revision: 2 }) });
      expect(to(out, 'A')).toEqual([{ type: 'obsWatch', watching: true }]);
    });
  });
});
