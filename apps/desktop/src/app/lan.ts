/**
 * The venue network (plan M5, M6; decisions D19–D21). The coordinator accepts the
 * workspace's other devices on the LAN and runs the same relay logic as the church server
 * over those connections; a follower looks for the coordinator with mDNS, checks its
 * certificate fingerprint against what the church server or an invitation said, and uses
 * the LAN in preference to the relay. The native core moves bytes and checks credentials;
 * everything else is here.
 */
import type { DesktopToRelay, RelayPeer, RelayToDesktop } from '@worship-q/protocol';
import { Relay, type RelayDirectory, type Socket } from '@worship-q/relay';
import { native, type LanCredential, type LanFound, type LanOpened } from '../platform/native';
import type { Transport, TransportEvents, TransportKind } from './transport';

/** How long a follower looks for the coordinator before deciding it is not there (D14). */
export const BROWSE_SECONDS = 4;
const BROWSE_AGAIN_MS = [5000, 10000, 20000, 30000];

/** Where a device may be reached on the LAN, as the church server or an invitation said. */
export interface KnownPeer {
  deviceId: string;
  name: string;
  fingerprint: string;
  addresses: string[];
  port: number;
}

/**
 * Picks the coordinator among what mDNS found: it must be the device the relay names as
 * coordinator when that is known, and its fingerprint must be one the server or an
 * invitation gave for it, so no other device on the network can pose as the coordinator.
 */
export function chooseCoordinator(
  found: readonly LanFound[],
  known: readonly KnownPeer[],
  coordinatorId: string | null,
): (LanFound & { address: string }) | null {
  for (const candidate of found) {
    if (coordinatorId && candidate.deviceId !== coordinatorId) continue;
    const trusted = known.find(
      (peer) =>
        peer.deviceId === candidate.deviceId &&
        peer.fingerprint.toUpperCase() === candidate.fingerprint.toUpperCase(),
    );
    if (!trusted) continue;
    const address = candidate.addresses[0] ?? trusted.addresses[0];
    if (address) return { ...candidate, address };
  }
  return null;
}

// ── Coordinator side ───────────────────────────────────────────────────────

interface LanIdentity {
  id: string;
  name: string;
}

/** Tells the shared relay who each LAN connection is; the native core already checked. */
class LanDirectory implements RelayDirectory {
  readonly identities = new Map<string, LanIdentity>();

  constructor(private readonly workspaceId: () => string) {}

  authenticate(token: string) {
    const identity = this.identities.get(token);
    return identity ? { ...identity, workspaceId: this.workspaceId() } : null;
  }
  getWorkspace(id: string) {
    return id === this.workspaceId() ? { id } : null;
  }
  isActiveDevice() {
    return true;
  }
  authenticateOutputLink() {
    return null;
  }
  isActiveOutputLink() {
    return false;
  }
  outputLook() {
    return null;
  }
}

export interface LanHostDeps {
  workspaceId: () => string;
  deviceId: () => string;
  deviceName: () => string;
  /** What this device sends over the relay as its hello, used for the local room too. */
  hello: () => Extract<DesktopToRelay, { type: 'hello' }>;
  /** Messages the local room sends to this device: peers' commands, phones, the room's state. */
  onMessage: (message: RelayToDesktop) => void;
}

/**
 * Runs on the coordinator: a relay room over the LAN connections the native core accepts,
 * with this device as the room's coordinator. The church server still decides who is
 * coordinator; this only serves while this device is.
 */
export class LanHost {
  private readonly directory: LanDirectory;
  private relay: Relay | null = null;
  private self: ReturnType<Relay['desktop']> | null = null;
  private readonly connections = new Map<string, ReturnType<Relay['desktop']>>();
  private unlisten: (() => void) | null = null;
  private serving = false;
  private peers_: RelayPeer[] = [];

  constructor(private readonly deps: LanHostDeps) {
    this.directory = new LanDirectory(deps.workspaceId);
  }

  /** The devices connected to this coordinator over the LAN, this device left out. */
  get peers(): RelayPeer[] {
    return this.peers_.filter((peer) => peer.deviceId !== this.deps.deviceId());
  }

  async start(): Promise<void> {
    this.unlisten = await native.onLan({
      open: (event) => this.opened(event),
      message: ({ id, data }) => this.connections.get(id)?.message(data),
      close: ({ id }) => {
        this.connections.get(id)?.close();
        this.connections.delete(id);
      },
    });
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
    void this.setCoordinating(false);
  }

  /** The desktops accepted on the LAN, from the server's device list (plan M5.3). */
  async setCredentials(credentials: LanCredential[]): Promise<void> {
    await native.lanSetCredentials(credentials).catch(() => undefined);
  }

  /** Serves and advertises while this device is coordinator; stops otherwise (D20). */
  async setCoordinating(on: boolean): Promise<void> {
    if (on === this.serving) return;
    this.serving = on;
    const { workspaceId, deviceId, deviceName } = this.deps;
    if (on) {
      this.openRoom();
      await native.lanServe().catch(() => undefined);
      await native
        .lanAdvertise(workspaceId(), deviceId(), deviceName(), true)
        .catch(() => undefined);
    } else {
      await native
        .lanAdvertise(workspaceId(), deviceId(), deviceName(), false)
        .catch(() => undefined);
      await native.lanStopServing().catch(() => undefined);
      this.closeRoom();
    }
  }

