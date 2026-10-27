/**
 * The phone's connection to the coordinator, through the church instance's relay.
 *
 * The invitation from the QR code requests access; after an operator approves, the grant
 * it returns is kept on this phone and used to reconnect, also after the page is reloaded.
 */
import {
  PROTOCOL_VERSION,
  type HostToRemote,
  type RelayToRemote,
  type RemoteCommand,
  type RemoteSongResult,
  type RemoteView,
} from '@worship-q/protocol';

export type RemoteState =
  | { kind: 'name' }
  | { kind: 'connecting' }
  | { kind: 'pending'; code: string }
  | { kind: 'live'; view: RemoteView | null }
  | { kind: 'offline' }
  | { kind: 'denied'; reason: 'denied' | 'invalid-invite' | 'revoked' | 'no-invite' }
  | { kind: 'no-workspace' }
  | { kind: 'update-needed' };

const RETRY_MS = [1000, 2000, 4000, 8000, 15000];
/** The relay is pinged this often; a ping left unanswered means the connection is gone. */
const PING_MS = 15_000;

function storage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private browsing: the phone is asked again next time.
  }
  return value ?? null;
}

export class RemoteConnection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private state_: RemoteState;
  private readonly listeners = new Set<() => void>();
  private counter = 0;
  private readonly searches = new Map<string, (songs: RemoteSongResult[]) => void>();
  readonly workspace: string;
  private invite: string | null;

  constructor(location: Location) {
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    this.workspace = query.get('w') ?? '';
    this.invite = hash.get('i');
    this.state_ = this.name ? { kind: 'connecting' } : { kind: 'name' };
  }

  get state(): RemoteState {
    return this.state_;
  }

  get name(): string {
    return storage('wq.remote.name') ?? '';
  }

  private get grantKey(): string {
    return `wq.remote.grant.${this.workspace}`;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(state: RemoteState): void {
    this.state_ = state;
    for (const listener of [...this.listeners]) listener();
  }

  start(name?: string): void {
    if (name !== undefined) storage('wq.remote.name', name.trim().slice(0, 40));
    if (!this.name) return this.set({ kind: 'name' });
    if (!this.workspace) return this.set({ kind: 'no-workspace' });
    if (!this.invite && !storage(this.grantKey)) {
      return this.set({ kind: 'denied', reason: 'no-invite' });
    }
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }

  private open(): void {
    if (this.state_.kind !== 'live') this.set({ kind: 'connecting' });
    const url = `${location.origin.replace(/^http/, 'ws')}/api/v1/remote`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          workspace: this.workspace,
          name: this.name,
          grant: storage(this.grantKey) ?? undefined,
          invite: this.invite ?? undefined,
        }),
      );
    };
    // A connection the instance dropped while the phone was locked still looks open here.
    let answered = true;
    let answers = false;
    let ticked = Date.now();
    const heartbeat = setInterval(() => {
      const now = Date.now();
      // A late timer means the phone slept for long enough to be dropped.
      const slept = now - ticked > PING_MS * 2;
      ticked = now;
      // Instances that never answer pings predate them and are not held to it.
      if (slept || (answers && !answered)) return lost();
      answered = false;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, PING_MS);
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const message = JSON.parse(String(event.data)) as HostToRemote | RelayToRemote;
      if (message.type === 'pong') {
        answered = answers = true;
        return;
      }
      this.receive(message);
    };
    const lost = () => {
      clearInterval(heartbeat);
      if (this.socket !== socket) return;
      this.socket = null;
      for (const resolve of this.searches.values()) resolve([]);
      this.searches.clear();
      // Closing a dead connection can take long to finish, so this does not wait for it.
      socket.close();
      if (this.stopped) return;
      const final = ['denied', 'update-needed', 'no-workspace'].includes(this.state_.kind);
      if (final) return;
      if (this.state_.kind === 'live') this.set({ kind: 'live', view: this.state_.view });
      const delay = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]!;
      this.timer = setTimeout(() => this.open(), delay);
    };
    socket.onclose = lost;
  }

  private receive(message: HostToRemote | RelayToRemote): void {
    switch (message.type) {
      case 'update-needed':
        return this.set({ kind: 'update-needed' });
      case 'unavailable':
        return this.set(
          message.reason === 'no-workspace' ? { kind: 'no-workspace' } : { kind: 'offline' },
        );
      case 'pending':
        return this.set({ kind: 'pending', code: message.code });
      case 'approved':
        storage(this.grantKey, message.grant);
        // The invitation is used up; reloading the page uses the grant instead.
        this.invite = null;
        history.replaceState(null, '', location.pathname + location.search);
        this.attempt = 0;
        return this.set({
          kind: 'live',
          view: this.state_.kind === 'live' ? this.state_.view : null,
        });
      case 'denied':
        if (message.reason === 'revoked') storage(this.grantKey, null);
        return this.set({ kind: 'denied', reason: message.reason });
      case 'view':
        this.attempt = 0;
        return this.set({ kind: 'live', view: message.view });
      case 'searchResults':
        this.searches.get(message.id)?.(message.songs);
        this.searches.delete(message.id);
        return;
      case 'ack':
      case 'pong':
        return;
    }
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.state_.kind === 'live';
  }

  private newId(): string {
    return `${Date.now().toString(36)}-${++this.counter}-${Math.random().toString(36).slice(2, 8)}`;
  }

  send(command: RemoteCommand): void {
    if (!this.connected) return;
    this.socket!.send(JSON.stringify({ type: 'command', id: this.newId(), command }));
  }

  /**
   * Searches the library for songs to add. Resolves with nothing when the connection is lost
   * before the answer comes, or when a later search replaces this one.
   */
  search(query: string): Promise<RemoteSongResult[]> {
    for (const resolve of this.searches.values()) resolve([]);
    this.searches.clear();
    if (!this.connected || !query.trim()) return Promise.resolve([]);
    const id = this.newId();
    return new Promise((resolve) => {
      this.searches.set(id, resolve);
      this.socket!.send(JSON.stringify({ type: 'search', id, query }));
    });
  }

  /** Forget the approval on this phone, for example before handing it on. */
  leave(): void {
    storage(this.grantKey, null);
    this.stop();
    this.set({ kind: 'denied', reason: 'no-invite' });
  }
}
