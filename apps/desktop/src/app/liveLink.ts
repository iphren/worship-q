/**
 * This desktop's part in the workspace's one live state (plan M1–M4, M8): as coordinator it
 * applies everyone's commands and publishes snapshots; as follower it sends commands and
 * shows snapshots; as viewer it only shows them. It also hands over, carries on after the
 * coordinator is lost, mirrors the live state to the church server, and keeps the
 * connected-devices list.
 *
 * Nothing here touches sockets or Tauri: the connection to the relay or the LAN is a
 * transport the caller supplies, so two of these can be tested through the real relay.
 */
import {
  ALIVE_EVERY_MS,
  chooseRecovery,
  Coordinator,
  CoordinatorWatch,
  Follower,
  resolveCoordinators,
  type SnapshotBody,
} from '@worship-q/live-state';
import {
  CoordinatorToFollowerSchema,
  FollowerToCoordinatorSchema,
  type Capabilities,
  type CommandOrigin,
  type ConnectedDevice,
  type DesktopToRelay,
  type LiveSnapshot,
  type OperatorCommand,
  type RelayPeer,
  type RelayToDesktop,
  type RemoteCommand,
  type WorkspaceGrant,
} from '@worship-q/protocol';
import type { RemoteHost } from '@worship-q/remote';
import type { RunSheetChange, Session } from '@worship-q/session';

/** Snapshots are sent at most this often; a burst of changes is sent together. */
const PUBLISH_DELAY_MS = 100;
/** The server copy is refreshed at most this often (decision D17). */
const BACKUP_DELAY_MS = 1000;
/** A forwarded phone command is given up on after this long without an answer. */
const FORWARD_TIMEOUT_MS = 10_000;
/** How often the coordinator is checked for silence. */
const WATCH_EVERY_MS = 1000;

export type LiveRole = 'coordinator' | 'follower' | 'viewer';
export type ConnectionKind = ConnectedDevice['connection'];

export interface LiveStatus {
  role: LiveRole;
  coordinatorId: string | null;
  coordinatorName: string | null;
  /** The relay names no coordinator, or the coordinator has fallen silent (D18). */
  coordinatorLost: boolean;
  /** This computer was coordinator and another took over (plan M4.5); dismissible. */
  demoted: boolean;
  /** How this device reaches the coordinator; null while disconnected. */
  transport: ConnectionKind | null;
  peers: RelayPeer[];
  /** Everyone following the presentation, as the coordinator's snapshot lists them (M8.1). */
  devices: ConnectedDevice[];
  /** Devices lacking a font the workspace asks for (M8.5). */
  fontWarnings: { name: string; fonts: string[] }[];
}

/** The server's copy of the live state (plan M4.1). */
export interface LiveBackupApi {
  put(snapshot: LiveSnapshot, grants: WorkspaceGrant[]): Promise<void>;
  get(): Promise<{ snapshot: LiveSnapshot | null; grants: WorkspaceGrant[] }>;
}

export interface LiveLinkDeps {
  session: Session;
  host: RemoteHost;
  deviceId: () => string;
  deviceName: () => string;
  /** This device's capabilities, re-sent to the coordinator when they change. */
  capabilities: () => Capabilities;
  /** Sends to the active transport; dropped when there is none. */
  send: (message: DesktopToRelay) => void;
  backup: LiveBackupApi | null;
  /** Remembers that earlier phone approvals were registered (plan M2.9). */
  grantsRegistered: { get(): Promise<boolean>; set(): Promise<void> } | null;
  newId?: () => string;
  now?: () => number;
}

