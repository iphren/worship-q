/**
 * One live state across several devices: the coordinator applies commands in order and
 * publishes snapshots; followers send commands and apply snapshots, never editing the live
 * state themselves (plan M1, decisions D14, D18, D21).
 *
 * Both sides are pure: no sockets, no clocks, no database. The host supplies what they
 * need and sends what they return, so the same classes run over the relay, over the LAN,
 * and in the simulation harness.
 */
import type {
  Capabilities,
  CommandOrigin,
  CoordinatorToFollower,
  FollowerToCoordinator,
  LiveSnapshot,
  OperatorCommand,
  WorkspaceGrant,
} from '@worship-q/protocol';
import { COMMAND_MEMORY, DEFAULT_EXPIRY_MS, isExpired } from './index';

export type CommandResult = 'applied' | 'duplicate' | 'rejected';

/** A snapshot as the host builds it; the coordinator adds the revision. */
export type SnapshotBody = Omit<LiveSnapshot, 'revision'>;

/** What the coordinator asks of the device it runs on. */
export interface CoordinatorHost {
  /** Applies a command to the authoritative state. The host also dedupes by identifier. */
  apply(
    id: string,
    command: OperatorCommand,
    origin: CommandOrigin,
  ): CommandResult | Promise<CommandResult>;
  /** The live state as it is now. */
  snapshot(): SnapshotBody | Promise<SnapshotBody>;
  /** The workspace's remote-control grants (D25). Optional for hosts without phones. */
  grants?: {
    register(grant: WorkspaceGrant): WorkspaceGrant[] | Promise<WorkspaceGrant[]>;
    /** `id` null revokes every grant. Returns what is left. */
    revoke(id: string | null): WorkspaceGrant[] | Promise<WorkspaceGrant[]>;
  };
  /** A follower reported the phones connected through it (M8.1). */
  phones?(from: string, phones: { grantId: string; name: string }[]): void;
  /** A follower reported its capabilities (M8.5). */
  capabilities?(from: string, capabilities: Capabilities): void;
}

/** A message for one follower, or for every follower when `to` is omitted. */
export interface Outbound {
  to?: string;
  message: CoordinatorToFollower;
}

export interface Received {
  outbound: Outbound[];
  /**
   * A handover snapshot newer than anything this coordinator published: the host makes it
   * the live state before continuing (M2.3).
   */
  adopt?: LiveSnapshot;
}

