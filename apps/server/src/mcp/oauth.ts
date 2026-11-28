/**
 * The OAuth 2.1 authorization server AI assistants sign in through (MCP plan, C2–C4).
 *
 * ChatGPT and Claude register themselves (RFC 7591), send the person here with PKCE, and
 * exchange the code for tokens. The person proves who they are with the church's own OIDC
 * provider, through the callback administrators already use, so the provider needs no
 * second registration. Because every assistant then signs in under this server's one client
 * at the provider, the person always confirms the connection on a consent page of ours.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Instance } from '../instance';
import { RateLimiter } from '../limits';
import type { OidcClaims, OidcClient } from '../oidc';
import type { TokenAuthMethod } from './access';
import { consentPage, messagePage, pageLanguage, type PageString } from './pages';

export const CONSENT_COOKIE = 'wq_mcp_consent';
export const SCOPE = 'worship-q';
/** Registrations from one address per hour; assistants register once per person at most. */
export const REGISTRATIONS_PER_HOUR = 20;
/** Token requests from one address per minute. */
export const TOKENS_PER_MINUTE = 60;

export interface McpOAuthConfig {
  instance: Instance;
  oidc: OidcClient;
  /** This server's public address, with no trailing slash. */
  publicUrl: string;
  /** For the rate limits; Date.now by default. */
  clock?: () => number;
}

/** The address assistants are given, which the tokens are for. */
export function resourceUrl(publicUrl: string): string {
  return `${publicUrl}/mcp`;
}

export function protectedResourceMetadataUrl(publicUrl: string): string {
  return `${publicUrl}/.well-known/oauth-protected-resource`;
}

/**
 * Whether a redirect address may be registered: `https`, or `http` back to this computer for
 * assistants that run on it (RFC 8252). No fragment, as OAuth forbids.
 */
export function acceptableRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return url.hostname !== '';
  if (url.protocol === 'http:') {
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }
  return false;
}

const RegistrationSchema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().max(200).optional(),
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_post', 'client_secret_basic'])
    .optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

type Form = Record<string, string | undefined>;

const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