export class LiveLink {
  private status_: LiveStatus = {
    role: 'follower',
    coordinatorId: null,
    coordinatorName: null,
    coordinatorLost: false,
    demoted: false,
    transport: null,
    peers: [],
    devices: [],
    fontWarnings: [],
  };
  private readonly listeners = new Set<() => void>();
  private coordinator: Coordinator | null = null;
  private readonly follower = new Follower();
  private readonly watch = new CoordinatorWatch();
  private lastPublished: LiveSnapshot | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private backupDue: LiveSnapshot | null = null;
  private aliveTimer: ReturnType<typeof setInterval> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly forwards = new Map<
    string,
    { resolve: (applied: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  /** Phones connected through each follower, by device id (M8.1). */
  private readonly followerPhones = new Map<string, { grantId: string; name: string }[]>();
  private readonly followerCapabilities = new Map<string, Capabilities>();
  private grants: WorkspaceGrant[] = [];
  /** The coordinator this device last connected to as a follower. */
  private followingId: string | null = null;
  /** Devices connected to this coordinator over the venue network (plan M6.3). */
  private lanPeers: RelayPeer[] = [];
  private stopped = false;
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(private readonly deps: LiveLinkDeps) {
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.now = deps.now ?? (() => Date.now());
    this.status_.role = deps.session.isViewer ? 'viewer' : 'follower';
    this.deps.host.setCoordination({
      coordinating: false,
      forward: (id, origin, command) => this.forward(id, origin, command),
      registerGrant: (grant) => this.toCoordinator({ type: 'grantRegister', grant }),
      revokeGrant: (id) => this.toCoordinator({ type: 'grantRevoke', id }),
      phones: (phones) => {
        if (this.coordinator) this.refreshDevices();
        else this.toCoordinator({ type: 'phones', phones });
      },
    });
    this.watchTimer = setInterval(() => this.checkCoordinator(), WATCH_EVERY_MS);
  }

  get status(): LiveStatus {
    return this.status_;
  }

  /** The snapshot this device last published or applied, for handover and recovery. */
  get snapshot(): LiveSnapshot | null {
    return this.coordinator ? this.lastPublished : this.follower.snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<LiveStatus>): void {
    this.status_ = { ...this.status_, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  dismissDemoted(): void {
    this.update({ demoted: false });
  }

  /** The devices reaching this coordinator over the LAN changed (plan M6.3). */
  setLanPeers(peers: RelayPeer[]): void {
    this.lanPeers = peers;
    if (this.coordinator) this.refreshDevices();
  }

  /** This device's capabilities changed, such as a workspace font going missing (M8.5). */
  capabilitiesChanged(): void {
    if (this.coordinator) this.refreshDevices();
    else if (this.followingId) {
      this.toCoordinator({ type: 'capabilities', capabilities: this.deps.capabilities() });
    }
  }

  stop(): void {
    this.stopped = true;
    this.stopCoordinating();
    if (this.watchTimer) clearInterval(this.watchTimer);
    for (const pending of this.forwards.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.forwards.clear();
    this.deps.session.follow(null);
    this.deps.host.setCoordination(null);
  }

  // ── The transport ────────────────────────────────────────────────────────

  /** A connection to the relay or the LAN opened; roles are settled by `ready`. */
  connected(transport: ConnectionKind): void {
    this.update({ transport });
  }

  /** The connection went away. Pending commands are kept and sent again on the next one. */
  disconnected(): void {
    this.update({ transport: null, peers: [] });
    this.watch.announce(null, this.now());
    this.followingId = null;
  }

  /** A message from the relay about roles, or from another desktop. */
  receive(message: RelayToDesktop): void {
    if (message.type === 'ready') void this.ready(message);
    else if (message.type === 'peer') void this.peer(message.from, message.data);
  }

  /** Asks to become coordinator: Use this computer, or Carry on here (D18). */
  claim(): void {
    if (this.deps.session.isViewer) return;
    this.deps.send({ type: 'claim' });
  }

  private toCoordinator(data: Parameters<typeof FollowerToCoordinatorSchema.parse>[0]): void {
    if (this.coordinator) return;
    const parsed = FollowerToCoordinatorSchema.safeParse(data);
    if (parsed.success) this.deps.send({ type: 'toCoordinator', data: parsed.data });
  }

  // ── Roles ────────────────────────────────────────────────────────────────

  private async ready(message: Extract<RelayToDesktop, { type: 'ready' }>): Promise<void> {
    if (this.stopped) return;
    this.watch.announce(message.coordinatorId, this.now());
    const wasCoordinator = this.coordinator !== null;
    const lost = this.status_.coordinatorLost;
    this.update({
      coordinatorId: message.coordinatorId,
      coordinatorName: message.coordinatorName,
      peers: message.peers,
      coordinatorLost: message.coordinatorId === null && !message.coordinator,
    });
    if (message.coordinator) {
      if (!wasCoordinator) await this.becomeCoordinator(lost);
      else this.refreshDevices();
      return;
    }
    if (wasCoordinator) {
      // Another computer took over (M2.3 handover, or M4.5 after being cut off).
      const final = this.lastPublished;
      this.stopCoordinating();
      if (final && message.coordinatorId) {
        this.deps.send({ type: 'toCoordinator', data: { type: 'handover', snapshot: final } });
      }
      this.update({ demoted: true });
    }
    this.becomeFollower(message.coordinatorId);
  }

  private becomeFollower(coordinatorId: string | null): void {
    const { session, host } = this.deps;
    this.update({ role: session.isViewer ? 'viewer' : 'follower', devices: [], fontWarnings: [] });
    host.setCoordination({
      coordinating: false,
      forward: (id, origin, command) => this.forward(id, origin, command),
      registerGrant: (grant) => this.toCoordinator({ type: 'grantRegister', grant }),
      revokeGrant: (id) => this.toCoordinator({ type: 'grantRevoke', id }),
      phones: (phones) => this.toCoordinator({ type: 'phones', phones }),
    });
    if (!session.isViewer) {
      session.follow({ send: (command) => this.sendCommand(command) });
    }
    if (coordinatorId && coordinatorId !== this.followingId) {
      // A new coordinator, or the first one since connecting: ask for the full snapshot and
      // send again whatever was not answered (M1.10).
      this.followingId = coordinatorId;
      for (const message of this.follower.connect()) this.toCoordinator(message);
      this.toCoordinator({ type: 'capabilities', capabilities: this.deps.capabilities() });
      this.toCoordinator({
        type: 'phones',
        phones: host.connected.map(({ grantId, name }) => ({ grantId, name })),
      });
      void this.registerEarlierGrants();
    }
    if (!coordinatorId) this.followingId = null;
  }

  private sendCommand(command: OperatorCommand): void {
    const origin: CommandOrigin = {
      kind: 'operator',
      deviceId: this.deps.deviceId(),
      name: this.deps.deviceName(),
    };
    this.toCoordinator(this.follower.command(this.newId(), origin, command));
  }

  /** A phone's command, in the phone's name (D25); resolves with the coordinator's answer. */
  private forward(id: string, origin: CommandOrigin, command: RemoteCommand): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.forwards.delete(id);
        resolve(false);
      }, FORWARD_TIMEOUT_MS);
      this.forwards.set(id, { resolve, timer });
      this.toCoordinator(this.follower.command(id, origin, command));
    });
  }

