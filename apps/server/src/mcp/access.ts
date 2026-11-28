/**
 * Who may connect an AI assistant to the server, and the OAuth state that lets them (MCP
 * plan, C1–C4): MCP users and the workspaces they reach, the assistants registered as OAuth
 * clients, authorizations under way, and the tokens issued. Only hashes of secrets are kept.
 *
 * MCP users are not administrators, and administrators are not MCP users: the two lists are
 * separate, so being one grants nothing as the other.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { transaction, type Database, type SqlValue } from '../db';

/** An access token lives this long; the assistant then uses its refresh token. */
export const ACCESS_TTL_MS = 60 * 60 * 1000;
/** A refresh token lives this long unused; each use replaces it. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A code must be exchanged this soon after it was issued. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** An authorization must reach the person's consent this soon after the assistant asked. */
export const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;
/** A registered client unused for this long is forgotten; it registers again when needed. */
export const CLIENT_IDLE_MS = 90 * 24 * 60 * 60 * 1000;
/** Registered clients kept at most, so an anonymous registration endpoint cannot fill the disk. */
export const MAX_CLIENTS = 500;

export interface McpUserRow {
  id: string;
  email: string;
  subject: string | null;
  name: string | null;
  allWorkspaces: boolean;
  workspaceIds: string[];
  addedBy: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  lastUsedAt: string | null;
  removedAt: string | null;
}

export interface McpUserAccess {
  allWorkspaces: boolean;
  workspaceIds: readonly string[];
}

export type TokenAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

