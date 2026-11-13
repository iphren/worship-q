/**
 * The phone's connection to an operator device, through the church instance's relay.
 *
 * The invitation from the QR code requests access from the computer that showed it; after
 * an operator approves, the grant it returns is kept on this phone and used to reconnect,
 * also after the page is reloaded. The grant belongs to the workspace (decision D25): when
 * the computer this phone was connected to goes away, the relay says so and the phone comes
 * back with its grant to whichever computer holds the presentation.
 *
 * On the venue Wi-Fi the invitation may also carry the coordinator's own address (plan
 * M5.6). A phone browser usually refuses a self-signed certificate, so that address is only
 * tried when the browser has accepted it; otherwise the relay is used and the page says so.
 */
import {
  type AudioSignal,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type HostToRemote,
  type ObsCommand,
  type ObsResult,
  type ObsSnapshot,
  type RelayToRemote,
  type RemoteCommand,
  type RemoteSongResult,
  type RemoteView,
} from '@worship-q/protocol';

export type RemoteState =
  | { kind: 'name' }
  | { kind: 'connecting' }
  | { kind: 'pending'; code: string }
  /** `reconnecting`: the computer this phone used went away; another is being reached. */
  | { kind: 'live'; view: RemoteView | null; reconnecting?: boolean }
  | { kind: 'offline' }
  | { kind: 'denied'; reason: 'denied' | 'invalid-invite' | 'revoked' | 'no-invite' }
  | { kind: 'no-workspace' }
  | { kind: 'update-needed' };

type BibleAnswer = Extract<
  HostToRemote,
  { type: 'bibleVersions' | 'bibleToc' | 'biblePassage' | 'bibleSearch' }