  /** Plan M2.9: phones approved before phase 2 keep working without a new scan. */
  private async registerEarlierGrants(): Promise<void> {
    const { grantsRegistered, host } = this.deps;
    if (!grantsRegistered || (await grantsRegistered.get())) return;
    for (const grant of await host.localGrants())
      this.toCoordinator({ type: 'grantRegister', grant });
    await grantsRegistered.set();
  }

  private async becomeCoordinator(afterLoss: boolean): Promise<void> {
    const { session, host, backup } = this.deps;
    session.follow(null);
    this.followingId = null;
    const deviceId = this.deps.deviceId();
    // Start from the newest copy (D18, spec §7 rule 1 across devices): what this device
    // followed, else what it resumed from its own database, against the server's. A live
    // state only just started here gives way to the workspace's unexpired one.
    let local = this.follower.snapshot;
    if (!local && session.startKind === 'resumed' && session.live) {
      const body = await session.buildSnapshot(deviceId);
      if (body) local = { ...body, revision: 0 };
    }
    let server: { snapshot: LiveSnapshot | null; grants: WorkspaceGrant[] } | null = null;
    if (backup && (afterLoss || !this.follower.snapshot)) {
      server = await backup.get().catch(() => null);
    }
    const choice = chooseRecovery({
      local,
      server: server?.snapshot ?? null,
      now: new Date(this.now()).toISOString(),
    });
    let startRevision = 0;
    if (choice === 'server' && server?.snapshot) {
      await session.adoptSnapshot(server.snapshot);
      startRevision = server.snapshot.revision;
      if (server.grants.length > 0) await host.applyGrantList(server.grants);
    } else if (choice === 'local' && local && local.revision > 0) {
      await session.adoptSnapshot(local);
      startRevision = local.revision;
    }
    this.grants = await host.localGrants();
    if (this.deps.grantsRegistered) await this.deps.grantsRegistered.set();

    this.coordinator = new Coordinator(
      {
        apply: async (id, command, origin) => {
          const outcome = await session.applyOperatorCommand(id, command, origin);
          if (outcome.change) this.announceEdit(origin, outcome.change);
          return outcome.result;
        },
        snapshot: () => this.snapshotBody(),
        grants: {
          register: async (grant) => {
            await host.acceptGrant(grant);
            return this.reloadGrants();
          },
          revoke: async (id) => {
            if (id === null) await host.disconnectAll();
            else await host.revokeGrant(id);
            return this.reloadGrants();
          },
        },
        phones: (from, phones) => {
          this.followerPhones.set(from, phones);
          this.refreshDevices();
        },
        capabilities: (from, capabilities) => {
          this.followerCapabilities.set(from, capabilities);
          this.refreshDevices();
        },
      },
      { startRevision, publishOnApply: false },
    );
    host.setCoordination({
      coordinating: true,
      forward: async () => false,
      registerGrant: () => void this.reloadGrants().then((grants) => this.broadcastGrants(grants)),
      revokeGrant: () => void this.reloadGrants().then((grants) => this.broadcastGrants(grants)),
      phones: () => this.refreshDevices(),
    });
    this.update({ role: 'coordinator', coordinatorId: deviceId, coordinatorLost: false });
    this.unsubscribe = session.subscribe(() => this.schedulePublish());
    this.aliveTimer = setInterval(() => {
      if (this.coordinator)
        this.deps.send({ type: 'toFollower', data: this.coordinator.alive().message });
    }, ALIVE_EVERY_MS);
    this.refreshDevices();
    await this.publishNow();
    this.broadcastGrants(this.grants);
  }

