/**
 * Plan M1.5: one coordinator and several followers over a network that reorders, duplicates,
 * delays and drops messages, and cuts followers off for a while. Every follower must end on
 * the coordinator's state, and no command may apply twice (spec criterion 8).
 *
 * Runs are seeded; a failing seed is printed so it can be replayed with `SIM_SEED`.
 */
import type {
  CommandOrigin,
  CoordinatorToFollower,
  FollowerToCoordinator,
  OperatorCommand,
} from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  Coordinator,
  createLiveState,
  Follower,
  type Command,
  type LiveState,
  type PlayablePiece,
} from './index';

const T0 = '2026-10-11T09:00:00.000Z';
const SEQUENCE: PlayablePiece[] = [
  { itemId: 'i1', songId: 's1', pieceId: 'a' },
  { itemId: 'i1', songId: 's1', pieceId: 'b' },
  { itemId: 'i2', songId: 's2', pieceId: 'c' },
  { itemId: 'i3', songId: 's3', pieceId: 'd' },
];
const COMMANDS: OperatorCommand['type'][] = [
  'next',
  'next',
  'previous',
  'nextItem',
  'previousItem',
  'nextInItem',
  'blank',
  'unblank',
  'clear',
  'playPiece',
];

/** mulberry32: small, fast, and good enough to shuffle messages. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Flight {
  at: number;
  to: string;
  message: FollowerToCoordinator | CoordinatorToFollower;
  from: string;
}

interface Options {
  followers: number;
  steps: number;
  drop: number;
  duplicate: number;
  maxDelay: number;
  cut: number;
}

async function simulate(seed: number, options: Options): Promise<void> {
  const random = rng(seed);
  const chance = (p: number) => random() < p;
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;

  let state: LiveState = createLiveState('rs1', T0);
  const applied: string[] = [];
  const published: number[] = [];
  const coordinator = new Coordinator({
    apply(id, command) {
      if (!COMMANDS.includes(command.type)) return 'rejected';
      const outcome = applyCommand(state, { ...command, id } as Command, {
        now: T0,
        sequence: SEQUENCE,
      });
      state = outcome.state;
      if (outcome.result === 'applied') applied.push(id);
      return outcome.result;
    },
    snapshot: () => ({
      coordinatorId: 'A',
      state,
      date: '2026-10-11',
      items: [],
      presented: null,
      devices: [],
    }),
  });

  const ids = Array.from({ length: options.followers }, (_, i) => `F${i + 1}`);
  const followers = new Map(ids.map((id) => [id, new Follower()]));
  const connected = new Map(ids.map((id) => [id, true]));
  const origin = (id: string): CommandOrigin => ({ kind: 'operator', deviceId: id, name: id });
  let flights: Flight[] = [];
  let tick = 0;
  let sent = 0;
  let reliable = false;

  const post = (from: string, to: string, message: Flight['message']) => {
    if (!reliable) {
      const party = from === 'A' ? to : from;
      if (!connected.get(party)) return;
      if (chance(options.drop)) return;
    }
    const copies = !reliable && chance(options.duplicate) ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      const delay = reliable ? 1 : 1 + Math.floor(random() * options.maxDelay);
      flights.push({ at: tick + delay, to, message, from });
    }
  };
  const broadcast = (message: CoordinatorToFollower, to?: string) => {
    for (const id of to ? [to] : ids) post('A', id, message);
  };

  const deliver = async (flight: Flight) => {
    if (flight.to === 'A') {
      const received = await coordinator.receive(
        flight.from,
        flight.message as FollowerToCoordinator,
      );
      for (const out of received.outbound) {
        // Snapshots to everyone are new ones; a resync answer repeats the current revision.
        if (out.message.type === 'snapshot' && !out.to)
          published.push(out.message.snapshot.revision);
        broadcast(out.message, out.to);
      }
      return;
    }
    const follower = followers.get(flight.to)!;
    for (const event of follower.receive(flight.message as CoordinatorToFollower)) {
      if (event.kind === 'send') post(flight.to, 'A', event.message);
    }
  };

  const advance = async () => {
    tick++;
    const due = flights.filter((f) => f.at <= tick);
    flights = flights.filter((f) => f.at > tick);
    // Messages due together arrive in a random order.
    for (let i = due.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [due[i], due[j]] = [due[j]!, due[i]!];
    }
    for (const flight of due) await deliver(flight);
  };

  for (let step = 0; step < options.steps; step++) {
    const id = pick(ids);
    const follower = followers.get(id)!;
    if (chance(0.6)) {
      const type = pick(COMMANDS);
      const command: OperatorCommand =
        type === 'playPiece'
          ? { type, itemId: pick(SEQUENCE).itemId, pieceId: pick(SEQUENCE).pieceId }
          : ({ type } as OperatorCommand);
      post(id, 'A', follower.command(`${id}-${++sent}`, origin(id), command));
    }
    if (chance(options.cut)) {
      const was = connected.get(id)!;
      connected.set(id, !was);
      if (was === false) for (const message of follower.connect()) post(id, 'A', message);
    }
    // A follower waiting too long sends its unanswered commands again.
    if (chance(0.15) && connected.get(id) && follower.pendingCommands.length > 0) {
      for (const message of follower.connect()) post(id, 'A', message);
    }
    if (chance(0.1)) broadcast(coordinator.alive().message);
    await advance();
  }

  // The network settles: links return, nothing is lost, and everything in flight lands.
  reliable = true;
  for (const id of ids) {
    connected.set(id, true);
    for (const message of followers.get(id)!.connect()) post(id, 'A', message);
  }
  while (flights.length > 0) await advance();
  broadcast(coordinator.alive().message);
  while (flights.length > 0) await advance();

  const label = `seed ${seed}`;
  expect(new Set(applied).size, `${label}: a command applied twice`).toBe(applied.length);
  for (let i = 1; i < published.length; i++) {
    expect(published[i]! > published[i - 1]!, `${label}: revisions not increasing`).toBe(true);
  }
  for (const [id, follower] of followers) {
    expect(follower.snapshot?.state, `${label}: ${id} did not converge`).toEqual(state);
    expect(follower.pendingCommands, `${label}: ${id} still has pending commands`).toEqual([]);
  }
}

describe('shared live state over a lossy network', () => {
  const base = Number(process.env.SIM_SEED ?? 20261011);
  const runs = Number(process.env.SIM_RUNS ?? 1000);

  it(`converges and applies each command once across ${runs} seeded runs`, async () => {
    for (let i = 0; i < runs; i++) {
      await simulate(base + i, {
        followers: 3,
        steps: 60,
        drop: 0.15,
        duplicate: 0.15,
        maxDelay: 4,
        cut: 0.05,
      });
    }
  }, 120_000);

  it('converges with a harsher network', async () => {
    for (let i = 0; i < 50; i++) {
      await simulate(base + 100_000 + i, {
        followers: 5,
        steps: 120,
        drop: 0.4,
        duplicate: 0.3,
        maxDelay: 8,
        cut: 0.1,
      });
    }
  }, 60_000);
});
