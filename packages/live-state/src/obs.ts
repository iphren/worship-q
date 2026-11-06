/**
 * The workspace's OBS state across devices (OBS control plan O5, O8, O9, O11; task breakdown
 * M1.6, M2.3). Pure: no sockets, no clocks, no OBS.
 *
 * The device whose OBS link is active owns the state; the coordinator only forwards: the
 * state to every device that takes OBS messages, commands to the owner, answers back to the
 * device that asked, and live monitor images to the devices showing the monitor. It keeps
 * nothing of its own beyond the last state it forwarded, to give a device that connects.
 */
import {
  OBS_ERRORS,
  type CoordinatorToFollower,
  type FollowerToCoordinator,
  type ObsState,
} from '@worship-q/protocol';

// Shared with the phone page, which uses the protocol package only.
export { liveFavourite, outputElapsed, switchTarget } from '@worship-q/protocol';

/** Whether `incoming` takes the place of `current` (O9). */
export function newerObsState(incoming: ObsState, current: ObsState | null): boolean {
  if (!current) return true;
  if (incoming.ownerId !== current.ownerId) {
    // A link turned off never holds the state against another computer's active one, and
    // an inactive state never takes it from an active one, whatever the clocks say.
    if (incoming.active !== current.active) return incoming.active;
    const a = Date.parse(incoming.activatedAt);
    const b = Date.parse(current.activatedAt);
    if (a !== b && !Number.isNaN(a) && !Number.isNaN(b)) return a > b;
    // The same instant, or a time that does not read: settled the same way everywhere.
    return incoming.ownerId > current.ownerId;
  }
  if (incoming.activatedAt !== current.activatedAt) {
    const a = Date.parse(incoming.activatedAt);
    const b = Date.parse(current.activatedAt);
    return Number.isNaN(b) || a > b;
  }
  return incoming.revision > current.revision;
}

/** OBS messages from a follower to the coordinator. */
export type ObsUp = Extract<
  FollowerToCoordinator,
  { type: 'obsState' | 'obsCommand' | 'obsAck' | 'obsWatch' | 'obsSnapshot' }
>;
/** OBS messages from the coordinator to a follower. */
export type ObsDown = Extract<
  CoordinatorToFollower,
  { type: 'obsState' | 'obsCommand' | 'obsAck' | 'obsWatch' | 'obsSnapshot' }
>;

const OBS_KINDS = new Set(['obsState', 'obsCommand', 'obsAck', 'obsWatch', 'obsSnapshot']);

export function isObsUp(message: FollowerToCoordinator): message is ObsUp {
  return OBS_KINDS.has(message.type);
}

export function isObsDown(message: CoordinatorToFollower): message is ObsDown {
  return OBS_KINDS.has(message.type);
}

/** A message for one device; the coordinator's own id means this device. */
export interface ObsOut {
  to: string;
  message: ObsDown;
}

/** Commands remembered while their answer is awaited, oldest dropped first. */
const ASKS_KEPT = 500;

/**
 * The coordinator's part (M2.3). Every message is addressed: the coordinator sends OBS
 * messages only to devices that take them (the audience), never to everyone, so a version 3
 * desktop is not sent what it cannot read.
 */
export class ObsHub {
  private state_: ObsState | null = null;
  private audience = new Set<string>();
  private readonly watchers = new Set<string>();
  /** What the owner was last told about other devices watching. */
  private ownerWatching = false;
  /** Who asked each forwarded command, by command id. */
  private readonly asks = new Map<string, string>();

  constructor(private readonly selfId: string) {
    this.audience.add(selfId);
  }

  /** The last state forwarded; null when no device has shared one or its owner left. */
  get state(): ObsState | null {
    return this.state_;
  }

  /**
   * The devices that take OBS messages: connected, declaring the `obs` capability, this one
   * included. A device that joined is told the state; one that left stops watching, its
   * questions are forgotten, and if it owned the state, the state goes with it (plan §4).
   */
  setAudience(devices: Iterable<string>): ObsOut[] {
    const next = new Set(devices);
    next.add(this.selfId);
    const added = [...next].filter((id) => !this.audience.has(id));
    const removed = [...this.audience].filter((id) => !next.has(id));
    this.audience = next;
    const out: ObsOut[] = [];
    for (const id of removed) out.push(...this.forget(id));
    for (const id of added) out.push(...this.greet(id));
    return out;
  }

