/**
 * Relays live traffic between the devices of a workspace: its desktops, the phones that
 * control it, and browser output pages.
 *
 * The relay holds no presentation state and makes no approval decisions. One desktop per
 * workspace is the coordinator and holds the live state (plan M1, decision D14); the relay
 * carries the other desktops' commands to it and its snapshots back, keeps the role with
 * the first operator device until another claims it, and tells everyone who has it. Each
 * phone reaches the desktop whose invitation it scanned, or the coordinator when it comes
 * back with a grant (decision D25). Output pages receive snapshots and may send nothing.
 */
import {
  CoordinatorToFollowerSchema,
  FollowerToCoordinatorSchema,
  isCompatibleProtocol,
  OutputToRelaySchema,
  RemoteToHostSchema,
  type Capabilities,
  type DesktopToRelay,
  type DeviceRole,
  type OutputKind,
  type RelayPeer,
  type RelayToDesktop,
  type OutputView,
  type RelayToOutput,
  type RelayToRemote,
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
  ) {}

  private room(workspaceId: string): WorkspaceRoom {
    let room = this.rooms.get(workspaceId);
    if (!room) {
      room = { desktops: new Set(), coordinator: null, remotes: new Map(), outputs: new Set() };
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

  private announce(room: WorkspaceRoom, workspaceId: string): void {
    const peers = this.peers(workspaceId);
    for (const each of room.desktops) {
      send(each.socket, {
        type: 'ready',
        workspaceId,
        deviceId: each.deviceId,
        coordinator: room.coordinator === each,
        coordinatorName: room.coordinator?.name ?? null,
        coordinatorId: room.coordinator?.deviceId ?? null,
        peers,
      } satisfies RelayToDesktop);
    }
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

    const becomeCoordinator = (room: WorkspaceRoom, id: string) => {
      room.coordinator = desktop;
      this.announce(room, id);
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
            connectedAt: now,
            lastSeenAt: now,
          };
          workspaceId = device.workspaceId;
          const room = this.room(workspaceId);
          // The same device connecting again, for example after the computer slept, before
          // its old connection timed out here: the new connection takes over everything.
          for (const old of room.desktops) {
            if (old.deviceId === device.id) {
              room.desktops.delete(old);
              for (const remote of room.remotes.values()) {
                if (remote.desktop === old) remote.desktop = desktop;
              }
              if (room.coordinator === old) room.coordinator = desktop;
              old.socket.close(4002, 'replaced');
            }
          }
          room.desktops.add(desktop);
          if (room.coordinator === desktop) return becomeCoordinator(room, workspaceId);
          // The first operator device becomes coordinator; a viewer never does (M3.2).
          if (!room.coordinator && desktop.role === 'operator') {
            return becomeCoordinator(room, workspaceId);
          }
          return this.announce(room, workspaceId);
        }
        const room = this.room(workspaceId!);
        switch (message.type) {
          case 'claim':
            if (room.coordinator !== desktop && desktop.role === 'operator') {
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
          case 'drop': {
            const remote = room.remotes.get(message.to);
            if (remote?.desktop === desktop) remote.socket.close(4003, 'dropped');
            return;
          }
          case 'toCoordinator': {
            const data = FollowerToCoordinatorSchema.safeParse(message.data);
            const coordinator = room.coordinator;
            if (!data.success || !coordinator || coordinator === desktop) return;
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
            if (!data.success) return;
            if (message.to?.startsWith(OUTPUT_PREFIX)) {
              if (data.data.type === 'snapshot') toOutput(room, message.to, data.data);
              return;
            }
            const peer: RelayToDesktop = { type: 'peer', from: desktop.deviceId, data: data.data };
            if (message.to) {
              for (const each of room.desktops) {
                if (each.deviceId === message.to) send(each.socket, peer);
              }
              return;
            }
            for (const each of room.desktops) if (each !== desktop) send(each.socket, peer);
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
        // Its phones come back with their grants and are routed to the coordinator (M2.8).
        for (const remote of room.remotes.values()) {
          if (remote.desktop !== desktop) continue;
          remote.desktop = null;
          send(remote.socket, { type: 'unavailable', reason: 'reconnect' } satisfies RelayToRemote);
          remote.socket.close(4005, 'reconnect');
        }
        if (room.coordinator === desktop) {
          // No other desktop takes over by itself; one does when an operator asks (D18).
          room.coordinator = null;
          for (const output of room.outputs) {
            send(output.socket, { type: 'waiting' } satisfies RelayToOutput);
          }
        }
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
          send(remote.desktop.socket, { type: 'message', from: remote.id, data: parsed.data });
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
