/** The OIDC client on its own (D27): discovery, PKCE, and reading claims. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claimsOf, decodeJwtPayload, OidcClient, oidcConfigFromEnv, pkce } from './oidc';

const ISSUER = 'https://login.example.org';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const jwt = (payload: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
    JSON.stringify(payload),
  ).toString('base64url')}.sig`;

/**
 * A provider in the same process. The authorization code carries the e-mail address and the
 * nonce the browser would have taken to the provider, so the token answer can echo them.
 */
export function fakeIssuer(
  options: {
    issuer?: string;
    emailInToken?: boolean;
    emailVerified?: boolean | 'absent';
    userinfo?: Record<string, unknown> | null;
    discovery?: Record<string, unknown>;
    /** Claims put into the ID token over the usual ones, or taken out when undefined. */
    token?: Record<string, unknown>;
  } = {},
) {
  const issuer = options.issuer ?? ISSUER;
  const tokenCalls: URLSearchParams[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return json(
        options.discovery ?? {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
        },
      );
    }
    if (url === `${issuer}/token`) {
      const params = new URLSearchParams(String(init?.body));
      tokenCalls.push(params);
      const code = params.get('code') ?? '';
      if (!code.includes(':')) return json({ error: 'invalid_grant' }, 400);
      const [email, nonce] = code.split(':') as [string, string];
      const payload: Record<string, unknown> = {
        iss: issuer,
        aud: 'worship-q',
        sub: `sub-${email}`,
        nonce,
        name: 'Pat Admin',
      };
      for (const [key, value] of Object.entries(options.token ?? {})) {
        if (value === undefined) delete payload[key];
        else payload[key] = value;
      }
      if (options.emailInToken !== false) payload.email = email;
      if (options.emailVerified !== 'absent')
        payload.email_verified = options.emailVerified ?? true;
      return json({ id_token: jwt(payload), access_token: `access-${email}` });
    }
    if (url === `${issuer}/userinfo`) {
      if (options.userinfo === null) return json({ error: 'nope' }, 401);
      const email = String(
        init?.headers && (init.headers as Record<string, string>).authorization,
      ).replace('Bearer access-', '');
      return json(options.userinfo ?? { sub: `sub-${email}`, email });
    }
    return json({ error: 'not-found' }, 404);
  };
  return { issuer, fetchImpl, tokenCalls };
}

const config = { issuer: ISSUER, clientId: 'worship-q', publicUrl: 'https://worship.example.org' };

describe('PKCE', () => {
  it('derives the S256 challenge from the verifier', () => {
    const { verifier, challenge } = pkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(pkce().verifier).not.toBe(verifier);
  });
});

describe('reading claims', () => {
  it('decodes a JWT payload without checking the signature, and refuses what is not one', () => {
    expect(decodeJwtPayload(jwt({ sub: 'a' }))).toEqual({ sub: 'a' });
    expect(decodeJwtPayload('not-a-token')).toBeNull();
    expect(decodeJwtPayload('a.b.c')).toBeNull();
  });

  it('lowercases the address and takes Microsoft’s preferred_username when it is one', () => {
    expect(claimsOf({ sub: 's', email: 'Pat@Example.ORG', email_verified: 'true' })).toEqual({
      subject: 's',
      email: 'pat@example.org',
      emailVerified: true,
      name: null,
    });
    expect(claimsOf({ sub: 's', preferred_username: 'pat@example.org' }).email).toBe(
      'pat@example.org',
    );
    expect(claimsOf({ sub: 's', preferred_username: 'pat' }).email).toBeNull();
    expect(claimsOf({ sub: 's', email_verified: false }).emailVerified).toBe(false);
    expect(claimsOf({ sub: 's' }).emailVerified).toBeNull();
  });
});