  private stopCoordinating(): void {
    this.coordinator = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    if (this.aliveTimer) clearInterval(this.aliveTimer);
    this.aliveTimer = null;
    this.followerPhones.clear();
    this.followerCapabilities.clear();
  }

  private async reloadGrants(): Promise<WorkspaceGrant[]> {
    this.grants = await this.deps.host.localGrants();
    this.scheduleBackup();
    return this.grants;
  }

  private broadcastGrants(grants: WorkspaceGrant[]): void {
    if (this.coordinator)
      this.deps.send({ type: 'toFollower', data: { type: 'grantList', grants } });
  }

  /** A run-sheet edit applied here for a phone or another operator: everyone is told (D24). */
  private announceEdit(origin: CommandOrigin, change: RunSheetChange): void {
    const { host } = this.deps;
    // A phone connected to this computer was already shown by the host itself.
    const ownPhone =
      origin.kind === 'phone' && host.connected.some((c) => c.grantId === origin.grantId);
    if (!ownPhone) host.notify(origin.name, change, true);
    this.deps.send({
      type: 'toFollower',
      data: {
        type: 'notice',
        origin,
        change: {
          kind: change.kind,
          title: change.title,
          ...(change.kind === 'moved' ? { toIndex: change.toIndex } : {}),
        },
      },
    });
  }

  // ── Snapshots ────────────────────────────────────────────────────────────

  private async snapshotBody(): Promise<SnapshotBody> {
    const body = await this.deps.session.buildSnapshot(this.deps.deviceId(), this.status_.devices);
    if (body) return body;
    // Nothing live here, which a coordinator should never have; followers see it as ended.
    const now = new Date(this.now()).toISOString();
    return {
      coordinatorId: this.deps.deviceId(),
      state: {
        status: 'ended',
        runSheetId: 'none',
        presented: null,
        blank: false,
        revision: 0,
        appliedCommandIds: [],
        startedAt: now,
        updatedAt: now,
        lastActiveAt: now,
      },
      date: new Date(this.now()).toISOString().slice(0, 10),
      items: [],
      presented: null,
      devices: this.status_.devices,
    };
  }

