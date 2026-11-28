/**
 * AI assistants connecting (MCP plan, C2–C5), through the server as they would reach it:
 * registering, the authorization through the church's sign-in and the consent page, the
 * token exchange and refresh, and the MCP endpoint itself.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_HEADER } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../app';
import { openDatabase } from '../db';
import { Instance } from '../instance';
import { DEFAULT_PUBLIC } from '../public';
import { OidcClient } from '../oidc';
import { fakeIssuer } from '../oidc.test';
import { ACCESS_TTL_MS, CODE_TTL_MS, REFRESH_TTL_MS } from './access';
import { CONSENT_COOKIE, REGISTRATIONS_PER_HOUR } from './oauth';

const PUBLIC = 'https://worship.example.org';
const REDIRECT = 'https://assistant.example.com/callback';

function clock(start = '2026-11-28T09:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now).toISOString(), advance: (ms: number) => (now += ms) };
}

const form = (values: Record<string, string>) => ({
  'content-type': 'application/x-www-form-urlencoded',
  payload: new URLSearchParams(values).toString(),
});

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function setup(
  options: {
    oidc?: boolean;
    public?: boolean;
    mcp?: boolean;
    issuer?: Parameters<typeof fakeIssuer>[0];
  } = {},
) {
  const time = clock();
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const north = instance.createWorkspace('North').workspace;
  const south = instance.createWorkspace('South').workspace;
  const { fetchImpl, issuer } = fakeIssuer(options.issuer);
  const oidc =
    options.oidc === false
      ? null
      : new OidcClient({ issuer, clientId: 'worship-q', publicUrl: PUBLIC }, fetchImpl);
  const { app } = await buildServer({
    instance,
    dataDir: mkdtempSync(join(tmpdir(), 'worship-q-mcp-')),
    name: 'Test Church',
    oidc,
    sweep: false,
    mcp: options.mcp,
    public: options.public ? DEFAULT_PUBLIC : null,
  });

  const register = async (body: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: {
        redirect_uris: [REDIRECT],
        client_name: 'Test Assistant',
        token_endpoint_auth_method: 'none',
        ...body,
      },
    });

  const authorizeUrl = (clientId: string, challenge: string, extra: Record<string, string> = {}) =>
    `/oauth/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'client-state',
      resource: `${PUBLIC}/mcp`,
      ...extra,
    })}`;

  /** Goes from the assistant's authorize request through the provider to the consent page. */
  async function toConsent(email: string, clientId: string, challenge: string) {
    const start = await app.inject({ method: 'GET', url: authorizeUrl(clientId, challenge) });
    expect(start.statusCode).toBe(302);
    const provider = new URL(start.headers.location as string);
    const nonce = provider.searchParams.get('nonce')!;
    const state = provider.searchParams.get('state')!;
    const page = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=${encodeURIComponent(`${email}:${nonce}`)}&state=${state}`,
    });
    const cookie = String(page.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const authorization = /name="authorization" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
    const consent = /name="consent" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
    return { page, cookie, authorization, consent };
  }

  async function decide(
    step: { cookie: string; authorization: string; consent: string },
    decision: 'allow' | 'deny',
  ) {
    const { payload, ...headers } = form({
      authorization: step.authorization,
      consent: step.consent,
      decision,
    });
    return app.inject({
      method: 'POST',
      url: '/oauth/consent',
      headers: { ...headers, cookie: step.cookie },
      payload,
    });
  }

  async function exchange(values: Record<string, string>, headers: Record<string, string> = {}) {
    const { payload, ...type } = form(values);
    return app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { ...type, ...headers },
      payload,
    });
  }

  /** The whole connection, to tokens. */
  async function connect(email = 'sam@example.org') {
    const client = (await register()).json() as { client_id: string };
    const { verifier, challenge } = pkcePair();
    const step = await toConsent(email, client.client_id, challenge);
    const allowed = await decide(step, 'allow');
    const back = new URL(allowed.headers.location as string);
    const tokens = await exchange({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: verifier,
    });
    return { client, tokens: tokens.json() as { access_token: string; refresh_token: string } };
  }

  let rpcId = 0;
  async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      payload: { jsonrpc: '2.0', id: ++rpcId, method, params },
    });
  }

  async function call(token: string, name: string, args: Record<string, unknown> = {}) {
    const response = await rpc(token, 'tools/call', { name, arguments: args });
    expect(response.statusCode).toBe(200);
    const result = response.json().result as { isError?: boolean; content: { text: string }[] };
    return { isError: result.isError ?? false, text: result.content[0]!.text };
  }

  return {
    app,
    instance,
    time,
    north,
    south,
    register,
    authorizeUrl,
    toConsent,
    decide,
    exchange,
    connect,
    rpc,
    call,
  };
}

describe('discovery', () => {
  it('describes the resource and the authorization server', async () => {
    const { app } = await setup();
    const resource = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });
    expect(resource.json()).toMatchObject({
      resource: `${PUBLIC}/mcp`,
      authorization_servers: [PUBLIC],
    });
    const nested = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource/mcp',
    });
    expect(nested.json()).toEqual(resource.json());
    const server = (
      await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })
    ).json();
    expect(server).toMatchObject({
      issuer: PUBLIC,
      authorization_endpoint: `${PUBLIC}/oauth/authorize`,
      token_endpoint: `${PUBLIC}/oauth/token`,
      registration_endpoint: `${PUBLIC}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('answers a request without a token with where to sign in', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toContain(
      `resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource"`,
    );
    const bad = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer nope' },
      payload: {},
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('is not there without sign-in, when turned off, or on a public server', async () => {
    for (const options of [{ oidc: false }, { mcp: false }, { public: true }]) {
      const { app } = await setup(options);
      expect((await app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' }))
          .statusCode,
      ).toBe(404);
    }
  });
});

describe('registration (RFC 7591)', () => {
  it('registers a public client, and a confidential one with a secret', async () => {
    const { register } = await setup();
    const open = await register();
    expect(open.statusCode).toBe(201);
    expect(open.json()).toMatchObject({
      client_name: 'Test Assistant',
      token_endpoint_auth_method: 'none',
      redirect_uris: [REDIRECT],
    });
    expect(open.json().client_secret).toBeUndefined();
    const secret = await register({ token_endpoint_auth_method: undefined });
    expect(secret.json()).toMatchObject({ token_endpoint_auth_method: 'client_secret_basic' });
    expect(secret.json().client_secret).toMatch(/.{40,}/);
  });

  it('refuses redirect addresses that could leak a code', async () => {
    const { register } = await setup();
    for (const uris of [
      [],
      ['http://assistant.example.com/cb'],
      ['javascript:alert(1)'],
      ['https://assistant.example.com/cb#frag'],
      ['not a url'],
      ['https://user:pw@assistant.example.com/cb'],
    ]) {
      const response = await register({ redirect_uris: uris });
      expect(response.statusCode, JSON.stringify(uris)).toBe(400);
    }
    expect((await register({ redirect_uris: ['http://localhost:3333/cb'] })).statusCode).toBe(201);
    expect((await register({ redirect_uris: ['http://127.0.0.1/cb'] })).statusCode).toBe(201);
    expect((await register({ grant_types: ['client_credentials'] })).statusCode).toBe(400);
    expect((await register({ response_types: ['token'] })).statusCode).toBe(400);
    expect((await register({ redirect_uris: undefined })).statusCode).toBe(400);
  });

  it('limits registrations from one address', async () => {
    const { register } = await setup();
    for (let i = 0; i < REGISTRATIONS_PER_HOUR; i++)
      expect((await register()).statusCode).toBe(201);
    const refused = await register();
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBeDefined();
  });
});

describe('authorization', () => {
  it('connects an MCP user after they allow it, and the token works', async () => {
    const { instance, connect, rpc } = await setup();
    instance.mcp.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    const { tokens } = await connect();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    const init = await rpc(tokens.access_token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.serverInfo.name).toBe('worship-q');
    expect(init.json().result.instructions).toContain('match_songs');
    const user = instance.mcp.findUser('sam@example.org')!;
    expect(user.subject).toBe('sub-sam@example.org');
    expect(user.lastUsedAt).not.toBeNull();
    expect(instance.mcp.connections(user.id)).toBe(1);
  });

  it('shows the person what they allow, and sets a cookie only this browser has', async () => {
    const { instance, register, toConsent, north } = await setup();
    instance.mcp.addUser(
      'sam@example.org',
      { allWorkspaces: false, workspaceIds: [north.id] },
      null,
    );
    const client = (await register({ client_name: '<b>Evil</b>' })).json();
    const step = await toConsent('sam@example.org', client.client_id, pkcePair().challenge);
    expect(step.page.statusCode).toBe(200);
    expect(step.page.body).toContain('&lt;b&gt;Evil&lt;/b&gt;');
    expect(step.page.body).not.toContain('<b>Evil</b>');
    expect(step.page.body).toContain('North');
    expect(step.page.body).not.toContain('South');
    expect(step.page.body).toContain('assistant.example.com');
    expect(step.page.headers['x-frame-options']).toBe('DENY');
    expect(step.cookie).toMatch(new RegExp(`^${CONSENT_COOKIE}=`));
    expect(String(step.page.headers['set-cookie'])).toMatch(/HttpOnly/);
  });

  it('speaks the browser’s language on the consent page', async () => {
    const { app, instance, register, authorizeUrl } = await setup();
    instance.mcp.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    const client = (await register()).json();
    const start = await app.inject({
      method: 'GET',
      url: authorizeUrl(client.client_id, pkcePair().challenge),
    });
    const provider = new URL(start.headers.location as string);
    const page = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=${encodeURIComponent(`sam@example.org:${provider.searchParams.get('nonce')}`)}&state=${provider.searchParams.get('state')}`,
      headers: { 'accept-language': 'zh-TW,zh;q=0.9' },
    });
    expect(page.body).toContain('連接 AI 助手');
  });

  it('refuses an administrator who is not an MCP user', async () => {
    const { instance, register, toConsent } = await setup();
    instance.addAdministrator('pat@example.org', null);
    const client = (await register()).json();
    const step = await toConsent('pat@example.org', client.client_id, pkcePair().challenge);
    expect(step.page.statusCode).toBe(403);
    expect(step.page.body).toContain('pat@example.org');
    expect(step.consent).toBe('');
  });

  it('refuses a removed MCP user, and one signing in under another subject', async () => {
    const { instance, register, toConsent } = await setup();
    const removed = instance.mcp.addUser(
      'gone@example.org',
      { allWorkspaces: true, workspaceIds: [] },
      null,
    );
    instance.mcp.removeUser(removed.id);
    const bound = instance.mcp.addUser(
      'sam@example.org',
      { allWorkspaces: true, workspaceIds: [] },
      null,
    );
    instance.mcp.signIn('sam@example.org', 'someone-else', null);
    void bound;
    const client = (await register()).json();
    expect(
      (await toConsent('gone@example.org', client.client_id, pkcePair().challenge)).page.statusCode,
    ).toBe(403);
    expect(
      (await toConsent('sam@example.org', client.client_id, pkcePair().challenge)).page.statusCode,
    ).toBe(403);
  });

  it('refuses an address the provider has not verified', async () => {
    const { instance, register, toConsent } = await setup({ issuer: { emailVerified: false } });
    instance.mcp.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    const client = (await register()).json();
    expect(
      (await toConsent('sam@example.org', client.client_id, pkcePair().challenge)).page.statusCode,
    ).toBe(403);
  });

  it('sends the person back with access_denied when they deny', async () => {
    const { instance, register, toConsent, decide } = await setup();
    instance.mcp.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    const client = (await register()).json();
    const step = await toConsent('sam@example.org', client.client_id, pkcePair().challenge);
    const denied = await decide(step, 'deny');
    const back = new URL(denied.headers.location as string);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('client-state');
    expect(back.searchParams.get('code')).toBeNull();
    // The authorization is over: allowing it now does nothing.
    expect((await decide(step, 'allow')).statusCode).toBe(400);
  });

  it('accepts the consent only with the cookie and the form’s secret together', async () => {
    const { instance, register, toConsent, decide } = await setup();
    instance.mcp.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    const client = (await register()).json();
    const step = await toConsent('sam@example.org', client.client_id, pkcePair().challenge);
    expect((await decide({ ...step, cookie: '' }, 'allow')).statusCode).toBe(400);
    expect(
      (await decide({ ...step, consent: 'forged', cookie: `${CONSENT_COOKIE}=forged` }, 'allow'))
        .statusCode,
    ).toBe(400);
    expect((await decide({ ...step, authorization: 'other' }, 'allow')).statusCode).toBe(400);
  });

  it('never redirects to an address the client did not register', async () => {
    const { app, register, authorizeUrl } = await setup();
    const client = (await register()).json();
    const wrong = await app.inject({
      method: 'GET',
      url: authorizeUrl(client.client_id, pkcePair().challenge, {
        redirect_uri: 'https://attacker.example/cb',
      }),
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.headers.location).toBeUndefined();
    const unknown = await app.inject({
      method: 'GET',
      url: authorizeUrl('no-such-client', pkcePair().challenge),
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.headers.location).toBeUndefined();
  });

  it('requires PKCE with S256 and this server as the resource', async () => {
    const { app, register, authorizeUrl } = await setup();
    const client = (await register()).json();
    const errorOf = async (extra: Record<string, string>) => {
      const response = await app.inject({
        method: 'GET',
        url: authorizeUrl(client.client_id, pkcePair().challenge, extra),
      });
      expect(response.statusCode).toBe(302);
      const back = new URL(response.headers.location as string);
      return back.origin === new URL(REDIRECT).origin
        ? back.searchParams.get('error')
        : 'went to provider';
    };
    expect(await errorOf({ code_challenge: '' })).toBe('invalid_request');
    expect(await errorOf({ code_challenge_method: 'plain' })).toBe('invalid_request');
    expect(await errorOf({ response_type: 'token' })).toBe('unsupported_response_type');
    expect(await errorOf({ resource: 'https://elsewhere.example/mcp' })).toBe('invalid_target');
    expect(await errorOf({})).toBe('went to provider');
  });
});

describe('tokens', () => {
  async function allowed(extra: Parameters<typeof setup>[0] = {}) {
    const context = await setup(extra);
    context.instance.mcp.addUser(
      'sam@example.org',
      { allWorkspaces: true, workspaceIds: [] },
      null,
    );
    const client = (await context.register()).json() as { client_id: string };
    const { verifier, challenge } = pkcePair();
    const step = await context.toConsent('sam@example.org', client.client_id, challenge);
    const back = new URL((await context.decide(step, 'allow')).headers.location as string);
    expect(back.searchParams.get('iss')).toBe(PUBLIC);
    const code = back.searchParams.get('code')!;
    const grant = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: verifier,
    };
    return { ...context, client, verifier, code, grant };
  }

  it('exchanges a code once; a second use ends the tokens it gave', async () => {
    const { exchange, grant, rpc } = await allowed();
    const first = await exchange(grant);
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json()).toMatchObject({ token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000 });
    const again = await exchange(grant);
    expect(again.json()).toEqual({ error: 'invalid_grant' });
    expect((await rpc(first.json().access_token, 'tools/list')).statusCode).toBe(401);
  });

  it('refuses a wrong verifier, client or redirect address', async () => {
    const { exchange, grant, register } = await allowed();
    expect((await exchange({ ...grant, code_verifier: pkcePair().verifier })).json().error).toBe(
      'invalid_grant',
    );
    expect((await exchange({ ...grant, redirect_uri: `${REDIRECT}/other` })).json().error).toBe(
      'invalid_grant',
    );
    const other = (await register()).json();
    expect((await exchange({ ...grant, client_id: other.client_id })).json().error).toBe(
      'invalid_grant',
    );
    expect((await exchange({ ...grant, client_id: 'nobody' })).statusCode).toBe(401);
    expect((await exchange({ ...grant, code_verifier: '' })).json().error).toBe('invalid_request');
    expect((await exchange({ ...grant, grant_type: 'password' })).json().error).toBe(
      'unsupported_grant_type',
    );
    // None of that used the code up.
    expect((await exchange(grant)).statusCode).toBe(200);
  });

  it('refuses a code past its time', async () => {
    const { exchange, grant, time } = await allowed();
    time.advance(CODE_TTL_MS + 1000);
    expect((await exchange(grant)).json().error).toBe('invalid_grant');
  });

  it('refreshes, replacing the refresh token; reusing an old one signs the assistant out', async () => {
    const { exchange, grant, client, rpc } = await allowed();
    const first = (await exchange(grant)).json();
    const second = await exchange({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      client_id: client.client_id,
    });
    expect(second.statusCode).toBe(200);
    const fresh = second.json();
    expect(fresh.refresh_token).not.toBe(first.refresh_token);
    expect((await rpc(fresh.access_token, 'tools/list')).statusCode).toBe(200);
    // The first refresh token, used again: someone copied it.
    const replay = await exchange({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      client_id: client.client_id,
    });
    expect(replay.json().error).toBe('invalid_grant');
    expect((await rpc(fresh.access_token, 'tools/list')).statusCode).toBe(401);
    expect(
      (
        await exchange({
          grant_type: 'refresh_token',
          refresh_token: fresh.refresh_token,
          client_id: client.client_id,
        })
      ).json().error,
    ).toBe('invalid_grant');
  });

  it('lets an access token expire, and a refresh token after its time', async () => {
    const { exchange, grant, client, rpc, time } = await allowed();
    const tokens = (await exchange(grant)).json();
    time.advance(ACCESS_TTL_MS + 1000);
    expect((await rpc(tokens.access_token, 'tools/list')).statusCode).toBe(401);
    const refreshed = await exchange({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });
    expect(refreshed.statusCode).toBe(200);
    time.advance(REFRESH_TTL_MS + 1000);
    expect(
      (
        await exchange({
          grant_type: 'refresh_token',
          refresh_token: refreshed.json().refresh_token,
          client_id: client.client_id,
        })
      ).json().error,
    ).toBe('invalid_grant');
  });

  it('ends every token when the user is removed', async () => {
    const { exchange, grant, client, rpc, instance } = await allowed();
    const tokens = (await exchange(grant)).json();
    instance.mcp.removeUser(instance.mcp.findUser('sam@example.org')!.id);
    expect((await rpc(tokens.access_token, 'tools/list')).statusCode).toBe(401);
    expect(
      (
        await exchange({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: client.client_id,
        })
      ).json().error,
    ).toBe('invalid_grant');
  });

  it('revokes a token on the assistant’s request', async () => {
    const { app, exchange, grant, client, rpc } = await allowed();
    const tokens = (await exchange(grant)).json();
    const { payload, ...headers } = form({
      token: tokens.refresh_token,
      client_id: client.client_id,
    });
    expect(
      (await app.inject({ method: 'POST', url: '/oauth/revoke', headers, payload })).statusCode,
    ).toBe(200);
    expect((await rpc(tokens.access_token, 'tools/list')).statusCode).toBe(401);
  });

  it('makes a confidential client prove itself with its secret', async () => {
    const context = await setup();
    context.instance.mcp.addUser(
      'sam@example.org',
      { allWorkspaces: true, workspaceIds: [] },
      null,
    );
    const client = (
      await context.register({ token_endpoint_auth_method: 'client_secret_basic' })
    ).json();
    const { verifier, challenge } = pkcePair();
    const step = await context.toConsent('sam@example.org', client.client_id, challenge);
    const code = new URL(
      (await context.decide(step, 'allow')).headers.location as string,
    ).searchParams.get('code')!;
    const grant = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    };
    const basic = (secret: string) => ({
      authorization: `Basic ${Buffer.from(`${client.client_id}:${secret}`).toString('base64')}`,
    });
    const without = await context.exchange({ ...grant, client_id: client.client_id });
    expect(without.statusCode).toBe(401);
    const wrong = await context.exchange(grant, basic('wrong'));
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers['www-authenticate']).toContain('Basic');
    expect((await context.exchange(grant, basic(client.client_secret))).statusCode).toBe(200);
  });
});

describe('the MCP endpoint', () => {
  async function connected(access: { allWorkspaces: boolean; workspaces?: ('north' | 'south')[] }) {
    const context = await setup();
    const ids = (access.workspaces ?? []).map((w) => context[w].id);
    const user = context.instance.mcp.addUser(
      'sam@example.org',
      { allWorkspaces: access.allWorkspaces, workspaceIds: ids },
      null,
    );
    const { tokens } = await context.connect();
    return { ...context, user, token: tokens.access_token };
  }

  it('lists its tools', async () => {
    const { rpc, token } = await connected({ allWorkspaces: true });
    const response = await rpc(token, 'tools/list');
    const names = (response.json().result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([
      'list_workspaces',
      'list_run_sheets',
      'get_run_sheet',
      'search_songs',
      'match_songs',
      'get_song',
      'create_song',
      'update_song',
      'add_to_run_sheet',
      'move_run_sheet_item',
      'remove_run_sheet_items',
      'copy_run_sheet_items',
    ]);
    const tools = response.json().result.tools as {
      name: string;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
    }[];
    expect(tools.find((t) => t.name === 'get_song')!.annotations?.readOnlyHint).toBe(true);
    expect(
      tools.find((t) => t.name === 'remove_run_sheet_items')!.annotations?.destructiveHint,
    ).toBe(true);
    // No tool deletes from the library.
    expect(names.some((n) => /delete/.test(n))).toBe(false);
  });

  it('creates a song and puts it on a run sheet, as a person would ask', async () => {
    const { call, token, north, instance } = await connected({
      allWorkspaces: false,
      workspaces: ['north'],
    });
    const workspaces = JSON.parse((await call(token, 'list_workspaces')).text);
    expect(workspaces.workspaces.map((w: { name: string }) => w.name)).toEqual(['North']);
    const created = await call(token, 'create_song', {
      title: 'New Song',
      lyrics: 'Line one\nLine two',
    });
    expect(created.isError).toBe(false);
    const { songId } = JSON.parse(created.text);
    const added = await call(token, 'add_to_run_sheet', {
      date: '2026-11-29',
      items: [{ song: songId }, { website: 'example.org' }],
    });
    expect(added.isError).toBe(false);
    expect(JSON.parse(added.text).items.map((i: { title: string }) => i.title)).toEqual([
      'New Song',
      'example.org',
    ]);
    // Stored as a desktop's push would be, attributed to the MCP user.
    const row = instance.db
      .prepare(`SELECT device_id FROM record WHERE workspace_id = ? AND kind = 'runSheet'`)
      .get(north.id);
    expect(String(row?.device_id)).toMatch(/^mcp:/);
  });

  it('answers a refusal as a tool error the assistant can read', async () => {
    const { call, token, south } = await connected({ allWorkspaces: false, workspaces: ['north'] });
    const outside = await call(token, 'get_run_sheet', { workspace: south.id, date: '2026-11-29' });
    expect(outside).toMatchObject({ isError: true });
    expect(outside.text).toMatch(/^workspace-not-found:/);
    const mixed = await call(token, 'add_to_run_sheet', {
      date: '2026-11-29',
      items: [{ song: 'a', website: 'b' }],
    });
    expect(mixed.text).toMatch(/exactly one/);
    const badDate = await call(token, 'get_run_sheet', { date: 'Sunday' });
    expect(badDate.text).toMatch(/^invalid-date:/);
  });

  it('refuses arguments that do not fit the schema', async () => {
    const { rpc, token } = await connected({ allWorkspaces: true });
    const response = await rpc(token, 'tools/call', {
      name: 'match_songs',
      arguments: { titles: 'not a list' },
    });
    const body = response.json();
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });

  it('follows the user’s access as an administrator changes it', async () => {
    const { call, token, instance, user, south } = await connected({
      allWorkspaces: false,
      workspaces: ['north'],
    });
    instance.mcp.updateUser(user.id, { allWorkspaces: false, workspaceIds: [south.id] });
    const listed = JSON.parse((await call(token, 'list_workspaces')).text);
    expect(listed.workspaces.map((w: { name: string }) => w.name)).toEqual(['South']);
    instance.mcp.updateUser(user.id, { allWorkspaces: true, workspaceIds: [] });
    instance.createWorkspace('Later');
    const all = JSON.parse((await call(token, 'list_workspaces')).text);
    expect(all.workspaces.map((w: { name: string }) => w.name)).toEqual([
      'North',
      'South',
      'Later',
    ]);
  });

  it('opens no stream and keeps no session', async () => {
    const { app } = await connected({ allWorkspaces: true });
    expect((await app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
    expect((await app.inject({ method: 'DELETE', url: '/mcp' })).statusCode).toBe(405);
  });

  it('is not reached with an administrator’s session', async () => {
    const { app } = await connected({ allWorkspaces: true });
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { [ADMIN_HEADER]: '1', cookie: 'wq_admin=anything' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(response.statusCode).toBe(401);
  });
});
