/**
 * Relays live traffic between the devices of a workspace: its desktops, the phones that
 * control it, and browser output pages.
 *
 * The relay holds no presentation state and makes no approval decisions. One desktop per
 * workspace is the coordinator and holds the live state (plan M1, decision D14); the relay
 * carries the other desktops' commands to it and its snapshots back, keeps the role with
 * the first operator device until another claims it, and tells everyone who has it. Desktops
 * say, as they connect and as it changes, whether they are presenting or following someone
 * on the LAN; so when the coordinator drops from the server, or after an outage, the role
 * stays with or goes back to who is presenting rather than to whoever connected first, and
 * two that presented apart are settled by D14. Each
 * phone reaches the desktop whose invitation it scanned, or the coordinator when it comes
 * back with a grant (decision D25). Output pages receive snapshots and may send nothing.
 */
import {
  AudioSignalSchema,
  CoordinatorToFollowerSchema,
  FollowerToCoordinatorSchema,
  isCompatibleProtocol,
  OutputToRelaySchema,
  RemoteToHostSchema,
  isBibleMessage,
  type HostToRemote,
  type RemoteToHost,
  snapshotFor,
  type Capabilities,
  type DesktopToRelay,
  type DeviceRole,
  type LivePresence,
  type LiveStanding,
  type OutputKind,
  type RelayPeer,
  type RelayToDesktop,
  type OutputView,
  type RelayToOutput,
  type RelayToRemote,
  type AudioSignal,
} from '@worship-q/protocol';

/**
 * What the relay asks of whoever runs it: the church instance on the server, or the
 * coordinator desktop's cached directory on the LAN (plan M5.3).
 */
export interface RelayDirectory {
  /** The device a token belongs to, unless revoked. */
  authenticate(token: string): { id: string; workspaceId: string; name: string } | null;
  getWorkspace(id: string): { id: string } | null;
  isActiveDevice(deviceId: string): boolean;
  authenticateOutputLink(
    token: string,
  ): { id: string; workspaceId: string; kind: OutputKind; name: string } | null;
  isActiveOutputLink(id: string): boolean;
  outputLook(workspaceId: string, kind: OutputKind): OutputView['look'];
}

export interface RelayOptions {
  /**
   * Whether the coordinator role may move: by a claim, or to a desktop returning with an
   * older live state (D14). The church server's relay allows it; the room a coordinator
   * serves on the LAN does not, since the server decides who coordinates and the room only
   * serves while its own device does (D14, D20). A move made there would leave two desktops
   * presenting, each unaware of the other.
   */
  claims?: boolean;
  /** Where desktops arriving and leaving are noted, to trace dropped connections. */
  note?: (message: string, detail: Record<string, unknown>) => void;
  /**
   * A broadcaster's signal for an administrator listening in the admin app (live audio
   * A22): the server queues it for the administrator's next poll.
   */
  adminAudio?: (workspaceId: string, deviceId: string, signal: AudioSignal) => void;
}

/**
 * Whether a returning live state takes the role from the one standing (D14): the older live
 * state is kept, and between copies of one live state the more recently changed. A tie
 * leaves the role where it is.
 */
export function outranks(returning: LiveStanding, standing: LiveStanding): boolean {
  const a = Date.parse(returning.startedAt);
  const b = Date.parse(standing.startedAt);
  if (a !== b) return a < b;
  return Date.parse(returning.updatedAt) > Date.parse(standing.updatedAt);
}

/** Reads a desktop's presence from its hello, which arrives unchecked. */
function readPresence(value: unknown): LivePresence | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const dated = (key: string) => typeof p[key] === 'string' && !Number.isNaN(Date.parse(p[key]));
  if (!dated('startedAt') || !dated('updatedAt')) return null;
  const standing = { startedAt: p.startedAt as string, updatedAt: p.updatedAt as string };
  if (p.kind === 'coordinating') return { kind: 'coordinating', ...standing };
  if (p.kind === 'following' && typeof p.deviceId === 'string' && p.deviceId) {
    const name = typeof p.name === 'string' ? p.name : '';
    return { kind: 'following', deviceId: p.deviceId, name, ...standing };
  }
  return null;
}

/** A random connection identifier; works in Node and in browsers. */
function connectionId(): string {
  return globalThis.crypto.randomUUID();
}