  private schedulePublish(): void {
    if (!this.coordinator || this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      void this.publishNow();
    }, PUBLISH_DELAY_MS);
  }

  private async publishNow(): Promise<void> {
    const coordinator = this.coordinator;
    if (!coordinator) return;
    const outbound = await coordinator.publish();
    if (this.coordinator !== coordinator || outbound.message.type !== 'snapshot') return;
    this.lastPublished = outbound.message.snapshot;
    this.deps.send({ type: 'toFollower', data: outbound.message });
    this.scheduleBackup();
  }

  private scheduleBackup(): void {
    if (!this.deps.backup || !this.coordinator) return;
    this.backupDue = this.lastPublished;
    if (this.backupTimer) return;
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      const due = this.backupDue;
      this.backupDue = null;
      if (due && this.coordinator) {
        void this.deps.backup?.put(due, this.grants).catch(() => undefined);
      }
    }, BACKUP_DELAY_MS);
  }

  /** Rebuilds the connected-devices list and publishes it (M8.1, M8.5). */
  private refreshDevices(): void {
    if (!this.coordinator) return;
    const now = new Date(this.now()).toISOString();
    const me = this.deps.deviceId();
    const devices: ConnectedDevice[] = [];
    const warnings: LiveStatus['fontWarnings'] = [];
    // A device reaching this coordinator both ways is one device, on the network (D21).
    const onLan = new Set(this.lanPeers.map((peer) => peer.deviceId));
    const seen = new Set<string>();
    for (const peer of [...this.status_.peers, ...this.lanPeers]) {
      if (seen.has(peer.deviceId)) continue;
      seen.add(peer.deviceId);
      const capabilities =
        peer.deviceId === me
          ? this.deps.capabilities()
          : (this.followerCapabilities.get(peer.deviceId) ?? peer.capabilities);
      const missing = capabilities?.missingFonts ?? [];
      devices.push({
        id: peer.deviceId,
        name: peer.name,
        role: peer.role === 'output' ? 'output' : peer.deviceId === me ? 'coordinator' : peer.role,
        connection:
          peer.deviceId === me
            ? (this.status_.transport ?? 'relay')
            : onLan.has(peer.deviceId)
              ? 'lan'
              : 'relay',
        lastSeenAt: now,
        ...(missing.length > 0 ? { missingFonts: missing } : {}),
      });
      if (missing.length > 0) warnings.push({ name: peer.name, fonts: missing });
    }
    const phones = [
      ...this.deps.host.connected.map((c) => ({ grantId: c.grantId, name: c.name, via: me })),
      ...[...this.followerPhones].flatMap(([via, list]) => list.map((p) => ({ ...p, via }))),
    ];
    for (const phone of phones) {
      devices.push({
        id: phone.grantId,
        name: phone.name,
        role: 'phone',
        connection: 'relay',
        lastSeenAt: now,
        via: phone.via,
      });
    }
    this.update({ devices, fontWarnings: warnings });
    this.schedulePublish();
  }

  // ── Messages from other desktops ─────────────────────────────────────────

  private async peer(from: string, data: unknown): Promise<void> {
    if (this.stopped) return;
    if (this.coordinator) {
      const message = FollowerToCoordinatorSchema.safeParse(data);
      if (!message.success) return this.anotherCoordinator(data);
      const received = await this.coordinator.receive(from, message.data);
      if (received.adopt) {
        await this.deps.session.adoptSnapshot(received.adopt);
        await this.publishNow();
      }
      for (const out of received.outbound) {
        this.deps.send({ type: 'toFollower', to: out.to, data: out.message });
      }
      return;
    }
    const message = CoordinatorToFollowerSchema.safeParse(data);
    if (!message.success) return;
    if (message.data.type === 'snapshot' || message.data.type === 'alive')
      this.watch.heard(this.now());
    for (const event of this.follower.receive(message.data)) {
      switch (event.kind) {
        case 'snapshot':
          await this.deps.session.applySnapshot(event.snapshot);
          this.update({ devices: event.snapshot.devices, coordinatorLost: false });
          break;
        case 'ack': {
          const pending = this.forwards.get(event.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.forwards.delete(event.id);
            pending.resolve(event.applied);
          }
          break;
        }
        case 'send':
          this.toCoordinator(event.message);
          break;
        case 'grantList':
          await this.deps.host.applyGrantList(event.grants);
          break;
        case 'notice':
          this.deps.host.notify(
            event.origin.name,
            {
              kind: event.change.kind,
              title: event.change.title,
              toIndex: event.change.toIndex ?? 0,
              fromIndex: 0,
              item: {
                id: '',
                runSheetId: '',
                songId: '',
                position: 0,
                revision: 1,
                createdAt: '',
                updatedAt: '',
              },
            } as RunSheetChange,
            false,
          );
          break;
      }
    }
  }

  /**
   * Decision D14: a snapshot from another coordinator reached this one, which can happen on
   * the LAN. The live state that started earlier is kept; this device yields if its own
   * started later, and the relay or LAN then settles the roles.
   */
  private anotherCoordinator(data: unknown): void {
    const message = CoordinatorToFollowerSchema.safeParse(data);
    if (!message.success || message.data.type !== 'snapshot' || !this.lastPublished) return;
    const theirs = message.data.snapshot;
    if (theirs.coordinatorId === this.deps.deviceId()) return;
    if (resolveCoordinators(this.lastPublished, theirs) === 'yield') {
      this.stopCoordinating();
      this.update({ demoted: true, coordinatorId: theirs.coordinatorId });
      this.becomeFollower(theirs.coordinatorId);
      void this.peer(theirs.coordinatorId, data);
    }
  }

  private checkCoordinator(): void {
    if (this.coordinator || this.stopped || !this.status_.transport) return;
    const status = this.watch.status(this.now());
    const lost = status !== 'present';
    if (lost !== this.status_.coordinatorLost) this.update({ coordinatorLost: lost });
  }
}