function cookieValue(request: FastifyRequest, name: string): string {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export class McpOAuth {
  private readonly registrations: RateLimiter;
  private readonly tokens: RateLimiter;

  constructor(private readonly config: McpOAuthConfig) {
    this.registrations = new RateLimiter(REGISTRATIONS_PER_HOUR, 60 * 60 * 1000, config.clock);
    this.tokens = new RateLimiter(TOKENS_PER_MINUTE, 60 * 1000, config.clock);
  }

  private get access() {
    return this.config.instance.mcp;
  }

  private get resource() {
    return resourceUrl(this.config.publicUrl);
  }

  private html(reply: FastifyReply, status: number, body: string) {
    reply
      .code(status)
      .header('cache-control', 'no-store')
      .header('x-frame-options', 'DENY')
      .header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      )
      .header('referrer-policy', 'no-referrer')
      .type('text/html; charset=utf-8');
    return reply.send(body);
  }

  private message(
    request: FastifyRequest,
    reply: FastifyReply,
    status: number,
    title: PageString,
    message: PageString,
    values: Record<string, string> = {},
  ) {
    const language = pageLanguage(request.headers['accept-language']);
    return this.html(reply, status, messagePage(language, title, message, values));
  }

  /** Sends the browser back to the assistant, with the authorization's state. */
  private redirectBack(
    reply: FastifyReply,
    redirectUri: string,
    params: Record<string, string | null>,
  ) {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
      if (value !== null) url.searchParams.set(key, value);
    }
    url.searchParams.set('iss', this.config.publicUrl);
    reply.header('cache-control', 'no-store');
    return reply.redirect(url.toString(), 302);
  }

  async register(app: FastifyInstance): Promise<void> {
    const { publicUrl } = this.config;

    const resourceMetadata = () => ({
      resource: this.resource,
      authorization_servers: [publicUrl],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'Worship Q',
    });
    // Clients look for the resource's metadata at the root and under the resource's path.
    app.get('/.well-known/oauth-protected-resource', async () => resourceMetadata());
    app.get('/.well-known/oauth-protected-resource/mcp', async () => resourceMetadata());

    const serverMetadata = () => ({
      issuer: publicUrl,
      authorization_endpoint: `${publicUrl}/oauth/authorize`,
      token_endpoint: `${publicUrl}/oauth/token`,
      registration_endpoint: `${publicUrl}/oauth/register`,
      revocation_endpoint: `${publicUrl}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: [
        'none',
        'client_secret_post',
        'client_secret_basic',
      ],
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
    });
    app.get('/.well-known/oauth-authorization-server', async () => serverMetadata());

    await app.register(async (oauth) => {
      // Token requests and the consent form arrive as forms.
      oauth.addContentTypeParser(
        'application/x-www-form-urlencoded',
        { parseAs: 'string', bodyLimit: 64 * 1024 },
        (_request, body, done) => {
          done(null, Object.fromEntries(new URLSearchParams(String(body))));
        },
      );

      oauth.post('/oauth/register', async (request, reply) => {
        reply.header('cache-control', 'no-store');
        const retryAfter = this.registrations.take(request.ip);
        if (retryAfter !== null) {
          reply.header('retry-after', String(retryAfter));
          return reply.code(429).send({ error: 'too_many_requests' });
        }
        const parsed = RegistrationSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            error: 'invalid_client_metadata',
            error_description: 'redirect_uris is required: a list of addresses',
          });
        }
        const body = parsed.data;
        const bad = body.redirect_uris.find((uri) => !acceptableRedirect(uri));
        if (bad !== undefined) {
          return reply.code(400).send({
            error: 'invalid_redirect_uri',
            error_description: 'Redirect addresses must be https, or http to localhost',
          });
        }
        const grants = body.grant_types ?? ['authorization_code'];
        if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
          return reply.code(400).send({
            error: 'invalid_client_metadata',
            error_description: 'Only authorization_code and refresh_token are supported',
          });
        }
        if ((body.response_types ?? ['code']).some((t) => t !== 'code')) {
          return reply.code(400).send({
            error: 'invalid_client_metadata',
            error_description: 'Only the code response type is supported',
          });
        }
        // RFC 7591's default when a client names none.
        const authMethod: TokenAuthMethod =
          body.token_endpoint_auth_method ?? 'client_secret_basic';
        const name = (body.client_name ?? '').trim().slice(0, 100) || 'AI assistant';
        const { client, secret } = this.access.registerClient({
          name,
          redirectUris: body.redirect_uris,
          authMethod,
        });
        return reply.code(201).send({
          client_id: client.id,
          ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
          client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
          client_name: client.name,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: client.authMethod,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        });
      });

      oauth.get<{ Querystring: Form }>('/oauth/authorize', async (request, reply) => {
        const q = request.query;
        const client = this.access.getClient(String(q.client_id ?? ''));
        const redirectUri = String(q.redirect_uri ?? '');
        // Until the client and its redirect address check out, nothing is sent back to it:
        // the address could be anyone's.
        if (!client) {
          return this.message(request, reply, 400, 'badRequestTitle', 'badRequest', {
            reason: 'unknown client_id',
          });
        }
        if (!client.redirectUris.includes(redirectUri)) {
          return this.message(request, reply, 400, 'badRequestTitle', 'badRequest', {
            reason: 'redirect_uri is not one the client registered',
          });
        }
        const state = str(q.state) ?? null;
        const refuse = (error: string, description: string) =>
          this.redirectBack(reply, redirectUri, { error, error_description: description, state });
        if (q.response_type !== 'code')
          return refuse('unsupported_response_type', 'response_type must be code');
        if (!q.code_challenge || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) {
          return refuse('invalid_request', 'PKCE is required: a code_challenge with S256');
        }
        if (q.code_challenge_method !== 'S256') {
          return refuse('invalid_request', 'code_challenge_method must be S256');
        }
        const resource = str(q.resource) ?? null;
        if (resource !== null && resource.replace(/\/+$/, '') !== this.resource) {
          return refuse('invalid_target', `resource must be ${this.resource}`);
        }
        const authorizationId = this.access.startAuthorization({
          clientId: client.id,
          redirectUri,
          codeChallenge: q.code_challenge,
          clientState: state,
          resource,
        });
        try {
          const { url, state: oidcState, verifier, nonce } = await this.config.oidc.beginSignIn();
          this.config.instance.putAuthState(oidcState, verifier, nonce, '/admin/', authorizationId);
          reply.header('cache-control', 'no-store');
          return reply.redirect(url, 302);
        } catch (error) {
          request.log.error(error);
          return refuse('temporarily_unavailable', 'The sign-in provider could not be reached');
        }
      });

      oauth.post<{ Body: Form }>('/oauth/consent', async (request, reply) => {
        const body = request.body ?? {};
        const authorizationId = String(body.authorization ?? '');
        const consent = String(body.consent ?? '');
        // The form's secret must also be in this browser's cookie: only the browser that
        // signed in can answer.
        if (!consent || cookieValue(request, CONSENT_COOKIE) !== consent) {
          return this.message(request, reply, 400, 'failedTitle', 'failed');
        }
        reply.header('set-cookie', this.consentCookie(request, '', 0));
        const decided = this.access.decide(authorizationId, consent, body.decision === 'allow');
        if (!decided) return this.message(request, reply, 400, 'failedTitle', 'failed');
        const { authorization, code } = decided;
        if (!code) {
          return this.redirectBack(reply, authorization.redirectUri, {
            error: 'access_denied',
            error_description: 'The person did not allow the connection',
            state: authorization.clientState,
          });
        }
        return this.redirectBack(reply, authorization.redirectUri, {
          code,
          state: authorization.clientState,
        });
      });

      oauth.post<{ Body: Form }>('/oauth/token', async (request, reply) => {
        reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
        const retryAfter = this.tokens.take(request.ip);
        if (retryAfter !== null) {
          reply.header('retry-after', String(retryAfter));
          return reply.code(429).send({ error: 'too_many_requests' });
        }
        const body = (request.body ?? {}) as Form;
        const client = this.clientOf(request, body);
        if (!client) {
          if (request.headers.authorization?.startsWith('Basic ')) {
            reply.header('www-authenticate', 'Basic realm="worship-q"');
          }
          return reply.code(401).send({ error: 'invalid_client' });
        }
        let result;
        if (body.grant_type === 'authorization_code') {
          if (!body.code || !body.redirect_uri || !body.code_verifier) {
            return reply.code(400).send({
              error: 'invalid_request',
              error_description: 'code, redirect_uri and code_verifier are required',
            });
          }
          if (body.resource && body.resource.replace(/\/+$/, '') !== this.resource) {
            return reply.code(400).send({ error: 'invalid_target' });
          }
          result = this.access.redeemCode(body.code, client, body.redirect_uri, body.code_verifier);
        } else if (body.grant_type === 'refresh_token') {
          if (!body.refresh_token) {
            return reply
              .code(400)
              .send({ error: 'invalid_request', error_description: 'refresh_token is required' });
          }
          result = this.access.refresh(body.refresh_token, client);
        } else {
          return reply.code(400).send({ error: 'unsupported_grant_type' });
        }
        if (typeof result === 'string') return reply.code(400).send({ error: result });
        return {
          access_token: result.accessToken,
          token_type: 'Bearer',
          expires_in: result.expiresIn,
          refresh_token: result.refreshToken,
          scope: SCOPE,
        };
      });

      oauth.post<{ Body: Form }>('/oauth/revoke', async (request, reply) => {
        const body = (request.body ?? {}) as Form;
        const client = this.clientOf(request, body);
        if (!client) return reply.code(401).send({ error: 'invalid_client' });
        if (body.token) this.access.revokeToken(body.token, client);
        return reply.code(200).send();
      });
    });
  }

  /** The client a token request comes from, proven as it registered; its id, or null. */
  private clientOf(request: FastifyRequest, body: Form): string | null {
    let id = body.client_id;
    let secret = body.client_secret ?? null;
    let method: TokenAuthMethod = secret ? 'client_secret_post' : 'none';
    const header = request.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon === -1) return null;
      try {
        id = decodeURIComponent(decoded.slice(0, colon));
        secret = decodeURIComponent(decoded.slice(colon + 1));
      } catch {
        return null;
      }
      method = 'client_secret_basic';
    }
    if (!id) return null;
    const registered = this.access.getClient(id);
    if (!registered) return null;
    // A confidential client must send its secret; a public one has none to send.
    if (registered.authMethod === 'none' ? method !== 'none' && !!secret : method === 'none') {
      return null;
    }
    return this.access.authenticateClient(id, secret)?.id ?? null;
  }

  private consentCookie(request: FastifyRequest, value: string, maxAge: number): string {
    const secure = request.protocol === 'https' ? '; Secure' : '';
    return `${CONSENT_COOKIE}=${encodeURIComponent(value)}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  /**
   * The end of the provider's sign-in for an MCP authorization, from the shared callback:
   * the person must be an MCP user, and then confirms the connection.
   */
  async finishSignIn(
    request: FastifyRequest,
    reply: FastifyReply,
    pending: { verifier: string; nonce: string; mcpAuthorizationId: string },
    code: string | undefined,
    providerError: string | undefined,
  ) {
    const authorization = this.access.pendingAuthorization(pending.mcpAuthorizationId);
    if (!authorization) return this.message(request, reply, 400, 'failedTitle', 'failed');
    if (providerError || !code) {
      return this.redirectBack(reply, authorization.redirectUri, {
        error: 'access_denied',
        error_description: 'Sign-in was not completed',
        state: authorization.clientState,
      });
    }
    let claims: OidcClaims;
    try {
      claims = await this.config.oidc.finishSignIn(code, pending.verifier, pending.nonce);
    } catch (cause) {
      request.log.warn(cause instanceof Error ? cause.message : cause);
      return this.message(request, reply, 400, 'failedTitle', 'failed');
    }
    // An address the provider says is unverified proves nothing (D28).
    if (!claims.email || claims.emailVerified === false) {
      return this.message(request, reply, 403, 'failedTitle', 'noEmail');
    }
    const user = this.access.signIn(claims.email, claims.subject, claims.name);
    if (!user) {
      return this.message(request, reply, 403, 'notAllowedTitle', 'notAllowed', {
        email: claims.email,
      });
    }
    const consent = this.access.attachUser(authorization.id, user.id);
    if (!consent) return this.message(request, reply, 400, 'failedTitle', 'failed');
    const client = this.access.getClient(authorization.clientId);
    const names = new Map(this.config.instance.listWorkspaces().map((w) => [w.id, w.name]));
    reply.header('set-cookie', this.consentCookie(request, consent, 15 * 60));
    return this.html(
      reply,
      200,
      consentPage(pageLanguage(request.headers['accept-language']), {
        client: client?.name ?? 'AI assistant',
        email: user.email,
        redirectHost: new URL(authorization.redirectUri).host,
        allWorkspaces: user.allWorkspaces,
        workspaces: user.workspaceIds.map((id) => names.get(id)).filter((n): n is string => !!n),
        authorizationId: authorization.id,
        consent,
      }),
    );
  }

  /** A sign-in for an MCP authorization arrived, but sign-in is not configured any more. */
  static notConfigured(request: FastifyRequest, reply: FastifyReply) {
    const language = pageLanguage(request.headers['accept-language']);
    return reply
      .code(503)
      .type('text/html; charset=utf-8')
      .send(messagePage(language, 'notConfiguredTitle', 'notConfigured'));
  }
}