  /** Sends to the LAN followers and phones, as the coordinator's messages to the relay. */
  send(message: DesktopToRelay): void {
    this.self?.message(JSON.stringify(message));
  }

  private openRoom(): void {
    const relay = new Relay(this.directory);
    this.relay = relay;
    const me = this.deps.deviceId();
    this.directory.identities.set('lan:self', { id: me, name: this.deps.deviceName() });
    const socket: Socket = {
      send: (data) => {
        const message = JSON.parse(data) as RelayToDesktop;
        if (message.type === 'ready') this.peers_ = message.peers;
        this.deps.onMessage(message);
      },
      close: () => undefined,
    };
    this.self = relay.desktop(socket);
    this.self.message(JSON.stringify({ ...this.deps.hello(), token: 'lan:self', lan: null }));
  }

  private closeRoom(): void {
    for (const [id, handlers] of this.connections) {
      handlers.close();
      void native.lanDrop(id).catch(() => undefined);
    }
    this.connections.clear();
    this.self?.close();
    this.self = null;
    this.relay = null;
    this.peers_ = [];
  }

  private opened(event: LanOpened): void {
    const relay = this.relay;
    if (!relay) return void native.lanDrop(event.id).catch(() => undefined);
    const socket: Socket = {
      send: (data) => void native.lanSend(event.id, data).catch(() => undefined),
      close: () => void native.lanDrop(event.id).catch(() => undefined),
    };
    if (event.kind === 'desktop') {
      const token = `lan:${event.id}`;
      this.directory.identities.set(token, { id: event.deviceId, name: event.name });
      const handlers = relay.desktop(socket);
      this.connections.set(event.id, handlers);
      const hello = (event.hello ?? {}) as Record<string, unknown>;
      handlers.message(JSON.stringify({ ...hello, type: 'hello', token }));
      return;
    }
    const handlers = relay.remote(socket);
    this.connections.set(event.id, handlers);
    const hello = (event.hello ?? {}) as Record<string, unknown>;
    handlers.message(JSON.stringify({ ...hello, workspace: this.deps.workspaceId() }));
  }
}

// ── Follower side ──────────────────────────────────────────────────────────

export interface LanTransportDeps {
  workspaceId: () => string;
  token: () => string;
  hello: () => Extract<DesktopToRelay, { type: 'hello' }>;
  /** Devices whose fingerprints the server or an invitation gave (D19). */
  knownPeers: () => KnownPeer[];
  /** The coordinator the relay names, when known; null accepts any trusted coordinator. */
  coordinatorId: () => string | null;
  /** False while this device is itself the coordinator or has nothing to follow. */
  enabled: () => boolean;
  events: TransportEvents;
}

/** Reaches the coordinator directly on the venue network, found by mDNS (plan M5.5). */
export class LanTransport implements Transport {
  readonly kind: TransportKind = 'lan';
  private connection: string | null = null;
  private open_ = false;
  private stopped = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unlisten: (() => void) | null = null;
  /** What the last browse found, for the interface and for choosing without the server. */
  lastFound: LanFound[] = [];

  constructor(private readonly deps: LanTransportDeps) {}

  get open(): boolean {
    return this.open_;
  }

  start(): void {
    void native
      .onLan({
        open: () => undefined,
        message: ({ id, data }) => {
          if (id !== this.connection) return;
          const message = JSON.parse(data) as RelayToDesktop;
          if (message.type === 'ready' && !this.open_) {
            this.open_ = true;
            this.attempt = 0;
            this.deps.events.open(this.kind);
          }
          this.deps.events.message(this.kind, message);
        },
        close: ({ id }) => {
          if (id === this.connection) this.lost();
        },
      })
      .then((unlisten) => {
        this.unlisten = unlisten;
        void this.look();
      });
  }

  send(message: DesktopToRelay): void {
    if (this.connection)
      void native.lanSend(this.connection, JSON.stringify(message)).catch(() => undefined);
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.unlisten?.();
    if (this.connection) void native.lanDisconnect(this.connection).catch(() => undefined);
    this.lost();
  }

  /** Looks again now, for example when the relay has just named a coordinator. */
  lookNow(): void {
    if (this.connection || this.stopped) return;
    clearTimeout(this.timer);
    void this.look();
  }

  private async look(): Promise<void> {
    if (this.stopped || this.connection) return;
    if (!this.deps.enabled()) return this.later();
    try {
      this.lastFound = await native.lanBrowse(this.deps.workspaceId(), BROWSE_SECONDS);
      const chosen = chooseCoordinator(
        this.lastFound,
        this.deps.knownPeers(),
        this.deps.coordinatorId(),
      );
      if (chosen && this.deps.enabled() && !this.stopped) {
        this.connection = await native.lanConnect(
          chosen.address,
          chosen.port,
          chosen.fingerprint,
          this.deps.token(),
          this.deps.hello(),
        );
        return;
      }
    } catch {
      // Not found or refused: tried again a little later.
    }
    this.later();
  }

  private later(): void {
    if (this.stopped) return;
    const delay = BROWSE_AGAIN_MS[Math.min(this.attempt++, BROWSE_AGAIN_MS.length - 1)]!;
    this.timer = setTimeout(() => void this.look(), delay);
  }

  private lost(): void {
    this.connection = null;
    if (this.open_) {
      this.open_ = false;
      this.deps.events.close(this.kind);
    }
    if (!this.stopped) this.later();
  }
}