export class Coordinator {
  private revision_: number;
  /** Each command's answer, so one sent again after a reconnection is answered the same. */
  private readonly answers = new Map<string, boolean>();
  private readonly answered: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: CoordinatorHost,
    options: {
      /** Where numbering continues from, after a handover or a recovery. */
      startRevision?: number;
      /** Send a snapshot with each applied command, without waiting for the host. */
      publishOnApply?: boolean;
    } = {},
  ) {
    this.revision_ = options.startRevision ?? 0;
    this.publishOnApply = options.publishOnApply ?? true;
  }

  private readonly publishOnApply: boolean;

  /** The last published revision; 0 before the first snapshot. */
  get revision(): number {
    return this.revision_;
  }

  /** Continues numbering from a snapshot taken over from elsewhere. */
  adopt(revision: number): void {
    this.revision_ = Math.max(this.revision_, revision);
  }

  /** Messages are handled one at a time, in the order they arrived. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private remember(id: string, applied: boolean): void {
    if (!this.answers.has(id)) {
      this.answered.push(id);
      if (this.answered.length > COMMAND_MEMORY) this.answers.delete(this.answered.shift()!);
    }
    this.answers.set(id, applied);
  }

  /** A fresh snapshot with the next revision, for every follower. */
  publish(): Promise<Outbound> {
    return this.enqueue(async () => this.nextSnapshot());
  }

  private async nextSnapshot(): Promise<Outbound> {
    const body = await this.host.snapshot();
    this.revision_ += 1;
    return { message: { type: 'snapshot', snapshot: { ...body, revision: this.revision_ } } };
  }

  /** The heartbeat followers use to notice a missed snapshot. */
  alive(): Outbound {
    return { message: { type: 'alive', revision: this.revision_ } };
  }

  receive(from: string, message: FollowerToCoordinator): Promise<Received> {
    return this.enqueue(async () => {
      switch (message.type) {
        case 'command': {
          const known = this.answers.get(message.id);
          if (known !== undefined) {
            return {
              outbound: [{ to: from, message: { type: 'ack', id: message.id, applied: known } }],
            };
          }
          const result = await this.host.apply(message.id, message.command, message.origin);
          const applied = result === 'applied';
          this.remember(message.id, applied);
          const outbound: Outbound[] = [
            { to: from, message: { type: 'ack', id: message.id, applied } },
          ];
          if (applied && this.publishOnApply) outbound.push(await this.nextSnapshot());
          return { outbound };
        }
        case 'resync': {
          const body = await this.host.snapshot();
          // The revision stays; a follower that has it drops the copy, one behind takes it.
          const revision = Math.max(this.revision_, 1);
          this.revision_ = revision;
          return {
            outbound: [
              { to: from, message: { type: 'snapshot', snapshot: { ...body, revision } } },
            ],
          };
        }
        case 'handover': {
          const { snapshot } = message;
          if (snapshot.revision <= this.revision_) return { outbound: [] };
          this.revision_ = snapshot.revision;
          return { outbound: [], adopt: snapshot };
        }
        case 'grantRegister': {
          if (!this.host.grants) return { outbound: [] };
          const grants = await this.host.grants.register(message.grant);
          return { outbound: [{ message: { type: 'grantList', grants } }] };
        }
        case 'grantRevoke': {
          if (!this.host.grants) return { outbound: [] };
          const grants = await this.host.grants.revoke(message.id);
          return { outbound: [{ message: { type: 'grantList', grants } }] };
        }
        case 'phones':
          this.host.phones?.(from, message.phones);
          return { outbound: [] };
        case 'capabilities':
          this.host.capabilities?.(from, message.capabilities);
          return { outbound: [] };
      }
    });
  }
}

export type FollowerEvent =
  /** A newer snapshot: the host makes it the live state. */
  | { kind: 'snapshot'; snapshot: LiveSnapshot }
  | { kind: 'ack'; id: string; applied: boolean }
  /** A snapshot was missed: the host sends this to the coordinator. */
  | { kind: 'send'; message: FollowerToCoordinator }
  | { kind: 'grantList'; grants: WorkspaceGrant[] }
  | {
      kind: 'notice';
      origin: CommandOrigin;
      change: Extract<CoordinatorToFollower, { type: 'notice' }>['change'];
    };

type PendingCommand = Extract<FollowerToCoordinator, { type: 'command' }>;

export class Follower {
  private snapshot_: LiveSnapshot | null = null;
  private readonly pending = new Map<string, PendingCommand>();

  /** The last applied snapshot, kept across reconnections. */
  get snapshot(): LiveSnapshot | null {
    return this.snapshot_;
  }

  /** Revision of the last applied snapshot; 0 before any. */
  get revision(): number {
    return this.snapshot_?.revision ?? 0;
  }

  /** Commands sent and not yet answered, oldest first. */
  get pendingCommands(): readonly PendingCommand[] {
    return [...this.pending.values()];
  }

  /**
   * What to send when a connection to the coordinator is made or made again: a resync, then
   * every unanswered command with its original identifier, so none is lost or applied twice.
   */
  connect(): FollowerToCoordinator[] {
    return [{ type: 'resync', have: this.revision }, ...this.pending.values()];
  }

  /** Wraps a command to send; it is kept until the coordinator answers. */
  command(id: string, origin: CommandOrigin, command: OperatorCommand): FollowerToCoordinator {
    const message: PendingCommand = { type: 'command', id, origin, command };
    this.pending.set(id, message);
    return message;
  }

  /** Forgets everything received; the next connection starts from the coordinator's copy. */
  reset(): void {
    this.snapshot_ = null;
  }

