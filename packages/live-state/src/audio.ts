/**
 * The workspace's live audio state across devices (live audio plan A3, A9; task breakdown
 * M1.4, M1.5). Pure: no sockets, no clocks, no audio.
 *
 * The broadcasting desktop owns the state; the coordinator only forwards: the state to every
 * device that takes audio messages, and each signal to the one device it is addressed to. It
 * keeps nothing of its own beyond the last state, to give a device that connects, and holds
 * no session: the broadcaster and each listener keep their own.
 */
import {
  AUDIO_CLOSE,
  type AudioListener,
  type AudioPhone,
  type AudioSignal,
  type AudioState,
  type CoordinatorToFollower,
  type FollowerToCoordinator,
} from '@worship-q/protocol';

/** Milliseconds since the epoch, or null when the time does not read. */
function time(iso: string): number | null {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

/**
 * Whether `incoming` takes the place of `current` (A3): the later activation wins, equal
 * times settle on the device id the same way everywhere, and the same owner's next state
 * always replaces its last, also after its app restarted with a newer activation.
 */
export function newerAudioState(incoming: AudioState, current: AudioState | null): boolean {
  if (!current) return true;
  if (incoming.ownerId !== current.ownerId) {
    // A broadcast switched off never holds the state against another computer's active one,
    // and an inactive state never takes it from an active one, whatever the clocks say.
    if (incoming.active !== current.active) return incoming.active;
    const a = time(incoming.activatedAt);
    const b = time(current.activatedAt);
    if (a !== null && b !== null && a !== b) return a > b;
    return incoming.ownerId > current.ownerId;
  }
  if (incoming.activatedAt !== current.activatedAt) {
    const a = time(incoming.activatedAt);
    const b = time(current.activatedAt);
    if (b === null) return true;
    if (a === null) return false;
    return a > b;
  }
  return incoming.revision > current.revision;
}

/**
 * The activation time to stamp when the switch is pressed here (A15, §3.1): this computer's
 * clock, or one millisecond after the newest activation it has seen when its clock is behind
 * that, so a press always wins.
 */
export function stampActivation(now: number, newestSeen: string | null): string {
  const seen = newestSeen ? time(newestSeen) : null;
  return new Date(seen !== null && seen >= now ? seen + 1 : now).toISOString();
}

/** Audio messages from a follower to the coordinator. */
export type AudioUp = Extract<FollowerToCoordinator, { type: 'audioState' | 'audioSignal' }>;
/** Audio messages from the coordinator to a follower. */
export type AudioDown = Extract<CoordinatorToFollower, { type: 'audioState' | 'audioSignal' }>;

const AUDIO_KINDS = new Set(['audioState', 'audioSignal']);

export function isAudioUp(message: FollowerToCoordinator): message is AudioUp {
  return AUDIO_KINDS.has(message.type);
}

export function isAudioDown(message: CoordinatorToFollower): message is AudioDown {
  return AUDIO_KINDS.has(message.type);
}

/** A message for one device; the coordinator's own id means this device. */
export interface AudioOut {
  to: string;
  message: AudioDown;
}

/**
 * The session id a coordinator uses to tell the broadcaster that a device left: every
 * session of that device, and of the phones it carried, is closed (§3.2).
 */
export const EVERY_SESSION = '*';

/**
 * The coordinator's part (M1.5). Every message is addressed: audio messages go only to the
 * devices that take them (the audience), so an older desktop is never sent what it cannot
 * read, and a signal goes to its one addressee.
 */
export class AudioHub {
  private state_: AudioState | null = null;
  private audience = new Set<string>();

  constructor(
    private readonly selfId: string,
    /** A connected device's name, for the listener a signal is about. */
    private readonly nameOf: (deviceId: string) => string = () => '',
  ) {
    this.audience.add(selfId);
  }

  /** The last state forwarded; null when no device broadcasts or its owner left. */
  get state(): AudioState | null {
    return this.state_;
  }

  /**
   * The devices that take audio messages: connected, declaring `audio`, this one included. A
   * device that joined is told the state; when one left, the broadcaster is told to close its
   * sessions, and if it was the broadcaster, the state goes with it.
   */
  setAudience(devices: Iterable<string>): AudioOut[] {
    const next = new Set(devices);
    next.add(this.selfId);
    const added = [...next].filter((id) => !this.audience.has(id));
    const removed = [...this.audience].filter((id) => !next.has(id));
    this.audience = next;
    const out: AudioOut[] = [];
    for (const id of removed) out.push(...this.forget(id));
    for (const id of added) out.push(...this.greet(id));
    return out;
  }

  /** A device (re)connected and said it takes audio messages: it is told the state. */
  greet(deviceId: string): AudioOut[] {
    this.audience.add(deviceId);
    return [{ to: deviceId, message: { type: 'audioState', state: this.state_ } }];
  }

  receive(from: string, message: AudioUp): AudioOut[] {
    // It speaks audio, whatever the last capabilities said.
    this.audience.add(from);
    if (message.type === 'audioState') return this.takeState(from, message.state);
    return this.forward(from, message.to, message.phone, message.signal);
  }

  /**
   * Passes a signal to its addressee, with the listening end of the session as the
   * coordinator sees it: the sender, unless the sender is the broadcaster, in which case the
   * addressee (or its phone). The device ids come from the connections, never from the
   * message's own claim.
   */
  private forward(
    from: string,
    to: string,
    phone: AudioPhone | undefined,
    signal: AudioSignal,
  ): AudioOut[] {
    const fromOwner = this.state_?.ownerId === from;
    const end = fromOwner ? to : from;
    const listener: AudioListener = phone
      ? { kind: 'phone', grantId: phone.grantId, name: phone.name }
      : { kind: 'desktop', deviceId: end, name: this.nameOf(end) };
    if (!this.audience.has(to)) {
      // Never answer a close with a close, or two ends could tell each other forever.
      if (signal.kind === 'close') return [];
      return [
        {
          to: from,
          message: {
            type: 'audioSignal',
            from: to,
            listener,
            signal: { kind: 'close', session: signal.session, reason: AUDIO_CLOSE.gone },
          },
        },
      ];
    }
    return [{ to, message: { type: 'audioSignal', from, listener, signal } }];
  }

  private takeState(from: string, incoming: AudioState): AudioOut[] {
    // A device speaks only for its own broadcast.
    if (incoming.ownerId !== from) return [];
    const current = this.state_;
    if (!newerAudioState(incoming, current)) {
      // Another device's later activation holds the state: this one is told, and switches
      // its own broadcast off (A3).
      if (current?.active && current.ownerId !== from) {
        return [{ to: from, message: { type: 'audioState', state: current } }];
      }
      return [];
    }
    const out: AudioOut[] = [];
    if (incoming.active || current?.ownerId === incoming.ownerId) {
      this.state_ = incoming.active ? incoming : null;
    } else {
      return [];
    }
    for (const to of this.audience) {
      if (to !== from) out.push({ to, message: { type: 'audioState', state: this.state_ } });
    }
    return out;
  }

  private forget(id: string): AudioOut[] {
    const state = this.state_;
    if (!state) return [];
    if (state.ownerId === id) {
      this.state_ = null;
      return [...this.audience].map((to) => ({
        to,
        message: { type: 'audioState' as const, state: null },
      }));
    }
    if (!this.audience.has(state.ownerId)) return [];
    // The broadcaster closes that device's sessions now rather than when ICE times out.
    return [
      {
        to: state.ownerId,
        message: {
          type: 'audioSignal',
          from: id,
          listener: { kind: 'desktop', deviceId: id, name: this.nameOf(id) },
          signal: { kind: 'close', session: EVERY_SESSION, reason: AUDIO_CLOSE.gone },
        },
      },
    ];
  }
}
