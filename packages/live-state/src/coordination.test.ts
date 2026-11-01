import type {
  CommandOrigin,
  FollowerToCoordinator,
  LiveSnapshot,
  OperatorCommand,
  WorkspaceGrant,
} from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  chooseRecovery,
  Coordinator,
  CoordinatorWatch,
  createLiveState,
  Follower,
  resolveCoordinators,
  type Command,
  type LiveState,
  type PlayablePiece,
  type SnapshotBody,
} from './index';

const T0 = '2026-10-11T09:00:00.000Z';
const SEQUENCE: PlayablePiece[] = [
  { itemId: 'i1', songId: 's1', pieceId: 'a' },
  { itemId: 'i1', songId: 's1', pieceId: 'b' },
  { itemId: 'i2', songId: 's2', pieceId: 'c' },
];
const OPERATOR: CommandOrigin = { kind: 'operator', deviceId: 'B', name: 'Streaming' };

/** A coordinator host over a bare live state, as the simulation uses it. */
function pureHost(initial = createLiveState('rs1', T0)) {
  let state: LiveState = initial;
  const applied: string[] = [];
  return {
    get state() {
      return state;
    },
    applied,
    host: {
      apply(id: string, command: OperatorCommand) {
        if (command.type === 'goLive' || command.type === 'addItem') return 'rejected' as const;
        if (command.type === 'removeItem' || command.type === 'moveItem')
          return 'rejected' as const;
        const outcome = applyCommand(state, { ...command, id } as Command, {
          now: T0,
          sequence: SEQUENCE,
        });
        state = outcome.state;
        if (outcome.result === 'applied') applied.push(id);
        return outcome.result;
      },
      snapshot(): SnapshotBody {
        return {
          coordinatorId: 'A',
          state,
          date: '2026-10-11',
          items: [],
          presented: null,
          devices: [],
        };
      },
    },
  };
}

const command = (id: string, type: 'next' | 'previous' | 'blank'): FollowerToCoordinator => ({
  type: 'command',
  id,
  origin: OPERATOR,
  command: { type },
});

describe('Coordinator', () => {
  it('applies a command once however often it arrives, answering the same each time', async () => {
    const { host, applied } = pureHost();
    const coordinator = new Coordinator(host);
    const first = await coordinator.receive('B', command('c1', 'next'));
    expect(first.outbound[0]).toEqual({
      to: 'B',
      message: { type: 'ack', id: 'c1', applied: true },
    });
    expect(first.outbound[1]?.message).toMatchObject({
      type: 'snapshot',
      snapshot: { revision: 1 },
    });
    const again = await coordinator.receive('B', command('c1', 'next'));
    expect(again.outbound).toEqual([
      { to: 'B', message: { type: 'ack', id: 'c1', applied: true } },
    ]);
    expect(applied).toEqual(['c1']);
  });

  it('orders arrivals from two origins into one sequence with increasing revisions', async () => {
    const { host } = pureHost();
    const coordinator = new Coordinator(host);
    const results = await Promise.all([
      coordinator.receive('B', command('c1', 'next')),
      coordinator.receive('C', command('c2', 'next')),
      coordinator.receive('B', command('c3', 'previous')),
    ]);
    const revisions = results.flatMap((r) =>
      r.outbound
        .filter((o) => o.message.type === 'snapshot')
        .map((o) => (o.message as never as { snapshot: LiveSnapshot }).snapshot.revision),
    );
    expect(revisions).toEqual([1, 2, 3]);
    expect(host.snapshot().state.presented?.pieceId).toBe('a');
  });

  it('answers a resync with the current snapshot without changing the revision', async () => {
    const { host } = pureHost();
    const coordinator = new Coordinator(host);
    await coordinator.receive('B', command('c1', 'next'));
    const { outbound } = await coordinator.receive('C', { type: 'resync', have: 0 });
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({
      to: 'C',
      message: { type: 'snapshot', snapshot: { revision: 1 } },
    });
    expect(coordinator.revision).toBe(1);
  });

  it('takes a handover snapshot newer than its own and continues its numbering', async () => {
    const { host } = pureHost();
    const coordinator = new Coordinator(host, { startRevision: 3 });
    const snapshot: LiveSnapshot = { ...host.snapshot(), revision: 7 };
    const received = await coordinator.receive('A', { type: 'handover', snapshot });
    expect(received.adopt).toBe(snapshot);
    expect(coordinator.revision).toBe(7);
    const published = await coordinator.publish();
    expect(published.message).toMatchObject({ type: 'snapshot', snapshot: { revision: 8 } });
    // An older one is ignored.
    const stale = await coordinator.receive('A', {
      type: 'handover',
      snapshot: { ...snapshot, revision: 2 },
    });
    expect(stale.adopt).toBeUndefined();
  });

  it('keeps the workspace grant list and sends it to every follower', async () => {
    const { host } = pureHost();
    const grants: WorkspaceGrant[] = [];
    const coordinator = new Coordinator({
      ...host,
      grants: {
        register: (grant) => {
          grants.push(grant);
          return grants;
        },
        revoke: (id) => {
          const kept = grants.filter((g) => id !== null && g.id !== id);
          grants.splice(0, grants.length, ...kept);
          return grants;
        },
      },
    });
    const grant = { id: 'g1', secretHash: 'h', name: 'Sam', createdAt: T0 };
    const registered = await coordinator.receive('B', { type: 'grantRegister', grant });
    expect(registered.outbound).toEqual([{ message: { type: 'grantList', grants: [grant] } }]);
    const revoked = await coordinator.receive('C', { type: 'grantRevoke', id: null });
    expect(revoked.outbound).toEqual([{ message: { type: 'grantList', grants: [] } }]);
  });
});

