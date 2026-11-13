import type { AudioState } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { AudioHub, EVERY_SESSION, newerAudioState, stampActivation, type AudioOut } from './audio';
import { Follower } from './coordination';

function audio(ownerId: string, patch: Partial<AudioState> = {}): AudioState {
  return {
    ownerId,
    ownerName: `Computer ${ownerId}`,
    activatedAt: '2026-11-13T09:00:00.000Z',
    revision: 1,
    active: true,
    status: 'live',
    inputName: 'Scarlett 2i2 USB',
    listeners: 0,
    ...patch,
  };
}

const to = (out: AudioOut[], device: string) =>
  out.filter((each) => each.to === device).map((each) => each.message);

const names: Record<string, string> = { A: 'Sound desk', B: 'Booth', C: 'Laptop', H: 'Hub' };
const hub = (self = 'H') => new AudioHub(self, (id) => names[id] ?? '');

describe('which audio state wins (A3)', () => {
  it('takes the later activation, and drops an earlier one', () => {
    const earlier = audio('A', { activatedAt: '2026-11-13T09:00:00.000Z' });
    const later = audio('B', { activatedAt: '2026-11-13T09:05:00.000Z' });
    expect(newerAudioState(later, earlier)).toBe(true);
    expect(newerAudioState(earlier, later)).toBe(false);
  });

  it('breaks equal times on the device id, the same way everywhere', () => {
    expect(newerAudioState(audio('B'), audio('A'))).toBe(true);
    expect(newerAudioState(audio('A'), audio('B'))).toBe(false);
  });

  it('always takes the same owner’s next revision', () => {
    expect(newerAudioState(audio('A', { revision: 3 }), audio('A', { revision: 2 }))).toBe(true);
    expect(newerAudioState(audio('A', { revision: 2 }), audio('A', { revision: 3 }))).toBe(false);
  });

  it('takes a lower revision after the owner’s app restarted with a newer activation', () => {
    const before = audio('A', { revision: 40 });
    const restarted = audio('A', { revision: 1, activatedAt: '2026-11-13T10:00:00.000Z' });
    expect(newerAudioState(restarted, before)).toBe(true);
  });

  it('never lets a switched-off state hold against another computer’s active one', () => {
    const off = audio('A', { active: false, activatedAt: '2026-11-13T11:00:00.000Z' });
    expect(newerAudioState(audio('B'), off)).toBe(true);
    expect(newerAudioState(off, audio('B'))).toBe(false);
  });
});