  receive(message: CoordinatorToFollower): FollowerEvent[] {
    switch (message.type) {
      case 'snapshot': {
        const { snapshot } = message;
        const current = this.snapshot_;
        // A snapshot from another coordinator is always taken: after a handover, numbering
        // continues; after a recovery it may start again.
        const newer =
          !current ||
          snapshot.coordinatorId !== current.coordinatorId ||
          snapshot.revision > current.revision;
        if (!newer) return [];
        this.snapshot_ = snapshot;
        return [{ kind: 'snapshot', snapshot }];
      }
      case 'ack':
        this.pending.delete(message.id);
        return [{ kind: 'ack', id: message.id, applied: message.applied }];
      case 'alive':
        if (message.revision > this.revision) {
          return [{ kind: 'send', message: { type: 'resync', have: this.revision } }];
        }
        return [];
      case 'grantList':
        return [{ kind: 'grantList', grants: message.grants }];
      case 'notice':
        return [{ kind: 'notice', origin: message.origin, change: message.change }];
    }
  }
}

// ── Coordinator loss and recovery ──────────────────────────────────────────

/** How long without a word from the coordinator counts as not responding (D18). */
export const COORDINATOR_SILENCE_MS = 15_000;
/** How often the coordinator tells followers it is still there. */
export const ALIVE_EVERY_MS = 5_000;

export type CoordinatorStatus =
  /** The relay names a coordinator and it has been heard from recently. */
  | 'present'
  /** The relay names a coordinator but nothing has come from it for too long. */
  | 'silent'
  /** The relay names no coordinator. */
  | 'absent';

/** Notices a coordinator that went away, from the relay's word and from its own silence. */
export class CoordinatorWatch {
  private coordinatorId: string | null = null;
  private heardAt: number | null = null;

  constructor(private readonly silenceMs = COORDINATOR_SILENCE_MS) {}

  /** The relay said who the coordinator is, or that there is none. */
  announce(coordinatorId: string | null, now: number): void {
    if (coordinatorId !== this.coordinatorId) this.heardAt = coordinatorId ? now : null;
    this.coordinatorId = coordinatorId;
  }

  /** A snapshot or heartbeat arrived from the coordinator. */
  heard(now: number): void {
    if (this.coordinatorId) this.heardAt = now;
  }

  status(now: number): CoordinatorStatus {
    if (!this.coordinatorId) return 'absent';
    if (this.heardAt !== null && now - this.heardAt > this.silenceMs) return 'silent';
    return 'present';
  }
}

/**
 * Decision D14: when two coordinators meet, the one whose live state started earlier keeps
 * it; the other becomes a follower. Equal starts are settled by identifier, so both sides
 * reach the same answer.
 */
export function resolveCoordinators(
  mine: Pick<LiveSnapshot, 'coordinatorId' | 'state'>,
  theirs: Pick<LiveSnapshot, 'coordinatorId' | 'state'>,
): 'keep' | 'yield' {
  const a = Date.parse(mine.state.startedAt);
  const b = Date.parse(theirs.state.startedAt);
  if (a !== b) return a < b ? 'keep' : 'yield';
  return mine.coordinatorId <= theirs.coordinatorId ? 'keep' : 'yield';
}

/**
 * Decision D18 and spec §7 rule 1 across devices: the newer of the synchronized copy and
 * the instance's backup, leaving out any that has expired. Null when neither is usable.
 */
export function chooseRecovery(input: {
  local: LiveSnapshot | null;
  server: LiveSnapshot | null;
  now: string;
  expiryMs?: number;
}): 'local' | 'server' | null {
  const expiry = input.expiryMs ?? DEFAULT_EXPIRY_MS;
  const usable = (snapshot: LiveSnapshot | null) =>
    snapshot && !isExpired(snapshot.state, input.now, expiry) ? snapshot : null;
  const local = usable(input.local);
  const server = usable(input.server);
  if (!local && !server) return null;
  if (!server) return 'local';
  if (!local) return 'server';
  const a = Date.parse(local.state.updatedAt);
  const b = Date.parse(server.state.updatedAt);
  if (a !== b) return a > b ? 'local' : 'server';
  return local.revision >= server.revision ? 'local' : 'server';
}
