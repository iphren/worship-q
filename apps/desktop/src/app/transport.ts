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

type Ready = Extract<RelayToDesktop, { type: 'ready' }>;

/**
 * Chooses between the transports available: the LAN while it is open, else the relay. The
 * relay is kept connected underneath so content changes and phones still arrive through it,
 * but live-state messages travel over one transport only; when the LAN comes up the relay
 * socket for live state is left idle rather than carrying a second copy.
 *
 * Roles are another matter: the church server decides who coordinates (D14), so its word
 * stands whatever carries the live state, and the room a coordinator serves on the LAN is
 * heard only while the server names nobody: it cannot see that coordinator, but this device
 * is following it.
 */
export class TransportSwitch {
  private active: TransportKind | null = null;
  private readonly openKinds = new Set<TransportKind>();
  /**
   * Each open transport's latest word on roles. Becoming active empties the live link's idea
   * of who the coordinator is, and a transport says `ready` only when it connects or roles
   * change; so falling back to the relay after the LAN dropped would otherwise leave the
   * link with no coordinator, and the follower saying it is not responding, indefinitely.
   */
  private readonly lastReady = new Map<TransportKind, Ready>();
  /** The word on roles the link heard last, so one is not repeated. */
  private delivered: Ready | null = null;

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
    this.lastReady.delete(kind);
    this.settle();
    // The relay closing while the LAN carries on leaves the LAN room's word as the only one.
    this.announce();
  }

  /**
   * A message arrived on a transport. Live-state messages count only from the active one.
   * Content changes and phones always come through the relay and are always passed on.
   * Who the coordinator is comes from whichever transport has the authority on roles.
   */
  received(kind: TransportKind, message: RelayToDesktop): void {
    if (message.type === 'ready') {
      this.lastReady.set(kind, message);
      return this.announce();
    }
    const always =
      message.type === 'changed' || message.type === 'message' || message.type === 'left';
    if (kind === this.active || always) this.events.message(kind, message);
  }

  /**
   * Whose word on roles the link hears: the server's while it is connected and names a
   * coordinator (or this device), else the LAN room's while connected to one, else the
   * server's word that there is nobody.
   */
  private authority(): TransportKind | null {
    const relay = this.openKinds.has('relay') ? this.lastReady.get('relay') : undefined;
    if (relay && (relay.coordinator || relay.coordinatorId !== null)) return 'relay';
    if (this.openKinds.has('lan') && this.lastReady.has('lan')) return 'lan';
    return relay ? 'relay' : null;
  }

  /** Passes the authoritative word on roles to the link, unless it heard that one already. */
  private announce(): void {
    const kind = this.authority();
    const ready = kind ? this.lastReady.get(kind) : undefined;
    if (!kind || !ready || ready === this.delivered) return;
    this.delivered = ready;
    this.events.message(kind, ready);
  }

  private settle(): void {
    const next = this.pick();
    if (next === this.active) return;
    const previous = this.active;
    this.active = next;
    if (previous) this.events.close(previous);
    if (!next) return;
    this.events.open(next);
    // Closing emptied the link's idea of who the coordinator is: it is told again, so it
    // asks the coordinator for the snapshot over the transport now active.
    this.delivered = null;
    this.announce();
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