describe('the sign-in flow against a provider in this process', () => {
  it('sends the browser to the provider with PKCE, state and nonce', async () => {
    const { fetchImpl } = fakeIssuer();
    const client = new OidcClient(config, fetchImpl);
    const begun = await client.beginSignIn();
    const url = new URL(begun.url);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get('client_id')).toBe('worship-q');
    expect(url.searchParams.get('redirect_uri')).toBe('https://worship.example.org/auth/callback');
    expect(url.searchParams.get('state')).toBe(begun.state);
    expect(url.searchParams.get('nonce')).toBe(begun.nonce);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('email');
  });

  it('exchanges the code with the verifier and reads the claims from the ID token', async () => {
    const { fetchImpl, tokenCalls } = fakeIssuer();
    const client = new OidcClient({ ...config, clientSecret: 'shh' }, fetchImpl);
    const claims = await client.finishSignIn('pat@example.org:n1', 'verifier-1', 'n1');
    expect(claims).toEqual({
      subject: 'sub-pat@example.org',
      email: 'pat@example.org',
      emailVerified: true,
      name: 'Pat Admin',
    });
    expect(tokenCalls[0]!.get('code_verifier')).toBe('verifier-1');
    expect(tokenCalls[0]!.get('client_secret')).toBe('shh');
    expect(tokenCalls[0]!.get('grant_type')).toBe('authorization_code');
  });

  it('refuses an ID token made for another sign-in', async () => {
    const { fetchImpl } = fakeIssuer();
    const client = new OidcClient(config, fetchImpl);
    await expect(client.finishSignIn('pat@example.org:other', 'v', 'n1')).rejects.toThrow(
      /another sign-in/,
    );
  });

  it('asks userinfo for the address when the token has none, as Microsoft may', async () => {
    const { fetchImpl } = fakeIssuer({ emailInToken: false });
    const client = new OidcClient(config, fetchImpl);
    const claims = await client.finishSignIn('pat@example.org:n1', 'v', 'n1');
    expect(claims.email).toBe('pat@example.org');
  });

  it('ignores userinfo about someone else', async () => {
    const { fetchImpl } = fakeIssuer({
      emailInToken: false,
      userinfo: { sub: 'someone-else', email: 'other@example.org' },
    });
    const client = new OidcClient(config, fetchImpl);
    const claims = await client.finishSignIn('pat@example.org:n1', 'v', 'n1');
    expect(claims.email).toBeNull();
  });

  it('refuses a discovery document from another issuer, and tries discovery again later', async () => {
    const { fetchImpl } = fakeIssuer({
      discovery: {
        issuer: 'https://evil.example.org',
        authorization_endpoint: 'x',
        token_endpoint: 'y',
      },
    });
    const client = new OidcClient(config, fetchImpl);
    await expect(client.discover()).rejects.toThrow(/Issuer mismatch/);
    // The failed discovery is not cached.
    await expect(client.discover()).rejects.toThrow(/Issuer mismatch/);
  });

  it('refuses Microsoft’s multi-tenant endpoints, where any tenant could sign in', async () => {
    const { fetchImpl } = fakeIssuer({
      discovery: {
        issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
      },
    });
    const client = new OidcClient(config, fetchImpl);
    await expect(client.discover()).rejects.toThrow(/multi-tenant/);
  });

  it('refuses an ID token from another issuer or for another application', async () => {
    const fromElsewhere = new OidcClient(
      config,
      fakeIssuer({ token: { iss: 'https://login.microsoftonline.com/other-tenant/v2.0' } })
        .fetchImpl,
    );
    await expect(fromElsewhere.finishSignIn('pat@example.org:n1', 'v', 'n1')).rejects.toThrow(
      /another issuer/,
    );
    const forOther = new OidcClient(config, fakeIssuer({ token: { aud: 'other-app' } }).fetchImpl);
    await expect(forOther.finishSignIn('pat@example.org:n1', 'v', 'n1')).rejects.toThrow(
      /another application/,
    );
    // An audience given as a list is accepted when it names this application.
    const listed = new OidcClient(
      config,
      fakeIssuer({ token: { aud: ['worship-q', 'other-app'] } }).fetchImpl,
    );
    await expect(listed.finishSignIn('pat@example.org:n1', 'v', 'n1')).resolves.toMatchObject({
      email: 'pat@example.org',
    });
  });

  it('refuses an ID token without the nonce it was asked for', async () => {
    const client = new OidcClient(config, fakeIssuer({ token: { nonce: undefined } }).fetchImpl);
    await expect(client.finishSignIn('pat@example.org:n1', 'v', 'n1')).rejects.toThrow(
      /another sign-in/,
    );
  });
});

describe('configuration from the environment', () => {
  it('needs the issuer, client identifier and public address', () => {
    expect(oidcConfigFromEnv({})).toBeNull();
    expect(
      oidcConfigFromEnv({
        WORSHIP_Q_OIDC_ISSUER: ISSUER,
        WORSHIP_Q_OIDC_CLIENT_ID: 'id',
        WORSHIP_Q_PUBLIC_URL: 'https://worship.example.org/',
        WORSHIP_Q_OIDC_CLIENT_SECRET: ' ',
      }),
    ).toEqual({ issuer: ISSUER, clientId: 'id', publicUrl: 'https://worship.example.org' });
    expect(
      oidcConfigFromEnv({
        WORSHIP_Q_OIDC_ISSUER: ISSUER,
        WORSHIP_Q_OIDC_CLIENT_ID: 'id',
        WORSHIP_Q_PUBLIC_URL: 'https://worship.example.org',
        WORSHIP_Q_OIDC_CLIENT_SECRET: 'secret',
      })?.clientSecret,
    ).toBe('secret');
  });
});