describe('stamping a press of the switch (§3.1)', () => {
  it('uses this computer’s clock when it is ahead', () => {
    const now = Date.parse('2026-11-13T09:10:00.000Z');
    expect(stampActivation(now, '2026-11-13T09:00:00.000Z')).toBe('2026-11-13T09:10:00.000Z');
  });

  it('stamps a millisecond after the newest activation seen when the clock is behind', () => {
    // B's clock is five minutes behind A's, and B switches on after A.
    const now = Date.parse('2026-11-13T09:00:00.000Z');
    const stamped = stampActivation(now, '2026-11-13T09:05:00.000Z');
    expect(stamped).toBe('2026-11-13T09:05:00.001Z');
    expect(
      newerAudioState(
        audio('B', { activatedAt: stamped }),
        audio('Z', {
          activatedAt: '2026-11-13T09:05:00.000Z',
        }),
      ),
    ).toBe(true);
  });

  it('uses the clock when nothing has been seen', () => {
    expect(stampActivation(0, null)).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('the coordinator’s forwarding (M1.5)', () => {
  it('sends the state to every device of the audience but its owner', () => {
    const h = hub();
    h.setAudience(['A', 'B', 'C']);
    const out = h.receive('A', { type: 'audioState', state: audio('A') });
    expect(to(out, 'A')).toEqual([]);
    expect(to(out, 'B')).toEqual([{ type: 'audioState', state: audio('A') }]);
    expect(to(out, 'C')).toHaveLength(1);
    expect(to(out, 'H')).toHaveLength(1);
  });

  it('sends nothing to a device without the capability', () => {
    const h = hub();
    h.setAudience(['A']);
    const out = h.receive('A', { type: 'audioState', state: audio('A') });
    expect(out.some((each) => each.to === 'B')).toBe(false);
  });

  it('tells a device that joins the current state, or null', () => {
    const h = hub();
    expect(h.setAudience(['B'])).toEqual([
      { to: 'B', message: { type: 'audioState', state: null } },
    ]);
    h.receive('A', { type: 'audioState', state: audio('A') });
    expect(to(h.setAudience(['A', 'B', 'C']), 'C')).toEqual([
      { type: 'audioState', state: audio('A') },
    ]);
  });

  it('refuses a state sent for another device', () => {
    const h = hub();
    h.setAudience(['A', 'B']);
    expect(h.receive('B', { type: 'audioState', state: audio('A') })).toEqual([]);
    expect(h.state).toBeNull();
  });

  it('tells a computer that switched on earlier who holds the state, so it switches off', () => {
    const h = hub();
    h.setAudience(['A', 'B']);
    h.receive('B', {
      type: 'audioState',
      state: audio('B', { activatedAt: '2026-11-13T09:05:00.000Z' }),
    });
    const out = h.receive('A', { type: 'audioState', state: audio('A') });
    expect(out).toEqual([{ to: 'A', message: { type: 'audioState', state: h.state } }]);
    expect(h.state?.ownerId).toBe('B');
  });

  it('clears the state when its owner switches off, and ignores another’s off', () => {
    const h = hub();
    h.setAudience(['A', 'B']);
    h.receive('A', { type: 'audioState', state: audio('A') });
    const ignored = h.receive('B', { type: 'audioState', state: audio('B', { active: false }) });
    expect(ignored.every((each) => each.to === 'B')).toBe(true);
    expect(h.state?.ownerId).toBe('A');
    const out = h.receive('A', {
      type: 'audioState',
      state: audio('A', { revision: 2, active: false }),
    });
    expect(h.state).toBeNull();
    expect(to(out, 'B')).toEqual([{ type: 'audioState', state: null }]);
  });

  it('drops the state when its owner leaves, telling everyone', () => {
    const h = hub();
    h.setAudience(['A', 'B', 'C']);
    h.receive('A', { type: 'audioState', state: audio('A') });
    const out = h.setAudience(['B', 'C']);
    expect(h.state).toBeNull();
    expect(to(out, 'B')).toEqual([{ type: 'audioState', state: null }]);
    expect(to(out, 'C')).toEqual([{ type: 'audioState', state: null }]);
  });

  it('tells the broadcaster when a listener leaves, to close its sessions now', () => {
    const h = hub();
    h.setAudience(['A', 'B']);
    h.receive('A', { type: 'audioState', state: audio('A') });
    const out = h.setAudience(['A']);
    expect(to(out, 'A')).toEqual([
      {
        type: 'audioSignal',
        from: 'B',
        listener: { kind: 'desktop', deviceId: 'B', name: 'Booth' },
        signal: { kind: 'close', session: EVERY_SESSION, reason: 'gone' },
      },
    ]);
  });

  it('passes a signal to its addressee only, naming the sender from the connection', () => {
    const h = hub();
    h.setAudience(['A', 'B', 'C']);
    h.receive('A', { type: 'audioState', state: audio('A') });
    const out = h.receive('B', {
      type: 'audioSignal',
      to: 'A',
      signal: { kind: 'listen', session: 's1' },
    });
    expect(out).toEqual([
      {
        to: 'A',
        message: {
          type: 'audioSignal',
          from: 'B',
          listener: { kind: 'desktop', deviceId: 'B', name: 'Booth' },
          signal: { kind: 'listen', session: 's1' },
        },
      },
    ]);
  });

  it('names the addressee as the listener when the broadcaster answers', () => {
    const h = hub();
    h.setAudience(['A', 'B', 'C']);
    h.receive('A', { type: 'audioState', state: audio('A') });
    const out = h.receive('A', {
      type: 'audioSignal',
      to: 'B',
      signal: { kind: 'offer', session: 's1', sdp: 'v=0' },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.to).toBe('B');
    expect(out[0]!.message).toMatchObject({
      from: 'A',
      listener: { kind: 'desktop', deviceId: 'B' },
    });
  });

  it('carries a phone as the listener, both ways', () => {
    const h = hub();
    h.setAudience(['A', 'B']);
    h.receive('A', { type: 'audioState', state: audio('A') });
    const phone = { grantId: 'g1', name: 'Anna’s phone' };
    const up = h.receive('B', {
      type: 'audioSignal',
      to: 'A',
      phone,
      signal: { kind: 'listen', session: 's' },
    });
    expect(up[0]!.message).toMatchObject({ listener: { kind: 'phone', grantId: 'g1' } });
    const down = h.receive('A', {
      type: 'audioSignal',
      to: 'B',
      phone,
      signal: { kind: 'retaken', session: 's' },
    });
    expect(down[0]).toMatchObject({
      to: 'B',
      message: { listener: { kind: 'phone', grantId: 'g1' } },
    });
  });

  it('answers a signal for a device that is gone with close', () => {
    const h = hub();
    h.setAudience(['B']);
    const out = h.receive('B', {
      type: 'audioSignal',
      to: 'A',
      signal: { kind: 'listen', session: 's1' },
    });
    expect(out).toEqual([
      {
        to: 'B',
        message: {
          type: 'audioSignal',
          from: 'A',
          listener: { kind: 'desktop', deviceId: 'B', name: 'Booth' },
          signal: { kind: 'close', session: 's1', reason: 'gone' },
        },
      },
    ]);
    // A close is never answered with a close.
    expect(
      h.receive('B', {
        type: 'audioSignal',
        to: 'A',
        signal: { kind: 'close', session: 's1', reason: 'stopped' },
      }),
    ).toEqual([]);
  });

  it('handles a signal addressed to itself locally', () => {
    const h = hub('A');
    h.setAudience(['B']);
    h.receive('A', { type: 'audioState', state: audio('A') });
    const out = h.receive('B', {
      type: 'audioSignal',
      to: 'A',
      signal: { kind: 'listen', session: 's' },
    });
    expect(out.map((each) => each.to)).toEqual(['A']);
  });

  it('forwards a signal from a device before its capabilities are known: it speaks audio', () => {
    const h = hub();
    h.setAudience(['A']);
    h.receive('A', { type: 'audioState', state: audio('A') });
    expect(
      h.receive('B', { type: 'audioSignal', to: 'A', signal: { kind: 'listen', session: 's' } })[0]!
        .to,
    ).toBe('A');
    // And B now hears from the broadcaster.
    expect(
      h.receive('A', { type: 'audioSignal', to: 'B', signal: { kind: 'full', session: 's' } })[0]!
        .to,
    ).toBe('B');
  });
});

describe('older devices (§3.2)', () => {
  it('a follower ignores audio messages it does not handle itself', () => {
    const follower = new Follower();
    expect(follower.receive({ type: 'audioState', state: audio('A') })).toEqual([]);
    expect(
      follower.receive({
        type: 'audioSignal',
        from: 'A',
        listener: { kind: 'desktop', deviceId: 'B', name: '' },
        signal: { kind: 'full', session: 's' },
      }),
    ).toEqual([]);
  });
});