/** The part of a WebSocket the relay uses, so tests can supply their own. */
export interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Desktop {
  socket: Socket;
  deviceId: string;
  name: string;
  role: DeviceRole;
  capabilities: Capabilities | undefined;
  lan: RelayPeer['lan'];
  /** What it last said it was doing with the live state: in its hello, then as it changed. */
  live: LivePresence | null;
  connectedAt: number;
  lastSeenAt: number;
}

interface Remote {
  id: string;
  socket: Socket;
  workspaceId: string;
  /** The hello, given again to a desktop that connects later. */
  hello: unknown;
  /** The desktop this phone talks to; null while none is there. */
  desktop: Desktop | null;
}

interface Output {
  /** The output link's identifier; `output:<id>` names it among the peers. */
  id: string;
  socket: Socket;
  workspaceId: string;
  kind: OutputKind;
  name: string;
  connectedAt: number;
  capabilities: Partial<Capabilities> | undefined;
}

interface WorkspaceRoom {
  desktops: Set<Desktop>;
  coordinator: Desktop | null;
  /** The coordinator's live state, from its hello and then its snapshots; null until known. */
  standing: LiveStanding | null;
  /**
   * With no coordinator connected: the one that connected desktops report following on the
   * LAN, which is therefore still presenting and gets the role back when it returns.
   */
  awaiting: ({ deviceId: string; name: string } & LiveStanding) | null;
  remotes: Map<string, Remote>;
  outputs: Set<Output>;
}

const OUTPUT_PREFIX = 'output:';

const send = (
  socket: Socket,
  message: RelayToDesktop | RelayToRemote | RelayToOutput | unknown,
) => {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket is closing; its close handler cleans up.
  }
};

