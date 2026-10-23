/**
 * Remote control, on the coordinator: approves phones and other browsers, gives them the
 * live presentation to navigate, and applies their commands.
 *
 * Scanning an invitation requests access; it never grants control by itself. An operator
 * approves each request after checking that the code on the phone matches the one shown
 * here. An approval gives the phone a grant it uses to reconnect, until an operator
 * disconnects it. Remote controllers can only navigate the live run sheet: they cannot
 * edit, go live with another date, or change settings.
 */
import {
  isCompatibleProtocol,
  RemoteToHostSchema,
  type HostToRemote,
  type RemoteView,
} from '@worship-q/protocol';
import type { Session } from '@worship-q/session';

/** How the host reaches remote connections: through the instance relay. */
export interface RemoteLink {
  /** Sends to one connection, or to every connection when `to` is omitted. */
  send(to: string | undefined, message: HostToRemote): void;
  drop(to: string): void;
}

export interface RemoteRequest {
  connection: string;
  name: string;
  /** Shown on both screens, so the operator approves the phone they can see. */
  code: string;
  at: number;
}

export interface RemoteController {
  connection: string;
  grantId: string;
  name: string;
}

/** How long an invitation in a QR code or link stays valid. */
export const INVITE_MS = 15 * 60 * 1000;
/** A request not answered in this time is dropped. */
const REQUEST_MS = 5 * 60 * 1000;
/** Bursts of changes are sent to phones together. */
const VIEW_DELAY_MS = 80;

function randomToken(bytes = 18): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 10000).padStart(4, '0');
}

/** The live presentation as a remote controller sees it. */
export async function buildRemoteView(
  session: Session,
  workspaceName: string,
): Promise<RemoteView> {
  const live = session.live;
  const view = await session.viewLive();
  const previous = session.presentingPreviousContent;
  return {
    workspaceName,
    status: session.isLive ? 'live' : 'ended',
    date: session.liveDate,
    items: (view?.entries ?? []).map((entry) => ({
      itemId: entry.item.id,
      title: entry.song.title,
      removed: entry.song.removedAt !== null,
      pieces: entry.pieces.map((piece) => ({
        id: piece.id,
        lines: piece.lines.map((line) => line.text),
      })),
    })),
    presented:
      session.isLive && live?.presented && !previous
        ? { itemId: live.presented.itemId, pieceId: live.presented.pieceId }
        : null,
    previousContent: previous,
    blank: session.isLive && (live?.blank ?? false),
  };
}

export class RemoteHost {
  private link: RemoteLink | null = null;
  private invites: { secret: string; at: number }[] = [];
  private readonly requests = new Map<string, RemoteRequest>();
  private readonly controllers = new Map<string, RemoteController>();
  private readonly listeners = new Set<() => void>();
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private version_ = 0;

  constructor(
    private readonly session: Session,
    private readonly workspaceName: () => string,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Increases whenever requests or controllers change. */
  get version(): number {
    return this.version_;
  }

  get pending(): RemoteRequest[] {
    this.expireRequests();
    return [...this.requests.values()];
  }

  get connected(): RemoteController[] {
    return [...this.controllers.values()];
  }

  /** True while the instance relay is connected and this device receives phones. */
  get available(): boolean {
    return this.link !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.version_++;
    for (const listener of [...this.listeners]) listener();
  }

  /** Starts receiving phones through the relay. */
  attach(link: RemoteLink): void {
    this.link = link;
    this.unsubscribe ??= this.session.subscribe(() => this.scheduleView());
    this.changed();
  }

  /** The relay went away; phones reconnect with their grants when it is back. */
  detach(): void {
    this.link = null;
    this.requests.clear();
    this.controllers.clear();
    this.changed();
  }

  dispose(): void {
    this.detach();
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.viewTimer) clearTimeout(this.viewTimer);
  }

  /** The invitation to put in a QR code or link; a new one is made as each expires. */
  invite(): string {
    const now = this.clock();
    this.invites = this.invites.filter((invite) => now - invite.at < INVITE_MS);
    const latest = this.invites[this.invites.length - 1];
    // A fresh invitation before the last one runs out, so a scan never just misses.
    if (!latest || now - latest.at > INVITE_MS / 2) {
      this.invites.push({ secret: randomToken(), at: now });
    }
    return this.invites[this.invites.length - 1]!.secret;
  }