describe('Follower', () => {
  const snapshot = (revision: number, coordinatorId = 'A'): LiveSnapshot => ({
    revision,
    coordinatorId,
    state: createLiveState('rs1', T0),
    date: '2026-10-11',
    items: [],
    presented: null,
    devices: [],
  });

  it('drops a snapshot older than the one it has', () => {
    const follower = new Follower();
    expect(follower.receive({ type: 'snapshot', snapshot: snapshot(3) })).toHaveLength(1);
    expect(follower.receive({ type: 'snapshot', snapshot: snapshot(2) })).toEqual([]);
    expect(follower.receive({ type: 'snapshot', snapshot: snapshot(3) })).toEqual([]);
    expect(follower.revision).toBe(3);
  });

  it('takes a snapshot from a new coordinator whatever its revision', () => {
    const follower = new Follower();
    follower.receive({ type: 'snapshot', snapshot: snapshot(9, 'A') });
    const events = follower.receive({ type: 'snapshot', snapshot: snapshot(1, 'B') });
    expect(events).toMatchObject([
      { kind: 'snapshot', snapshot: { revision: 1, coordinatorId: 'B' } },
    ]);
  });

  it('asks for a resync when a heartbeat shows a snapshot was missed', () => {
    const follower = new Follower();
    follower.receive({ type: 'snapshot', snapshot: snapshot(3) });
    expect(follower.receive({ type: 'alive', revision: 3 })).toEqual([]);
    expect(follower.receive({ type: 'alive', revision: 5 })).toEqual([
      { kind: 'send', message: { type: 'resync', have: 3 } },
    ]);
  });

  it('keeps a pending command until it is acknowledged and resends it on reconnecting', () => {
    const follower = new Follower();
    follower.receive({ type: 'snapshot', snapshot: snapshot(2) });
    const sent = follower.command('c1', OPERATOR, { type: 'next' });
    expect(follower.pendingCommands).toEqual([sent]);
    expect(follower.connect()).toEqual([{ type: 'resync', have: 2 }, sent]);
    expect(follower.receive({ type: 'ack', id: 'c1', applied: true })).toEqual([
      { kind: 'ack', id: 'c1', applied: true },
    ]);
    expect(follower.pendingCommands).toEqual([]);
    expect(follower.connect()).toEqual([{ type: 'resync', have: 2 }]);
  });
});

describe('CoordinatorWatch', () => {
  it('reports the coordinator absent, present, then silent after fifteen seconds', () => {
    const watch = new CoordinatorWatch();
    expect(watch.status(0)).toBe('absent');
    watch.announce('A', 1000);
    expect(watch.status(2000)).toBe('present');
    watch.heard(10_000);
    expect(watch.status(24_000)).toBe('present');
    expect(watch.status(26_000)).toBe('silent');
    watch.heard(30_000);
    expect(watch.status(31_000)).toBe('present');
    watch.announce(null, 32_000);
    expect(watch.status(32_000)).toBe('absent');
  });
});

describe('two coordinators meeting (D14)', () => {
  const at = (startedAt: string, coordinatorId: string) => ({
    coordinatorId,
    state: { ...createLiveState('rs1', startedAt), startedAt },
  });

  it('keeps the live state that started earlier, from either side', () => {
    const early = at('2026-10-11T09:00:00.000Z', 'B');
    const late = at('2026-10-11T09:05:00.000Z', 'A');
    expect(resolveCoordinators(early, late)).toBe('keep');
    expect(resolveCoordinators(late, early)).toBe('yield');
  });

  it('settles an equal start by identifier so both sides agree', () => {
    const a = at(T0, 'A');
    const b = at(T0, 'B');
    expect(resolveCoordinators(a, b)).toBe('keep');
    expect(resolveCoordinators(b, a)).toBe('yield');
  });
});

describe('recovery source (D18)', () => {
  const copy = (updatedAt: string, revision: number): LiveSnapshot => ({
    revision,
    coordinatorId: 'A',
    state: { ...createLiveState('rs1', T0), updatedAt, lastActiveAt: updatedAt },
    date: '2026-10-11',
    items: [],
    presented: null,
    devices: [],
  });
  const now = '2026-10-11T10:00:00.000Z';

  it('prefers the newer copy, from either side', () => {
    const older = copy('2026-10-11T09:30:00.000Z', 5);
    const newer = copy('2026-10-11T09:40:00.000Z', 4);
    expect(chooseRecovery({ local: older, server: newer, now })).toBe('server');
    expect(chooseRecovery({ local: newer, server: older, now })).toBe('local');
  });

  it('ignores an expired copy and gives up when both are', () => {
    const expired = copy('2026-10-11T04:00:00.000Z', 9);
    const fresh = copy('2026-10-11T09:00:00.000Z', 1);
    expect(chooseRecovery({ local: expired, server: fresh, now })).toBe('server');
    expect(chooseRecovery({ local: fresh, server: null, now })).toBe('local');
    expect(chooseRecovery({ local: expired, server: expired, now })).toBeNull();
    expect(chooseRecovery({ local: null, server: null, now })).toBeNull();
  });
});