function parse(raw: unknown): unknown {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

export class Relay {
  private readonly rooms = new Map<string, WorkspaceRoom>();

  constructor(
    private readonly instance: RelayDirectory,
    private readonly now: () => number = () => Date.now(),
    /** Where refused messages are reported; they are dropped, so this is the only trace. */
    private readonly warn: (message: string, detail: Record<string, unknown>) => void = (
      message,
      detail,
    ) => console.warn(message, detail),
    private readonly options: RelayOptions = {},
  ) {}

  private room(workspaceId: string): WorkspaceRoom {
    let room = this.rooms.get(workspaceId);
    if (!room) {
      room = {
        desktops: new Set(),
        coordinator: null,
        standing: null,
        awaiting: null,
        remotes: new Map(),
        outputs: new Set(),
      };
      this.rooms.set(workspaceId, room);
    }
    return room;
  }

  /** Tells every desktop of a workspace, except the one that made the change, to pull. */
  contentChanged(workspaceId: string, exceptDeviceId: string): void {
    for (const desktop of this.rooms.get(workspaceId)?.desktops ?? []) {
      if (desktop.deviceId !== exceptDeviceId) send(desktop.socket, { type: 'changed' });
    }
  }

  /** Tells every desktop of every workspace, except the one that made the change, to pull. */
  contentChangedAll(exceptDeviceId: string): void {
    for (const workspaceId of this.rooms.keys()) this.contentChanged(workspaceId, exceptDeviceId);
  }

  /** Disconnects a revoked device straight away. */
  deviceRevoked(deviceId: string): void {
    for (const room of this.rooms.values()) {
      for (const desktop of room.desktops) {
        if (desktop.deviceId === deviceId) desktop.socket.close(4001, 'revoked');
      }
    }
  }

  /** Disconnects the pages of a revoked output link straight away. */
  outputRevoked(linkId: string): void {
    for (const room of this.rooms.values()) {
      for (const output of room.outputs) {
        if (output.id === linkId) {
          send(output.socket, { type: 'rejected', reason: 'revoked' } satisfies RelayToOutput);
          output.socket.close(4001, 'revoked');
        }
      }
    }
  }

  /** Disconnects desktops and outputs whose credentials were revoked, also by the admin command. */
  sweep(): void {
    for (const room of this.rooms.values()) {
      for (const desktop of room.desktops) {
        if (!this.instance.isActiveDevice(desktop.deviceId)) desktop.socket.close(4001, 'revoked');
      }
      for (const output of room.outputs) {
        if (!this.instance.isActiveOutputLink(output.id)) output.socket.close(4001, 'revoked');
      }
    }
  }

  /**
   * Hands an administrator's signal to the broadcasting desktop's own connection, never
   * through the coordinator (A22). False when that desktop is not connected here, or does
   * not take audio, so the server can answer at once.
   */
  adminAudioSignal(
    workspaceId: string,
    deviceId: string,
    name: string,
    signal: AudioSignal,
    /** Who listens, the same for every session of one administrator's page (A20). */
    listener?: string,
  ): boolean {
    const parsed = AudioSignalSchema.safeParse(signal);
    if (!parsed.success) return false;
    for (const desktop of this.rooms.get(workspaceId)?.desktops ?? []) {
      if (desktop.deviceId !== deviceId || desktop.capabilities?.audio !== true) continue;
      send(desktop.socket, {
        type: 'adminAudioSignal',
        name,
        signal: parsed.data,
        ...(listener ? { listener } : {}),
      } satisfies RelayToDesktop);
      return true;
    }
    return false;
  }

  coordinatorName(workspaceId: string): string | null {
    return this.rooms.get(workspaceId)?.coordinator?.name ?? null;
  }

  /** Every desktop and output of a workspace connected right now (D20: the server's help). */
  peers(workspaceId: string): RelayPeer[] {
    const room = this.rooms.get(workspaceId);
    if (!room) return [];
    const iso = (at: number) => new Date(at).toISOString();
    return [
      ...[...room.desktops].map((desktop) => ({
        deviceId: desktop.deviceId,
        name: desktop.name,
        role: desktop.role,
        capabilities: desktop.capabilities,
        lan: desktop.lan ?? null,
        connectedAt: iso(desktop.connectedAt),
      })),
      ...[...room.outputs].map((output) => ({
        deviceId: `${OUTPUT_PREFIX}${output.id}`,
        name: output.name,
        role: 'output' as const,
        capabilities: output.capabilities as Capabilities | undefined,
        connectedAt: iso(output.connectedAt),
      })),
    ];
  }

  /**
   * Tells every desktop who coordinates: the connected coordinator, else the one being
   * awaited, which followers on the LAN still reach. `dropped` lost the role, or a claim to
   * it, to another live state (D14) and is told not to hand its own over.
   */
  private announce(room: WorkspaceRoom, workspaceId: string, dropped?: Desktop | null): void {
    const peers = this.peers(workspaceId);
    const named = room.coordinator ?? room.awaiting;
    for (const each of room.desktops) {
      send(each.socket, {
        type: 'ready',
        workspaceId,
        deviceId: each.deviceId,
        coordinator: room.coordinator === each,
        coordinatorName: named?.name ?? null,
        coordinatorId: named?.deviceId ?? null,
        peers,
        ...(each === dropped ? { handover: false } : {}),
      } satisfies RelayToDesktop);
    }
  }

  /**
   * Where the role goes when a desktop connects. Without a coordinator the first operator
   * device takes it, unless desktops follow one on the LAN that has not come back yet. A
   * desktop that was presenting takes it back when it is the one awaited, or when its live
   * state outranks the one standing (D14). Returns whether the newcomer takes the role, and
   * which desktop, if any, is told to drop its own live state.
   */
  private seat(
    room: WorkspaceRoom,
    desktop: Desktop,
  ): { take: boolean; standing: LiveStanding | null; dropped: Desktop | null } {
    const live = desktop.live;
    const standing =
      live?.kind === 'coordinating'
        ? { startedAt: live.startedAt, updatedAt: live.updatedAt }
        : null;
    const operator = desktop.role === 'operator';
    if (this.options.claims === false) {
      return { take: operator && !room.coordinator, standing, dropped: null };
    }
    const awaited = room.awaiting;
    if (awaited?.deviceId === desktop.deviceId) {
      if (operator) return { take: true, standing: standing ?? awaited, dropped: null };
      // Back as a viewer: it presents nothing now, and a viewer is never seated.
      room.awaiting = null;
      return { take: false, standing: null, dropped: null };
    }
    if (live?.kind === 'following' && !room.coordinator) {
      // It follows someone on the LAN, who may be the one to await; it does not seat itself.
      this.settleAwaiting(room);
      return { take: false, standing: null, dropped: null };
    }
    if (!operator) return { take: false, standing: null, dropped: null };
    if (standing) {
      const incumbent = room.coordinator ? room.standing : awaited;
      if (!room.coordinator && !awaited) return { take: true, standing, dropped: null };
      // A coordinator whose live state is not known yet has not presented anything here.
      if (!incumbent || outranks(standing, incumbent)) {
        return { take: true, standing, dropped: room.coordinator };
      }
      // It presented a live state that is not kept: it follows, and drops its own.
      return { take: false, standing: null, dropped: desktop };
    }
    return { take: !room.coordinator && !awaited, standing: null, dropped: null };
  }

  /**
   * The coordinator is gone. No other desktop takes over by itself; one does when an
   * operator asks (D18), or when a presenter returns (D14).
   */
  private unseat(room: WorkspaceRoom): void {
    room.coordinator = null;
    room.standing = null;
    for (const output of room.outputs) {
      send(output.socket, { type: 'waiting' } satisfies RelayToOutput);
    }
  }

  /**
   * With no coordinator connected, the presenter the connected desktops vouch for: the one
   * awaited while some desktop still reports following it, else another one reported. A
   * device connected here is not awaited: it has been seated, or not, already. Returns
   * whether the answer changed.
   */
  private settleAwaiting(room: WorkspaceRoom): boolean {
    const before = room.awaiting;
    if (room.coordinator) {
      room.awaiting = null;
      return before !== null;
    }
    const connected = new Set([...room.desktops].map((each) => each.deviceId));
    const vouched = [...room.desktops].flatMap((each) =>
      each.live?.kind === 'following' && !connected.has(each.live.deviceId) ? [each.live] : [],
    );
    if (before && vouched.some((live) => live.deviceId === before.deviceId)) return false;
    const next = vouched[0];
    room.awaiting = next
      ? {
          deviceId: next.deviceId,
          name: next.name,
          startedAt: next.startedAt,
          updatedAt: next.updatedAt,
        }
      : null;
    return (room.awaiting?.deviceId ?? null) !== (before?.deviceId ?? null);
  }

  /** Where a phone's hello goes: its invitation's desktop, else the coordinator. */
  private routeFor(room: WorkspaceRoom, hello: unknown): Desktop | null {
    const invite = (hello as { invite?: unknown } | null)?.invite;
    if (typeof invite === 'string' && invite.includes('.')) {
      const deviceId = invite.slice(0, invite.indexOf('.'));
      for (const desktop of room.desktops) if (desktop.deviceId === deviceId) return desktop;
    }
    return room.coordinator;
  }

  /** Asks the coordinator to send an output page the current snapshot. */
  private feedOutput(room: WorkspaceRoom, output: Output): void {
    if (!room.coordinator) return send(output.socket, { type: 'waiting' } satisfies RelayToOutput);
    send(room.coordinator.socket, {
      type: 'peer',
      from: `${OUTPUT_PREFIX}${output.id}`,
      data: { type: 'resync', have: 0 },
    } satisfies RelayToDesktop);
  }

  // ── Desktops ─────────────────────────────────────────────────────────────

  /** A desktop's connection. Returns the handlers for its messages and its closing. */
  desktop(socket: Socket): { message(raw: unknown): void; close(): void } {
    let desktop: Desktop | null = null;
    let workspaceId: string | null = null;

    const becomeCoordinator = (
      room: WorkspaceRoom,
      id: string,
      standing: LiveStanding | null = null,
      dropped: Desktop | null = null,
    ) => {
      room.coordinator = desktop;
      room.standing = standing;
      room.awaiting = null;
      this.announce(room, id, dropped);
      // Phones waiting for a desktop introduce themselves to the coordinator.
      for (const remote of room.remotes.values()) {
        if (!remote.desktop) {
          remote.desktop = desktop;
          send(socket, { type: 'message', from: remote.id, data: remote.hello });
        }
      }
      for (const output of room.outputs) this.feedOutput(room, output);
    };

    const toOutput = (room: WorkspaceRoom, to: string, data: unknown) => {
      const id = to.slice(OUTPUT_PREFIX.length);
      for (const output of room.outputs) if (output.id === id) send(output.socket, data);
    };

    return {
      message: (raw) => {
        const message = parse(raw) as DesktopToRelay | null;
        if (!message || typeof message !== 'object') return;
        if (desktop) desktop.lastSeenAt = this.now();
        if (message.type === 'ping') return send(socket, { type: 'pong' });
        if (!desktop) {
          if (message.type !== 'hello') return;
          if (!isCompatibleProtocol(message.protocolVersion)) {
            send(socket, { type: 'update-needed' });
            return socket.close(4000, 'update-needed');
          }
          const device = this.instance.authenticate(String(message.token ?? ''));
          if (!device) {
            send(socket, { type: 'rejected', reason: 'unauthorized' });
            return socket.close(4001, 'unauthorized');
          }
          const now = this.now();
          desktop = {
            socket,
            deviceId: device.id,
            name: device.name,
            role: message.role === 'viewer' ? 'viewer' : 'operator',
            capabilities: message.capabilities,
            lan: message.lan ?? null,
            live: readPresence(message.live),
            connectedAt: now,
            lastSeenAt: now,
          };
          workspaceId = device.workspaceId;
          const room = this.room(workspaceId);
          this.options.note?.('Desktop connected', {
            workspaceId,
            deviceId: device.id,
            name: device.name,
            role: desktop.role,
            replacing: [...room.desktops].some((old) => old.deviceId === device.id),
          });
          // The same device connecting again, for example after the computer slept, before
          // its old connection timed out here: the new connection takes over everything.
          for (const old of room.desktops) {
            if (old.deviceId === device.id) {
              room.desktops.delete(old);
              for (const remote of room.remotes.values()) {
                if (remote.desktop === old) remote.desktop = desktop;
              }
              if (room.coordinator === old) {
                // Unless it is back as a viewer, which is never seated (M3.2).
                if (desktop.role === 'operator') room.coordinator = desktop;
                else this.unseat(room);
              }
              old.socket.close(4002, 'replaced');
            }
          }
          // What the old connection said it was following no longer counts.
          this.settleAwaiting(room);
          room.desktops.add(desktop);
          if (room.coordinator === desktop) {
            return becomeCoordinator(room, workspaceId, room.standing);
          }
          // A viewer never becomes coordinator (M3.2).
          const seat = this.seat(room, desktop);
          if (seat.take) return becomeCoordinator(room, workspaceId, seat.standing, seat.dropped);
          return this.announce(room, workspaceId, seat.dropped);
        }
        const room = this.room(workspaceId!);
        switch (message.type) {
          case 'presence':
            // Never seats anyone: roles are settled on connecting and by claims. It keeps
            // the room's idea of who is still presenting on the LAN fresh.
            desktop.live = readPresence(message.live);
            if (this.settleAwaiting(room)) this.announce(room, workspaceId!);
            return;
          case 'claim':
            if (this.options.claims === false) {
              this.warn('Refused a claim to the coordinator role', {
                workspaceId,
                from: desktop.deviceId,
              });
              return;
            }
            if (room.coordinator !== desktop && desktop.role === 'operator') {
              // Its live state is known from its first snapshot.
              becomeCoordinator(room, workspaceId!);
            }
            return;
          case 'send': {
            const targets = message.to
              ? [room.remotes.get(message.to)].filter((r): r is Remote => !!r)
              : [...room.remotes.values()];
            for (const remote of targets) {
              if (remote.desktop === desktop) send(remote.socket, message.data);
            }
            return;
          }
          case 'adminAudioSignal': {
            const signal = AudioSignalSchema.safeParse(message.signal);
            if (!signal.success) {
              this.warn('Refused a malformed audio signal for an administrator', {
                workspaceId,
                from: desktop.deviceId,
                issues: signal.error.issues,
              });
              return;
            }
            this.options.adminAudio?.(workspaceId!, desktop.deviceId, signal.data);
            return;
          }
          case 'drop': {
            const remote = room.remotes.get(message.to);
            if (remote?.desktop === desktop) remote.socket.close(4003, 'dropped');
            return;
          }
          case 'toCoordinator': {
            const data = FollowerToCoordinatorSchema.safeParse(message.data);
            const coordinator = room.coordinator;
            if (!data.success) {
              this.warn('Refused a malformed message to the coordinator', {
                workspaceId,
                from: desktop.deviceId,
                issues: data.error.issues,
              });
              return;
            }
            if (!coordinator || coordinator === desktop) return;
            if (
              data.data.type === 'command' &&
              data.data.command.type === 'addPassage' &&
              !coordinator.capabilities?.passages
            ) {
              // A coordinator older than passages cannot make the item (protocol 6).
              send(desktop.socket, {
                type: 'peer',
                from: coordinator.deviceId,
                data: { type: 'ack', id: data.data.id, applied: false },
              } satisfies RelayToDesktop);
              return;
            }
            send(coordinator.socket, {
              type: 'peer',
              from: desktop.deviceId,
              data: data.data,
            } satisfies RelayToDesktop);
            return;
          }
          case 'toFollower': {
            if (room.coordinator !== desktop) return;
            const data = CoordinatorToFollowerSchema.safeParse(message.data);
            if (!data.success) {
              this.warn('Refused a malformed message from the coordinator', {
                workspaceId,
                from: desktop.deviceId,
                issues: data.error.issues,
              });
              return;
            }
            if (data.data.type === 'snapshot') {
              const { startedAt, updatedAt } = data.data.snapshot.state;
              room.standing = { startedAt, updatedAt };
            }
            if (message.to?.startsWith(OUTPUT_PREFIX)) {
              if (data.data.type === 'snapshot') toOutput(room, message.to, data.data);
              return;
            }
            const peer: RelayToDesktop = { type: 'peer', from: desktop.deviceId, data: data.data };
            // A desktop older than video items is sent them as decks with nothing to show
            // (U20, U21), and one older than passages is sent them as lyrics (P3.5): what
            // it can read.
            const snapshot = data.data.type === 'snapshot' ? data.data : null;
            const forDesktop = (each: Desktop): RelayToDesktop => {
              if (!snapshot) return peer;
              const readable = snapshotFor(snapshot.snapshot, each.capabilities);
              return readable === snapshot.snapshot
                ? peer
                : { ...peer, data: { ...snapshot, snapshot: readable } };
            };
            if (message.to) {
              for (const each of room.desktops) {
                if (each.deviceId === message.to) send(each.socket, forDesktop(each));
              }
              return;
            }
            for (const each of room.desktops) {
              if (each !== desktop) send(each.socket, forDesktop(each));
            }
            // Outputs only ever see snapshots.
            if (data.data.type === 'snapshot') {
              for (const output of room.outputs) send(output.socket, data.data);
            }
            return;
          }
        }
      },
      close: () => {
        if (!desktop || !workspaceId) return;
        const room = this.room(workspaceId);
        if (!room.desktops.delete(desktop)) return;
        const phones = [...room.remotes.values()].filter((r) => r.desktop === desktop).length;
        this.options.note?.('Desktop left; its phones are told to reconnect', {
          workspaceId,
          deviceId: desktop.deviceId,
          name: desktop.name,
          coordinator: room.coordinator === desktop,
          phones,
          openForMs: this.now() - desktop.connectedAt,
          sinceLastMessageMs: this.now() - desktop.lastSeenAt,
        });
        // Its phones come back with their grants and are routed to the coordinator (M2.8).
        for (const remote of room.remotes.values()) {
          if (remote.desktop !== desktop) continue;
          remote.desktop = null;
          send(remote.socket, { type: 'unavailable', reason: 'reconnect' } satisfies RelayToRemote);
          remote.socket.close(4005, 'reconnect');
        }
        if (room.coordinator === desktop) this.unseat(room);
        // Followers still reaching it on the LAN keep the role for it until it is back.
        this.settleAwaiting(room);
        this.announce(room, workspaceId);
      },
    };
  }

  // ── Phones ───────────────────────────────────────────────────────────────

  remote(socket: Socket): { message(raw: unknown): void; close(): void } {
    let remote: Remote | null = null;

    return {
      message: (raw) => {
        const data = parse(raw);
        const parsed = RemoteToHostSchema.safeParse(data);
        if (!parsed.success) return;
        if (parsed.data.type === 'ping') return send(socket, { type: 'pong' });
        if (!remote) {
          const hello = parsed.data;
          if (hello.type !== 'hello') return;
          if (!isCompatibleProtocol(hello.protocolVersion)) {
            send(socket, { type: 'update-needed' } satisfies RelayToRemote);
            return socket.close(4000, 'update-needed');
          }
          const workspace = hello.workspace ? this.instance.getWorkspace(hello.workspace) : null;
          if (!workspace) {
            send(socket, { type: 'unavailable', reason: 'no-workspace' } satisfies RelayToRemote);
            return socket.close(4004, 'no-workspace');
          }
          const room = this.room(workspace.id);
          const desktop = this.routeFor(room, hello);
          remote = { id: connectionId(), socket, workspaceId: workspace.id, hello, desktop };
          room.remotes.set(remote.id, remote);
          if (desktop) send(desktop.socket, { type: 'message', from: remote.id, data: hello });
          else send(socket, { type: 'unavailable', reason: 'presentation-offline' });
          return;
        }
        if (remote.desktop) {
          const message = parsed.data;
          // A desktop older than passages could not read the Bible's messages (protocol 6):
          // a phone's passage is refused, and its Bible requests answered as offline.
          if (!remote.desktop.capabilities?.passages) {
            if (message.type === 'command' && message.command.type === 'addPassage') {
              return send(socket, {
                type: 'ack',
                id: message.id,
                applied: false,
              } satisfies HostToRemote);
            }
            if (isBibleMessage(message)) return refuseBible(socket, message);
          }
          send(remote.desktop.socket, { type: 'message', from: remote.id, data: message });
        }
      },
      close: () => {
        if (!remote) return;
        const room = this.room(remote.workspaceId);
        room.remotes.delete(remote.id);
        if (remote.desktop) send(remote.desktop.socket, { type: 'left', from: remote.id });
      },
    };
  }

  // ── Browser outputs ──────────────────────────────────────────────────────

  /** An output page's connection (D22, M7.3). It receives snapshots and may send nothing. */
  output(socket: Socket): { message(raw: unknown): void; close(): void } {
    let output: Output | null = null;

    return {
      message: (raw) => {
        const parsed = OutputToRelaySchema.safeParse(parse(raw));
        if (!parsed.success) {
          // Anything else, including a command, ends the connection (criterion 32).
          return socket.close(4006, 'not-allowed');
        }
        if (parsed.data.type === 'ping') return send(socket, { type: 'pong' });
        if (output) return socket.close(4006, 'not-allowed');
        const hello = parsed.data;
        if (!isCompatibleProtocol(hello.protocolVersion)) {
          send(socket, { type: 'update-needed' } satisfies RelayToOutput);
          return socket.close(4000, 'update-needed');
        }
        const link = this.instance.authenticateOutputLink(hello.token);
        if (!link) {
          send(socket, { type: 'rejected', reason: 'unauthorized' } satisfies RelayToOutput);
          return socket.close(4001, 'unauthorized');
        }
        output = {
          id: link.id,
          socket,
          workspaceId: link.workspaceId,
          kind: link.kind,
          name: link.name,
          connectedAt: this.now(),
          capabilities: hello.capabilities,
        };
        const room = this.room(link.workspaceId);
        room.outputs.add(output);
        send(socket, {
          type: 'ready',
          kind: link.kind,
          look: this.instance.outputLook(link.workspaceId, link.kind),
        } satisfies RelayToOutput);
        this.announce(room, link.workspaceId);
        this.feedOutput(room, output);
      },
      close: () => {
        if (!output) return;
        const room = this.room(output.workspaceId);
        if (room.outputs.delete(output)) this.announce(room, output.workspaceId);
      },
    };
  }
}

/** Answers a phone's Bible request for a desktop that cannot (protocol 6). */
function refuseBible(socket: Socket, message: RemoteToHost): void {
  const answer = (data: HostToRemote) => send(socket, data);
  switch (message.type) {
    case 'bibleVersions':
      return answer({ type: 'bibleVersions', id: message.id, offered: [], versions: [] });
    case 'bibleToc':
      return answer({ type: 'bibleToc', id: message.id, toc: null, error: 'offline' });
    case 'biblePassage':
      return answer({ type: 'biblePassage', id: message.id, passage: null, error: 'offline' });
    case 'bibleSearch':
      return answer({
        type: 'bibleSearch',
        id: message.id,
        references: [],
        searched: false,
        error: 'offline',
      });
    default:
      return;
  }
}