  /**
   * A device (re)connected and said it takes OBS messages: it is told the state, and the
   * owner whether anyone else watches, which it may have lost track of while away.
   */
  greet(deviceId: string): ObsOut[] {
    this.audience.add(deviceId);
    const out: ObsOut[] = [{ to: deviceId, message: { type: 'obsState', state: this.state_ } }];
    if (this.state_?.active && this.state_.ownerId === deviceId) {
      out.push({ to: deviceId, message: { type: 'obsWatch', watching: this.ownerWatching } });
    }
    return out;
  }

  receive(from: string, message: ObsUp): ObsOut[] {
    // It speaks OBS, whatever the last capabilities said.
    this.audience.add(from);
    switch (message.type) {
      case 'obsState':
        return this.takeState(from, message.state);
      case 'obsCommand': {
        const owner = this.state_?.active ? this.state_.ownerId : null;
        if (!owner) {
          return [
            {
              to: from,
              message: { type: 'obsAck', id: message.id, ok: false, error: OBS_ERRORS.noObs },
            },
          ];
        }
        this.asks.delete(message.id);
        this.asks.set(message.id, from);
        if (this.asks.size > ASKS_KEPT) this.asks.delete(this.asks.keys().next().value!);
        return [
          { to: owner, message: { type: 'obsCommand', id: message.id, command: message.command } },
        ];
      }
      case 'obsAck': {
        if (from !== this.state_?.ownerId) return [];
        const asker = this.asks.get(message.id);
        if (asker === undefined) return [];
        this.asks.delete(message.id);
        return [{ to: asker, message }];
      }
      case 'obsWatch':
        if (message.watching) this.watchers.add(from);
        else this.watchers.delete(from);
        return this.tellOwner();
      case 'obsSnapshot': {
        const owner = this.state_;
        if (!owner?.active || from !== owner.ownerId) return [];
        return [...this.watchers]
          .filter((id) => id !== owner.ownerId && this.audience.has(id))
          .map((to) => ({ to, message }));
      }
    }
  }

  private takeState(from: string, incoming: ObsState): ObsOut[] {
    // A device speaks only for its own link.
    if (incoming.ownerId !== from) return [];
    const current = this.state_;
    if (!newerObsState(incoming, current)) {
      // Another device's later activation holds the state: this one is told, and turns its
      // own link off (O9).
      if (current?.active && current.ownerId !== from) {
        return [{ to: from, message: { type: 'obsState', state: current } }];
      }
      return [];
    }
    const out: ObsOut[] = [];
    const ownerChanged = !current || current.ownerId !== incoming.ownerId || !current.active;
    if (current && current.ownerId !== incoming.ownerId) out.push(...this.failAsks());
    this.state_ = incoming;
    for (const to of this.audience) {
      if (to !== from) out.push({ to, message: { type: 'obsState', state: incoming } });
    }
    if (ownerChanged && incoming.active) {
      // A new owner, or one turned on again: it is told where watching stands, whatever it
      // thought before.
      this.ownerWatching = this.watchedBesides(incoming.ownerId);
      out.push({
        to: incoming.ownerId,
        message: { type: 'obsWatch', watching: this.ownerWatching },
      });
    } else {
      out.push(...this.tellOwner());
    }
    return out;
  }

  private watchedBesides(owner: string): boolean {
    return [...this.watchers].some((id) => id !== owner);
  }

  /** Tells the owner whether any other device shows the live monitor, when that changed. */
  private tellOwner(): ObsOut[] {
    const owner = this.state_?.active ? this.state_.ownerId : null;
    if (!owner) {
      this.ownerWatching = false;
      return [];
    }
    const wanted = this.watchedBesides(owner);
    if (wanted === this.ownerWatching) return [];
    this.ownerWatching = wanted;
    return [{ to: owner, message: { type: 'obsWatch', watching: wanted } }];
  }

  /** Answers every command still waiting: its owner is gone. */
  private failAsks(): ObsOut[] {
    const out: ObsOut[] = [];
    for (const [id, asker] of this.asks) {
      if (!this.audience.has(asker)) continue;
      out.push({
        to: asker,
        message: { type: 'obsAck', id, ok: false, error: OBS_ERRORS.ownerLeft },
      });
    }
    this.asks.clear();
    return out;
  }

  private forget(id: string): ObsOut[] {
    this.watchers.delete(id);
    for (const [command, asker] of this.asks) if (asker === id) this.asks.delete(command);
    if (this.state_?.ownerId !== id) return this.tellOwner();
    const out = this.failAsks();
    this.state_ = null;
    this.ownerWatching = false;
    for (const to of this.audience) out.push({ to, message: { type: 'obsState', state: null } });
    return out;
  }
}