>;

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
  /** The coordinator's address on the venue network, from the invitation, if any (M5.6). */
  readonly lan: { addresses: string[]; port: number; fingerprint: string } | null;
  /** How the phone is connected: on the venue network, or through the church server. */
  via: 'lan' | 'relay' = 'relay';
  /**
   * The version said in the hello. The page comes with the server, so it can be newer than
   * the desktop it reaches, which then asks it to update; it steps down while the desktop
   * still accepts what it needs, as desktops do with servers (D26).
   */
  private helloVersion = PROTOCOL_VERSION;
  private readonly obsAsks = new Map<string, (result: ObsResult) => void>();
  /** Bible requests waiting for the desktop's answer (B26). */
  private readonly bibleAsks = new Map<string, (answer: BibleAnswer | null) => void>();
  private obsImage_: (ObsSnapshot & { receivedAt: number }) | null = null;
  /** The OBS screen is open; said again on every connection, as desktops forget it. */
  private obsWatching = false;
  /** When the last view arrived, for OBS timers, which it gives as of sending. */
  viewReceivedAt = 0;
  private readonly imageListeners = new Set<() => void>();
  /** Live audio signals from the broadcaster, for this phone's **Listen** (M4.4). */
  private readonly audioListeners = new Set<(signal: AudioSignal) => void>();

  constructor(location: Location) {
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    this.workspace = query.get('w') ?? '';
    this.invite = hash.get('i');
    const fingerprint = hash.get('f');
    const addresses = (hash.get('a') ?? '').split(',').filter(Boolean);
    const port = Number(hash.get('p') ?? 0);
    this.lan =
      fingerprint && addresses.length > 0 && port > 0 ? { addresses, port, fingerprint } : null;
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
          protocolVersion: this.helloVersion,
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
    const openedAt = ticked;
    let lastMessageAt = ticked;
    const heartbeat = setInterval(() => {
      const now = Date.now();
      // A late timer means the phone slept for long enough to be dropped.
      const slept = now - ticked > PING_MS * 2;
      ticked = now;
      // Instances that never answer pings predate them and are not held to it.
      if (slept || (answers && !answered)) {
        console.warn('[remote] Gave up on the connection', {
          cause: slept ? 'slept' : 'unanswered ping',
          openForMs: now - openedAt,
          sinceLastMessageMs: now - lastMessageAt,
        });
        return lost();
      }
      answered = false;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, PING_MS);
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      lastMessageAt = Date.now();
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
      for (const resolve of this.obsAsks.values()) resolve({ ok: false, error: 'not-connected' });
      this.obsAsks.clear();
      for (const resolve of this.bibleAsks.values()) resolve(null);
      this.bibleAsks.clear();
      // Closing a dead connection can take long to finish, so this does not wait for it.
      socket.close();
      if (this.stopped) return;
      const final = ['denied', 'update-needed', 'no-workspace'].includes(this.state_.kind);
      if (final) return;
      if (this.state_.kind === 'live') this.set({ kind: 'live', view: this.state_.view });
      const delay = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]!;
      this.timer = setTimeout(() => this.open(), delay);
    };
    socket.onclose = (event) => {
      console.warn('[remote] Connection closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        afterGivingUp: this.socket !== socket,
        openForMs: Date.now() - openedAt,
        sinceLastMessageMs: Date.now() - lastMessageAt,
      });
      lost();
    };
  }

  private receive(message: HostToRemote | RelayToRemote): void {
    switch (message.type) {
      case 'update-needed':
        if (this.helloVersion > MIN_PROTOCOL_VERSION && this.socket) {
          this.helloVersion--;
          this.attempt = 0;
          // Says hello again at the older version; `lost` reconnects straight away.
          const socket = this.socket;
          socket.close();
          return;
        }
        return this.set({ kind: 'update-needed' });
      case 'unavailable':
        if (message.reason === 'reconnect') {
          console.warn('[remote] The computer this phone used left the server');
          // The computer this phone used went away; the grant is accepted elsewhere (M2.8).
          if (this.state_.kind === 'live') {
            this.set({ kind: 'live', view: this.state_.view, reconnecting: true });
          }
          this.attempt = 0;
          return;
        }
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
        if (this.obsWatching)
          this.socket?.send(JSON.stringify({ type: 'obsWatch', watching: true }));
        return this.set({
          kind: 'live',
          view: this.state_.kind === 'live' ? this.state_.view : null,
        });
      case 'denied':
        if (message.reason === 'revoked') storage(this.grantKey, null);
        return this.set({ kind: 'denied', reason: message.reason });
      case 'view':
        this.attempt = 0;
        this.viewReceivedAt = Date.now();
        return this.set({ kind: 'live', view: message.view });
      case 'searchResults':
        this.searches.get(message.id)?.(message.songs);
        this.searches.delete(message.id);
        return;
      case 'obsAck': {
        const resolve = this.obsAsks.get(message.id);
        this.obsAsks.delete(message.id);
        resolve?.({
          ok: message.ok,
          ...(message.code !== undefined ? { code: message.code } : {}),
          ...(message.error !== undefined ? { error: message.error } : {}),
        });
        return;
      }
      case 'obsSnapshot':
        this.obsImage_ = { image: message.image, takenAt: message.takenAt, receivedAt: Date.now() };
        for (const listener of [...this.imageListeners]) listener();
        return;
      case 'bibleVersions':
      case 'bibleToc':
      case 'biblePassage':
      case 'bibleSearch':
        this.bibleAsks.get(message.id)?.(message);
        this.bibleAsks.delete(message.id);
        return;
      case 'audioSignal':
        for (const listener of [...this.audioListeners]) listener(message.signal);
        return;
      case 'ack':
      case 'pong':
        return;
    }
  }

  /** Live audio signals from the broadcaster, through the desktop this phone uses. */
  onAudioSignal(listener: (signal: AudioSignal) => void): () => void {
    this.audioListeners.add(listener);
    return () => this.audioListeners.delete(listener);
  }

  /** A live audio signal for the broadcaster; dropped while not connected (it asks again). */
  sendAudio(signal: AudioSignal): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.state_.kind !== 'live') return;
    this.socket.send(JSON.stringify({ type: 'audioSignal', signal }));
  }

  /**
   * Asks the desktop about the Bible; resolves with its answer, or null when the connection
   * is lost or no answer comes within fifteen seconds.
   */
  private ask(request: Record<string, unknown>): Promise<BibleAnswer | null> {
    if (!this.connected) return Promise.resolve(null);
    const id = this.newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.bibleAsks.delete(id);
        resolve(null);
      }, 15_000);
      this.bibleAsks.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      this.socket!.send(JSON.stringify({ ...request, id }));
    });
  }

  async bibleVersions(): Promise<Extract<BibleAnswer, { type: 'bibleVersions' }> | null> {
    const answer = await this.ask({ type: 'bibleVersions' });
    return answer?.type === 'bibleVersions' ? answer : null;
  }

  async bibleToc(
    version: string,
    chapter?: { book: string; chapter: number },
  ): Promise<Extract<BibleAnswer, { type: 'bibleToc' }> | null> {
    const answer = await this.ask({ type: 'bibleToc', version, ...chapter });
    return answer?.type === 'bibleToc' ? answer : null;
  }

  async biblePassage(
    reference: string,
    versions: string[],
  ): Promise<Extract<BibleAnswer, { type: 'biblePassage' }> | null> {
    const answer = await this.ask({ type: 'biblePassage', reference, versions });
    return answer?.type === 'biblePassage' ? answer : null;
  }

  async bibleSearch(
    version: string,
    query: string,
  ): Promise<Extract<BibleAnswer, { type: 'bibleSearch' }> | null> {
    const answer = await this.ask({ type: 'bibleSearch', version, query });
    return answer?.type === 'bibleSearch' ? answer : null;
  }

  /** Changes the workspace's Bible versions, as the desktop's chips do (B4). */
  setBibleVersions(versions: string[]): void {
    if (!this.connected) return;
    this.socket!.send(JSON.stringify({ type: 'bibleSetVersions', versions }));
  }

  /** The latest live monitor image, while the OBS screen is open (M4.2, M5.2). */
  get obsImage(): (ObsSnapshot & { receivedAt: number }) | null {
    return this.obsImage_;
  }

  subscribeImage = (listener: () => void) => {
    this.imageListeners.add(listener);
    return () => this.imageListeners.delete(listener);
  };

  /** Sends a command for OBS; resolves with the answer, or a failure after ten seconds. */
  obsCommand(command: ObsCommand): Promise<ObsResult> {
    if (!this.connected) return Promise.resolve({ ok: false, error: 'not-connected' });
    const id = this.newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.obsAsks.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }, 10_000);
      this.obsAsks.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.socket!.send(JSON.stringify({ type: 'obsCommand', id, command }));
    });
  }

  /** The OBS screen opened or closed: images are sent while it is open (M5.1). */
  obsWatch(watching: boolean): void {
    this.obsWatching = watching;
    if (!watching) this.obsImage_ = null;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'obsWatch', watching }));
    }
  }

  get connected(): boolean {
    return (
      this.socket?.readyState === WebSocket.OPEN &&
      this.state_.kind === 'live' &&
      !this.state_.reconnecting
    );
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