  private validInvite(secret: string): boolean {
    const now = this.clock();
    return this.invites.some((invite) => invite.secret === secret && now - invite.at < INVITE_MS);
  }

  private expireRequests(): void {
    const now = this.clock();
    for (const [connection, request] of this.requests) {
      if (now - request.at > REQUEST_MS) {
        this.requests.delete(connection);
        this.link?.drop(connection);
      }
    }
  }

  // ── From the relay ───────────────────────────────────────────────────────

  async message(from: string, data: unknown): Promise<void> {
    const parsed = RemoteToHostSchema.safeParse(data);
    if (!parsed.success || !this.link) return;
    const message = parsed.data;
    const link = this.link;

    if (message.type === 'hello') {
      if (!isCompatibleProtocol(message.protocolVersion)) {
        return link.send(from, { type: 'update-needed' });
      }
      const name = message.name.trim().slice(0, 40) || 'Phone';
      if (message.grant) {
        const [grantId = '', secret = ''] = message.grant.split('.');
        const grant = await this.session.store.useRemoteGrant(this.session.workspace.id, grantId);
        if (grant && grant.secretHash === (await sha256(secret))) {
          this.controllers.set(from, { connection: from, grantId, name: grant.name });
          this.changed();
          link.send(from, { type: 'approved', grant: message.grant });
          link.send(from, { type: 'view', view: await this.view() });
          return;
        }
        if (!message.invite) return link.send(from, { type: 'denied', reason: 'revoked' });
      }
      if (message.invite && this.validInvite(message.invite)) {
        const request: RemoteRequest = {
          connection: from,
          name,
          code: randomCode(),
          at: this.clock(),
        };
        this.requests.set(from, request);
        this.changed();
        return link.send(from, { type: 'pending', code: request.code });
      }
      return link.send(from, { type: 'denied', reason: 'invalid-invite' });
    }

    if (!this.controllers.has(from)) return;
    const applied = await this.session.remoteCommand(message.id, message.command);
    link.send(from, { type: 'ack', id: message.id, applied });
  }

  left(from: string): void {
    const had = this.requests.delete(from) || this.controllers.delete(from);
    if (had) this.changed();
  }

  // ── Operator decisions ───────────────────────────────────────────────────

  async approve(connection: string): Promise<void> {
    const request = this.requests.get(connection);
    if (!request || !this.link) return;
    this.requests.delete(connection);
    const grantId = randomToken(9);
    const secret = randomToken();
    await this.session.store.addRemoteGrant(this.session.workspace.id, {
      id: grantId,
      secretHash: await sha256(secret),
      name: request.name,
    });
    this.controllers.set(connection, { connection, grantId, name: request.name });
    this.changed();
    this.link.send(connection, { type: 'approved', grant: `${grantId}.${secret}` });
    this.link.send(connection, { type: 'view', view: await this.view() });
  }

  deny(connection: string): void {
    if (!this.requests.delete(connection)) return;
    this.link?.send(connection, { type: 'denied', reason: 'denied' });
    this.link?.drop(connection);
    this.changed();
  }

  /** Ends one controller's access; it needs a new approval to come back. */
  async disconnect(connection: string): Promise<void> {
    const controller = this.controllers.get(connection);
    if (!controller) return;
    await this.session.store.revokeRemoteGrants(this.session.workspace.id, controller.grantId);
    this.controllers.delete(connection);
    this.link?.send(connection, { type: 'denied', reason: 'revoked' });
    this.link?.drop(connection);
    this.changed();
  }

  /** Ends every remote controller's access, also of phones not connected right now. */
  async disconnectAll(): Promise<void> {
    await this.session.store.revokeRemoteGrants(this.session.workspace.id);
    for (const connection of this.controllers.keys()) {
      this.link?.send(connection, { type: 'denied', reason: 'revoked' });
      this.link?.drop(connection);
    }
    this.controllers.clear();
    this.changed();
  }

  // ── The view sent to controllers ─────────────────────────────────────────

  private view(): Promise<RemoteView> {
    return buildRemoteView(this.session, this.workspaceName());
  }

  private scheduleView(): void {
    if (!this.link || this.controllers.size === 0 || this.viewTimer) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      void this.sendView();
    }, VIEW_DELAY_MS);
  }

  private async sendView(): Promise<void> {
    if (!this.link || this.controllers.size === 0) return;
    const view = await this.view();
    for (const connection of this.controllers.keys()) {
      this.link?.send(connection, { type: 'view', view });
    }
  }
}