export interface OAuthClientRow {
  id: string;
  name: string;
  redirectUris: string[];
  authMethod: TokenAuthMethod;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuthorizationRow {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  clientState: string | null;
  resource: string | null;
  mcpUserId: string | null;
  createdAt: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type AccessErrorCode = 'invalid-email' | 'already-added' | 'unknown-workspace';

export class AccessError extends Error {
  constructor(
    readonly code: AccessErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Why a code exchange was refused, as OAuth names it. */
export type GrantError = 'invalid_grant' | 'invalid_client';

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const text = (value: SqlValue | undefined) => (value == null ? '' : String(value));
const optional = (value: SqlValue | undefined) => (value == null ? null : String(value));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** RFC 7636: 43 to 128 characters of the unreserved set. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Whether a PKCE verifier matches its S256 challenge. */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false;
  const expected = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export class McpAccess {
  constructor(
    private readonly db: Database,
    private readonly now: () => string,
  ) {}

  private later(ms: number): string {
    return new Date(Date.parse(this.now()) + ms).toISOString();
  }

  private earlier(ms: number): string {
    return new Date(Date.parse(this.now()) - ms).toISOString();
  }

  // ── MCP users ────────────────────────────────────────────────────────────

  listUsers(): McpUserRow[] {
    return this.db
      .prepare('SELECT * FROM mcp_user WHERE removed_at IS NULL ORDER BY created_at')
      .all()
      .map((row) => this.toUser(row));
  }

  /** The user, removed or not. */
  getUser(id: string): McpUserRow | null {
    const row = this.db.prepare('SELECT * FROM mcp_user WHERE id = ?').get(id);
    return row ? this.toUser(row) : null;
  }

  /** The user an e-mail address names, unless removed. */
  findUser(email: string): McpUserRow | null {
    const row = this.db
      .prepare('SELECT * FROM mcp_user WHERE email = ? AND removed_at IS NULL')
      .get(normalizeEmail(email));
    return row ? this.toUser(row) : null;
  }

  /** Adds someone who may connect an assistant. `addedBy` is an administrator, or null. */
  addUser(email: string, access: McpUserAccess, addedBy: string | null): McpUserRow {
    const normalized = normalizeEmail(email);
    if (!EMAIL.test(normalized))
      throw new AccessError('invalid-email', `Not an e-mail address: ${email}`);
    return transaction(this.db, () => {
      if (this.findUser(normalized)) {
        throw new AccessError('already-added', `${normalized} is already an MCP user`);
      }
      const id = randomUUID();
      this.db
        .prepare(
          'INSERT INTO mcp_user (id, email, all_workspaces, added_by, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, normalized, access.allWorkspaces ? 1 : 0, addedBy, this.now());
      this.writeWorkspaces(id, access);
      return this.getUser(id)!;
    });
  }

  /** Changes which workspaces a user reaches; it applies to their very next request. */
  updateUser(id: string, access: McpUserAccess): McpUserRow | null {
    return transaction(this.db, () => {
      const user = this.getUser(id);
      if (!user || user.removedAt) return null;
      this.db
        .prepare('UPDATE mcp_user SET all_workspaces = ? WHERE id = ?')
        .run(access.allWorkspaces ? 1 : 0, id);
      this.writeWorkspaces(id, access);
      return this.getUser(id)!;
    });
  }

  private writeWorkspaces(id: string, access: McpUserAccess): void {
    const ids = [...new Set(access.workspaceIds)];
    const exists = this.db.prepare('SELECT 1 FROM workspace WHERE id = ?');
    for (const workspaceId of ids) {
      if (!exists.get(workspaceId)) {
        throw new AccessError('unknown-workspace', `No workspace ${workspaceId}`);
      }
    }
    this.db.prepare('DELETE FROM mcp_user_workspace WHERE user_id = ?').run(id);
    // “All workspaces” keeps no list, so turning it off starts from none.
    if (access.allWorkspaces) return;
    const insert = this.db.prepare(
      'INSERT INTO mcp_user_workspace (user_id, workspace_id) VALUES (?, ?)',
    );
    for (const workspaceId of ids) insert.run(id, workspaceId);
  }

  /** Removes a user and signs out every assistant they connected. */
  removeUser(id: string): boolean {
    return transaction(this.db, () => {
      const result = this.db
        .prepare('UPDATE mcp_user SET removed_at = ? WHERE id = ? AND removed_at IS NULL')
        .run(this.now(), id);
      if (Number(result.changes) === 0) return false;
      this.db.prepare('DELETE FROM mcp_user_workspace WHERE user_id = ?').run(id);
      this.revokeUserTokens(id);
      return true;
    });
  }

  /**
   * Signs a user in after the provider vouched for the address: binds the provider's subject
   * on the first sign-in. Null when the address is not an MCP user's, or the subject differs
   * from the one bound before.
   */
  signIn(email: string, subject: string, name: string | null): McpUserRow | null {
    const user = this.findUser(email);
    if (!user) return null;
    if (user.subject && user.subject !== subject) return null;
    this.db
      .prepare('UPDATE mcp_user SET subject = ?, name = ?, last_sign_in_at = ? WHERE id = ?')
      .run(subject, name ?? user.name, this.now(), user.id);
    return this.getUser(user.id)!;
  }

  /** Assistants signed in for the user now: token families with a live refresh token. */
  connections(userId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT family_id) AS n FROM mcp_token
         WHERE mcp_user_id = ? AND kind = 'refresh' AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(userId, this.now());
    return Number(row?.n ?? 0);
  }

  /** Signs out every assistant the user connected. Returns how many tokens ended. */
  revokeUserTokens(userId: string): number {
    const result = this.db
      .prepare('UPDATE mcp_token SET revoked_at = ? WHERE mcp_user_id = ? AND revoked_at IS NULL')
      .run(this.now(), userId);
    return Number(result.changes);
  }

  private toUser(row: Record<string, SqlValue>): McpUserRow {
    const id = text(row.id);
    return {
      id,
      email: text(row.email),
      subject: optional(row.subject),
      name: optional(row.name),
      allWorkspaces: Number(row.all_workspaces) === 1,
      workspaceIds: this.db
        .prepare(
          'SELECT workspace_id FROM mcp_user_workspace WHERE user_id = ? ORDER BY workspace_id',
        )
        .all(id)
        .map((r) => text(r.workspace_id)),
      addedBy: optional(row.added_by),
      createdAt: text(row.created_at),
      lastSignInAt: optional(row.last_sign_in_at),
      lastUsedAt: optional(row.last_used_at),
      removedAt: optional(row.removed_at),
    };
  }

  // ── OAuth clients (dynamic registration, RFC 7591) ───────────────────────

  registerClient(input: { name: string; redirectUris: string[]; authMethod: TokenAuthMethod }): {
    client: OAuthClientRow;
    secret: string | null;
  } {
    return transaction(this.db, () => {
      this.db
        .prepare('DELETE FROM oauth_client WHERE coalesce(last_used_at, created_at) < ?')
        .run(this.earlier(CLIENT_IDLE_MS));
      const count = Number(this.db.prepare('SELECT COUNT(*) AS n FROM oauth_client').get()?.n);
      if (count >= MAX_CLIENTS) {
        // The longest unused goes first.
        this.db
          .prepare(
            `DELETE FROM oauth_client WHERE id IN (SELECT id FROM oauth_client
             ORDER BY coalesce(last_used_at, created_at) LIMIT ?)`,
          )
          .run(count - MAX_CLIENTS + 1);
      }
      const id = randomUUID();
      const clientSecret = input.authMethod === 'none' ? null : secret();
      this.db
        .prepare(
          `INSERT INTO oauth_client (id, secret_hash, name, redirect_uris, auth_method, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          clientSecret ? hash(clientSecret) : null,
          input.name,
          JSON.stringify(input.redirectUris),
          input.authMethod,
          this.now(),
        );
      return { client: this.getClient(id)!, secret: clientSecret };
    });
  }

  getClient(id: string): OAuthClientRow | null {
    const row = this.db.prepare('SELECT * FROM oauth_client WHERE id = ?').get(id);
    if (!row) return null;
    let redirectUris: string[] = [];
    try {
      const parsed: unknown = JSON.parse(text(row.redirect_uris));
      if (Array.isArray(parsed)) redirectUris = parsed.filter((u) => typeof u === 'string');
    } catch {
      // A row that does not parse has no redirect addresses, so nothing is sent anywhere.
    }
    return {
      id: text(row.id),
      name: text(row.name),
      redirectUris,
      authMethod: text(row.auth_method) as TokenAuthMethod,
      createdAt: text(row.created_at),
      lastUsedAt: optional(row.last_used_at),
    };
  }

  /** The client, when it proves itself as it registered to: by secret, or as a public one. */
  authenticateClient(id: string, clientSecret: string | null): OAuthClientRow | null {
    const row = this.db.prepare('SELECT secret_hash FROM oauth_client WHERE id = ?').get(id);
    if (!row) return null;
    const stored = optional(row.secret_hash);
    if (stored) {
      if (!clientSecret) return null;
      const a = Buffer.from(stored);
      const b = Buffer.from(hash(clientSecret));
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    }
    this.db.prepare('UPDATE oauth_client SET last_used_at = ? WHERE id = ?').run(this.now(), id);
    return this.getClient(id);
  }

  // ── Authorizations ───────────────────────────────────────────────────────

  startAuthorization(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    clientState: string | null;
    resource: string | null;
  }): string {
    this.db
      .prepare('DELETE FROM mcp_authorization WHERE created_at < ?')
      .run(this.earlier(AUTHORIZATION_TTL_MS + CODE_TTL_MS));
    const id = secret();
    this.db
      .prepare(
        `INSERT INTO mcp_authorization (id, client_id, redirect_uri, code_challenge, client_state,
           resource, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.clientId,
        input.redirectUri,
        input.codeChallenge,
        input.clientState,
        input.resource,
        this.now(),
      );
    return id;
  }

  /** An authorization still waiting for consent; null when unknown, used or too old. */
  pendingAuthorization(id: string): AuthorizationRow | null {
    const row = this.db
      .prepare(
        'SELECT * FROM mcp_authorization WHERE id = ? AND code_hash IS NULL AND used_at IS NULL',
      )
      .get(id);
    if (!row || text(row.created_at) < this.earlier(AUTHORIZATION_TTL_MS)) return null;
    return toAuthorization(row);
  }

  /**
   * Records who signed in for an authorization, and returns the secret the consent form must
   * send back, so only the browser that signed in can approve it.
   */
  attachUser(id: string, userId: string): string | null {
    if (!this.pendingAuthorization(id)) return null;
    const consent = secret();
    this.db
      .prepare('UPDATE mcp_authorization SET mcp_user_id = ?, consent_hash = ? WHERE id = ?')
      .run(userId, hash(consent), id);
    return consent;
  }

  /**
   * The person's answer. Approved, the authorization gets a code for the client to exchange;
   * refused, it ends. Null when the consent secret does not match or the user lost access.
   */
  decide(
    id: string,
    consent: string,
    approve: boolean,
  ): { authorization: AuthorizationRow; code: string | null } | null {
    return transaction(this.db, () => {
      const authorization = this.pendingAuthorization(id);
      if (!authorization?.mcpUserId) return null;
      const row = this.db
        .prepare('SELECT consent_hash FROM mcp_authorization WHERE id = ?')
        .get(id);
      const stored = Buffer.from(text(row?.consent_hash));
      const given = Buffer.from(hash(consent));
      if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;
      const user = this.getUser(authorization.mcpUserId);
      if (!approve || !user || user.removedAt) {
        this.db
          .prepare('UPDATE mcp_authorization SET used_at = ? WHERE id = ?')
          .run(this.now(), id);
        return { authorization, code: null };
      }
      const code = secret();
      this.db
        .prepare('UPDATE mcp_authorization SET code_hash = ?, code_expires_at = ? WHERE id = ?')
        .run(hash(code), this.later(CODE_TTL_MS), id);
      return { authorization, code };
    });
  }

  /**
   * Exchanges a code for tokens, once. The client, the redirect address and the PKCE
   * verifier must all match the authorization's. A code used twice ends the tokens it gave.
   */
  redeemCode(
    code: string,
    clientId: string,
    redirectUri: string,
    verifier: string,
  ): IssuedTokens | GrantError {
    return transaction(this.db, () => {
      const row = this.db
        .prepare('SELECT * FROM mcp_authorization WHERE code_hash = ?')
        .get(hash(code));
      if (!row) return 'invalid_grant';
      const id = text(row.id);
      if (row.used_at != null) {
        // A replayed code: whoever has it may be an attacker, so the tokens it gave end.
        this.db
          .prepare('UPDATE mcp_token SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
          .run(this.now(), id);
        return 'invalid_grant';
      }
      if (text(row.client_id) !== clientId) return 'invalid_grant';
      if (text(row.redirect_uri) !== redirectUri) return 'invalid_grant';
      if (text(row.code_expires_at) < this.now()) return 'invalid_grant';
      if (!verifierMatches(verifier, text(row.code_challenge))) return 'invalid_grant';
      const user = this.getUser(text(row.mcp_user_id));
      if (!user || user.removedAt) return 'invalid_grant';
      this.db.prepare('UPDATE mcp_authorization SET used_at = ? WHERE id = ?').run(this.now(), id);
      // The authorization's identifier names the token family, so a replay can end it.
      return this.issue(user.id, clientId, id);
    });
  }

  private issue(userId: string, clientId: string, familyId: string): IssuedTokens {
    const now = this.now();
    this.db.prepare('DELETE FROM mcp_token WHERE expires_at < ?').run(this.earlier(REFRESH_TTL_MS));
    const accessToken = secret();
    const refreshToken = secret();
    const insert = this.db.prepare(
      `INSERT INTO mcp_token (token_hash, kind, family_id, client_id, mcp_user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      hash(accessToken),
      'access',
      familyId,
      clientId,
      userId,
      this.later(ACCESS_TTL_MS),
      now,
    );
    insert.run(
      hash(refreshToken),
      'refresh',
      familyId,
      clientId,
      userId,
      this.later(REFRESH_TTL_MS),
      now,
    );
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000 };
  }

  /**
   * Replaces a refresh token with new tokens. A refresh token used a second time means it
   * was copied: every token of its family ends, and the person signs in again.
   */
  refresh(refreshToken: string, clientId: string): IssuedTokens | GrantError {
    return transaction(this.db, () => {
      const row = this.db
        .prepare(`SELECT * FROM mcp_token WHERE token_hash = ? AND kind = 'refresh'`)
        .get(hash(refreshToken));
      if (!row) return 'invalid_grant';
      const family = text(row.family_id);
      if (row.revoked_at != null) {
        this.db
          .prepare('UPDATE mcp_token SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
          .run(this.now(), family);
        return 'invalid_grant';
      }
      if (text(row.client_id) !== clientId) return 'invalid_grant';
      if (text(row.expires_at) < this.now()) return 'invalid_grant';
      const user = this.getUser(text(row.mcp_user_id));
      if (!user || user.removedAt) return 'invalid_grant';
      this.db
        .prepare('UPDATE mcp_token SET revoked_at = ? WHERE token_hash = ?')
        .run(this.now(), hash(refreshToken));
      return this.issue(user.id, clientId, family);
    });
  }

  /** Ends a token (RFC 7009); a refresh token ends its whole family. Unknown ones are ignored. */
  revokeToken(token: string, clientId: string): void {
    const row = this.db.prepare('SELECT * FROM mcp_token WHERE token_hash = ?').get(hash(token));
    if (!row || text(row.client_id) !== clientId) return;
    if (text(row.kind) === 'refresh') {
      this.db
        .prepare('UPDATE mcp_token SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
        .run(this.now(), text(row.family_id));
    } else {
      this.db
        .prepare('UPDATE mcp_token SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .run(this.now(), hash(token));
    }
  }

  /** The user an access token belongs to, while it is live and the user not removed. */
  authenticate(accessToken: string): McpUserRow | null {
    if (!accessToken) return null;
    const row = this.db
      .prepare(
        `SELECT u.id FROM mcp_token t JOIN mcp_user u ON u.id = t.mcp_user_id
         WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked_at IS NULL
           AND t.expires_at > ? AND u.removed_at IS NULL`,
      )
      .get(hash(accessToken), this.now());
    if (!row) return null;
    const id = text(row.id);
    this.db.prepare('UPDATE mcp_user SET last_used_at = ? WHERE id = ?').run(this.now(), id);
    return this.getUser(id);
  }
}

function toAuthorization(row: Record<string, SqlValue>): AuthorizationRow {
  return {
    id: text(row.id),
    clientId: text(row.client_id),
    redirectUri: text(row.redirect_uri),
    codeChallenge: text(row.code_challenge),
    clientState: optional(row.client_state),
    resource: optional(row.resource),
    mcpUserId: optional(row.mcp_user_id),
    createdAt: text(row.created_at),
  };
}
