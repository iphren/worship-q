/**
 * How this desktop reaches the workspace's other devices: through the church server's relay,
 * or directly on the venue network (plan M5, M6; decision D21). Exactly one transport is
 * active at a time, the LAN preferred, and switching between them loses no command: the
 * live link keeps what was not answered and sends it again on the next connection.
 */
import type { DesktopToRelay, RelayToDesktop } from '@worship-q/protocol';

export type TransportKind = 'relay' | 'lan';

export interface TransportEvents {
  open(kind: TransportKind): void;
  message(kind: TransportKind, message: RelayToDesktop): void;
  close(kind: TransportKind): void;
}

/** One way of reaching the other devices. */
export interface Transport {
  readonly kind: TransportKind;
  /** Starts connecting, and keeps reconnecting until closed. */
  start(): void;
  send(message: DesktopToRelay): void;
  /** Stops for good; no more events. */
  close(): void;
  /** True while a connection is open. */
  readonly open: boolean;
}

/**
 * Chooses between the transports available: the LAN while it is open, else the relay. The
 * relay is kept connected underneath so content changes and phones still arrive through it,
 * but live-state messages travel over one transport only; when the LAN comes up the relay
 * socket for live state is left idle rather than carrying a second copy.
 */
export class TransportSwitch {
  private active: TransportKind | null = null;
  private readonly openKinds = new Set<TransportKind>();

  constructor(
    private readonly transports: Transport[],
    private readonly events: TransportEvents,
  ) {}

  get activeKind(): TransportKind | null {
    return this.active;
  }

  /** Which transports are open right now. */
  get available(): TransportKind[] {
    return [...this.openKinds];
  }

  private pick(): TransportKind | null {
    if (this.openKinds.has('lan')) return 'lan';
    if (this.openKinds.has('relay')) return 'relay';
    return null;
  }

  /** A transport opened. */
  opened(kind: TransportKind): void {
    this.openKinds.add(kind);
    this.settle();
  }

  /** A transport closed. */
  closed(kind: TransportKind): void {
    this.openKinds.delete(kind);
    this.settle();
  }

  /**
   * A message arrived on a transport. Live-state messages count only from the active one.
   * Content changes and phones always come through the relay and are always passed on, as
   * is who the coordinator is: the church server's word on roles stands whatever carries
   * the live state.
   */
  received(kind: TransportKind, message: RelayToDesktop): void {
    const always =
      message.type === 'changed' ||
      message.type === 'message' ||
      message.type === 'left' ||
      message.type === 'ready';
    if (kind === this.active || always) this.events.message(kind, message);
  }

  private settle(): void {
    const next = this.pick();
    if (next === this.active) return;
    const previous = this.active;
    this.active = next;
    if (previous) this.events.close(previous);
    if (next) this.events.open(next);
  }

  send(message: DesktopToRelay): void {
    const transport = this.transports.find((t) => t.kind === this.active);
    transport?.send(message);
  }

  /** Sends on one transport whatever is active, for messages that belong to that connection. */
  sendOn(kind: TransportKind, message: DesktopToRelay): void {
    this.transports.find((t) => t.kind === kind)?.send(message);
  }
}
