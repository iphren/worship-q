/**
 * Remote control, on the coordinator: approves phones and other browsers, gives them the
 * live presentation to navigate, and applies their commands.
 *
 * Scanning an invitation requests access; it never grants control by itself. An operator
 * approves each request after checking that the code on the phone matches the one shown
 * here. An approval gives the phone a grant it uses to reconnect, until an operator
 * disconnects it. Remote controllers navigate the live run sheet and add, remove and
 * reorder its items, finding songs with the operator's search. They cannot edit songs, go
 * live with another date, or change settings. Each edit is shown to the operator here, with
 * a way to undo it.
 */
import {
  isCompatibleProtocol,
  isRemoteEdit,
  RemoteToHostSchema,
  type HostToRemote,
  type RemoteSongResult,
  type RemoteView,
  type Song,
} from '@worship-q/protocol';
import type { RunSheetChange, Session } from '@worship-q/session';

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

/** A remote controller's run-sheet edit, shown to the operator until dismissed or expired. */
export interface RemoteNotice {
  id: string;
  /** The controller's name. */
  name: string;
  change: RunSheetChange;
  at: number;
}

/** How long an invitation in a QR code or link stays valid. */
export const INVITE_MS = 15 * 60 * 1000;
/** A request not answered in this time is dropped. */
const REQUEST_MS = 5 * 60 * 1000;
/** Bursts of changes are sent to phones together. */
const VIEW_DELAY_MS = 80;
/** How long the operator is shown a remote edit, and can undo it from the notice. */
export const NOTICE_MS = 20_000;
/** Songs sent for one search; the phone asks for more by typing more. */
const SEARCH_LIMIT = 50;
const PREVIEW_LINES = 4;

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
      kind: entry.song.website ? 'website' : entry.song.deck ? 'deck' : 'lyrics',
      pieces: entry.pieces.map((piece) => ({
        id: piece.id,
        thumbnail: entry.song.deck?.pages.find((page) => page.image === piece.image)?.thumbnail,
        ...(piece.image && piece.lines.length === 0 ? { textless: true } : {}),
        lines:
          piece.lines.length > 0 || !piece.image
            ? piece.lines.map((line) => line.text)
            : // An imported slide without text, such as a photo, is named by its place.
              [
                `Slide ${piece.blockIndex + 1}` +
                  (piece.indexInBlock > 0 ? ` · ${piece.indexInBlock + 1}` : ''),
              ],
        block: piece.blockIndex,
      })),
    })),
    presented:
      session.isLive && live?.presented && !previous
        ? { itemId: live.presented.itemId, pieceId: live.presented.pieceId }
        : null,
    previousContent: previous,
    blank: session.isLive && (live?.blank ?? false),
    editable: session.isLive,
  };
}

/** A song as a remote controller's search shows it. */
export function remoteSongResult(song: Song): RemoteSongResult {
  const preview = song.website
    ? [song.website.url]
    : song.deck
      ? (song.deck.pages.find((page) => page.text.length > 0)?.text ?? [])
      : song.lyrics.split('\n').filter((line) => line.trim() !== '');
  return {
    id: song.id,
    title: song.title,
    kind: song.website ? 'website' : song.deck ? 'deck' : 'lyrics',
    preview: preview.slice(0, PREVIEW_LINES),
  };
}

export class RemoteHost {
  private link: RemoteLink | null = null;
  private invites: { secret: string; at: number }[] = [];
  private readonly requests = new Map<string, RemoteRequest>();
  private readonly controllers = new Map<string, RemoteController>();
  private notices_: RemoteNotice[] = [];
  private readonly noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

  /** Remote edits to show the operator, oldest first. */
  get notices(): RemoteNotice[] {
    return this.notices_;
  }

  private notify(name: string, change: RunSheetChange): void {
    const notice: RemoteNotice = { id: randomToken(9), name, change, at: this.clock() };
    this.notices_ = [...this.notices_, notice];
    this.noticeTimers.set(
      notice.id,
      setTimeout(() => this.dismiss(notice.id), NOTICE_MS),
    );
    this.changed();
  }

  dismiss(id: string): void {
    clearTimeout(this.noticeTimers.get(id));
    this.noticeTimers.delete(id);
    const before = this.notices_.length;
    this.notices_ = this.notices_.filter((notice) => notice.id !== id);
    if (this.notices_.length !== before) this.changed();
  }

  /** Undoes the edit a notice reports. False when it can no longer be undone. */
  async undo(id: string): Promise<boolean> {
    const notice = this.notices_.find((candidate) => candidate.id === id);
    if (!notice) return false;
    this.dismiss(id);
    return this.session.undoRemoteEdit(notice.change);
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
    for (const timer of this.noticeTimers.values()) clearTimeout(timer);
    this.noticeTimers.clear();
    this.notices_ = [];
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

    // Pings are answered by the relay and never reach the coordinator.
    const controller = this.controllers.get(from);
    if (!controller) return;
    if (message.type === 'search') {
      const query = message.query.trim();
      const songs = query
        ? (await this.session.store.listSongs(this.session.workspace.id, query)).slice(
            0,
            SEARCH_LIMIT,
          )
        : [];
      return link.send(from, {
        type: 'searchResults',
        id: message.id,
        songs: songs.map(remoteSongResult),
      });
    }
    if (message.type !== 'command') return;
    const { command } = message;
    let applied: boolean;
    if (isRemoteEdit(command)) {
      const change = await this.session.remoteEdit(message.id, command);
      if (change) this.notify(controller.name, change);
      applied = change !== null;
    } else {
      applied = await this.session.remoteCommand(message.id, command);
    }
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
