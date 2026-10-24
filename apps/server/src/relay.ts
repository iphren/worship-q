/**
 * Relays remote-control traffic between phones and the workspace's coordinator desktop.
 *
 * The relay holds no presentation state and makes no approval decisions: the coordinator
 * checks every invitation and grant itself. The relay only authenticates desktops, keeps
 * one coordinator per workspace, and keeps phones from talking to anything but it.
 */
import { randomUUID } from 'node:crypto';
import {
  isCompatibleProtocol,
  RemoteToHostSchema,
  type CoordinatorToRelay,
  type RelayToCoordinator,
  type RelayToRemote,
} from '@worship-q/protocol';
import type { Instance } from './instance';

/** The part of a WebSocket the relay uses, so tests can supply their own. */
export interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Desktop {
  socket: Socket;
  deviceId: string;
  name: string;
  connectedAt: number;
}

interface Remote {
  id: string;
  socket: Socket;
  workspaceId: string;
  /** The hello, given again to a coordinator that connects later. */
  hello: unknown;
}

interface WorkspaceRoom {
  desktops: Set<Desktop>;
  coordinator: Desktop | null;
  remotes: Map<string, Remote>;
}

const send = (socket: Socket, message: RelayToCoordinator | RelayToRemote | unknown) => {
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

  constructor(private readonly instance: Instance) {}

  private room(workspaceId: string): WorkspaceRoom {
    let room = this.rooms.get(workspaceId);
    if (!room) {
      room = { desktops: new Set(), coordinator: null, remotes: new Map() };
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

  /** Disconnects a revoked device straight away. */
  deviceRevoked(deviceId: string): void {
    for (const room of this.rooms.values()) {
      for (const desktop of room.desktops) {
        if (desktop.deviceId === deviceId) desktop.socket.close(4001, 'revoked');
      }
    }
  }

  /** Disconnects desktops whose device was revoked, also by the admin command. */
  sweep(): void {
    for (const room of this.rooms.values()) {
      for (const desktop of room.desktops) {
        if (!this.instance.isActiveDevice(desktop.deviceId)) desktop.socket.close(4001, 'revoked');
      }
    }
  }

  coordinatorName(workspaceId: string): string | null {
    return this.rooms.get(workspaceId)?.coordinator?.name ?? null;
  }

  // ── Desktops ─────────────────────────────────────────────────────────────

  /** A desktop's connection. Returns the handlers for its messages and its closing. */
  desktop(socket: Socket): { message(raw: unknown): void; close(): void } {
    let desktop: Desktop | null = null;
    let workspaceId: string | null = null;

    const announce = (room: WorkspaceRoom, id: string) => {
      for (const each of room.desktops) {
        send(each.socket, {
          type: 'ready',
          workspaceId: id,
          coordinator: room.coordinator === each,
          coordinatorName: room.coordinator?.name ?? null,
        } satisfies RelayToCoordinator);
      }
    };

    const becomeCoordinator = (room: WorkspaceRoom, id: string) => {
      room.coordinator = desktop;
      announce(room, id);
      // Phones already waiting introduce themselves to the new coordinator.
      for (const remote of room.remotes.values()) {
        send(socket, { type: 'message', from: remote.id, data: remote.hello });
      }
    };

    return {
      message: (raw) => {
        const message = parse(raw) as CoordinatorToRelay | null;
        if (!message || typeof message !== 'object') return;
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
          desktop = { socket, deviceId: device.id, name: device.name, connectedAt: Date.now() };
          workspaceId = device.workspaceId;
          const room = this.room(workspaceId);
          room.desktops.add(desktop);
          if (!room.coordinator) becomeCoordinator(room, workspaceId);
          else announce(room, workspaceId);
          return;
        }
        const room = this.room(workspaceId!);
        switch (message.type) {
          case 'claim':
            if (room.coordinator !== desktop) becomeCoordinator(room, workspaceId!);
            return;
          case 'send': {
            if (room.coordinator !== desktop) return;
            const targets = message.to
              ? [room.remotes.get(message.to)].filter((r): r is Remote => !!r)
              : [...room.remotes.values()];
            for (const remote of targets) send(remote.socket, message.data);
            return;
          }
          case 'drop':
            if (room.coordinator !== desktop) return;
            room.remotes.get(message.to)?.socket.close(4003, 'dropped');
            return;
        }
      },
      close: () => {
        if (!desktop || !workspaceId) return;
        const room = this.room(workspaceId);
        room.desktops.delete(desktop);
        if (room.coordinator === desktop) {
          // No other desktop takes over by itself; one does when an operator asks.
          room.coordinator = null;
          announce(room, workspaceId);
          for (const remote of room.remotes.values()) {
            send(remote.socket, { type: 'unavailable', reason: 'presentation-offline' });
          }
        }
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
          remote = { id: randomUUID(), socket, workspaceId: workspace.id, hello };
          const room = this.room(workspace.id);
          room.remotes.set(remote.id, remote);
          if (room.coordinator) {
            send(room.coordinator.socket, { type: 'message', from: remote.id, data: hello });
          } else {
            send(socket, { type: 'unavailable', reason: 'presentation-offline' });
          }
          return;
        }
        const room = this.room(remote.workspaceId);
        if (room.coordinator) {
          send(room.coordinator.socket, { type: 'message', from: remote.id, data: parsed.data });
        }
      },
      close: () => {
        if (!remote) return;
        const room = this.room(remote.workspaceId);
        room.remotes.delete(remote.id);
        if (room.coordinator) send(room.coordinator.socket, { type: 'left', from: remote.id });
      },
    };
  }
}
