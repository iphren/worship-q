/**
 * Administrator sign-in through the church's OpenID Connect provider (decision D27):
 * discovery, the authorization code flow with PKCE, and the claims that come back.
 *
 * No library: the flow is three requests, and keeping it here lets the tests run it against
 * an issuer started in the same process. The ID token's signature is not checked: it arrives
 * straight from the provider's token endpoint over TLS in exchange for a code bound to this
 * server by PKCE, which OpenID Connect accepts in place of the signature. Its issuer,
 * audience and nonce are checked. The userinfo endpoint fills in any claim the token leaves
 * out, such as Microsoft's e-mail address.
 *
 * Administrators are matched by e-mail address, so the provider must be one organization's
 * directory, which vouches for the addresses in it. Microsoft's shared endpoints (`common`,
 * `organizations`, `consumers`) let anyone's tenant sign in with any address it likes, so they
 * are refused: the issuer must name the church's tenant.
 */
import { createHash, randomBytes } from 'node:crypto';

export interface OidcConfig {
  /** The provider's issuer URL, as its discovery document states it. */
  issuer: string;
  clientId: string;
  /** For providers that require one; Google and Microsoft do for web apps. */
  clientSecret?: string;
  /** This server's public address, where the provider sends the browser back. */
  publicUrl: string;
}

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

/** What the provider vouches for. */
export interface OidcClaims {
  subject: string;
  email: string | null;
  /** Null when the provider does not say. */
  emailVerified: boolean | null;
  name: string | null;
}

export const CALLBACK_PATH = '/auth/callback';

/** The configuration from the environment, or null when sign-in is not configured. */
export function oidcConfigFromEnv(env: Record<string, string | undefined>): OidcConfig | null {
  const issuer = env.WORSHIP_Q_OIDC_ISSUER?.trim();
  const clientId = env.WORSHIP_Q_OIDC_CLIENT_ID?.trim();
  const publicUrl = env.WORSHIP_Q_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (!issuer || !clientId || !publicUrl) return null;
  const clientSecret = env.WORSHIP_Q_OIDC_CLIENT_SECRET?.trim();
  return { issuer, clientId, publicUrl, ...(clientSecret ? { clientSecret } : {}) };
}

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** A PKCE verifier and its S256 challenge. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** The payload of a JWT, without checking its signature; null when it is not one. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class OidcError extends Error {}

export class OidcClient {
  private metadata: Promise<OidcMetadata> | null = null;

  constructor(
    readonly config: OidcConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get redirectUri(): string {
    return `${this.config.publicUrl}${CALLBACK_PATH}`;
  }

  /** The provider's endpoints, fetched once; fetched again after a failure. */
  discover(): Promise<OidcMetadata> {
    if (!this.metadata) {
      this.metadata = this.fetchMetadata().catch((error) => {
        this.metadata = null;
        throw error;
      });
    }
    return this.metadata;
  }

  private async fetchMetadata(): Promise<OidcMetadata> {
    const base = this.config.issuer.replace(/\/+$/, '');
    const response = await this.fetchImpl(`${base}/.well-known/openid-configuration`);
    if (!response.ok) throw new OidcError(`Discovery failed: ${response.status}`);
    const metadata = (await response.json()) as Partial<OidcMetadata>;
    if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.issuer) {
      throw new OidcError('Discovery document is missing endpoints');
    }
    // Microsoft's shared endpoints answer with a placeholder for the tenant: any tenant
    // could sign in, with addresses nobody verified.
    if (metadata.issuer.includes('{tenantid}')) {
      throw new OidcError(
        'The issuer is a multi-tenant endpoint; configure the church’s own tenant instead',
      );
    }
    if (!sameIssuer(metadata.issuer, this.config.issuer)) {
      throw new OidcError(`Issuer mismatch: ${metadata.issuer}`);
    }
    return metadata as OidcMetadata;
  }

  /** Where to send the browser, and what to remember until it comes back. */
  async beginSignIn(): Promise<{ url: string; state: string; verifier: string; nonce: string }> {
    const metadata = await this.discover();
    const state = base64url(randomBytes(24));
    const nonce = base64url(randomBytes(24));
    const { verifier, challenge } = pkce();
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString(), state, verifier, nonce };
  }

  /** Exchanges the code the provider sent back for the claims about the person. */
  async finishSignIn(code: string, verifier: string, nonce: string): Promise<OidcClaims> {
    const metadata = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.config.clientId,
      code_verifier: verifier,
    });
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);
    const response = await this.fetchImpl(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!response.ok) throw new OidcError(`Token exchange failed: ${response.status}`);
    const tokens = (await response.json()) as { id_token?: unknown; access_token?: unknown };
    const idToken = typeof tokens.id_token === 'string' ? decodeJwtPayload(tokens.id_token) : null;
    if (!idToken) throw new OidcError('No ID token in the provider’s answer');
    if (typeof idToken.iss !== 'string' || !sameIssuer(idToken.iss, metadata.issuer)) {
      throw new OidcError(`The ID token is from another issuer: ${String(idToken.iss)}`);
    }
    const audience = Array.isArray(idToken.aud) ? idToken.aud : [idToken.aud];
    if (!audience.includes(this.config.clientId)) {
      throw new OidcError('The ID token is for another application');
    }
    if (idToken.nonce !== nonce) throw new OidcError('The ID token is for another sign-in');
    if (typeof idToken.sub !== 'string' || !idToken.sub) throw new OidcError('No subject');
    let claims = claimsOf(idToken);
    if (!claims.email && metadata.userinfo_endpoint && typeof tokens.access_token === 'string') {
      const info = await this.fetchImpl(metadata.userinfo_endpoint, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      if (info.ok) {
        const extra = claimsOf((await info.json()) as Record<string, unknown>);
        if (extra.subject === claims.subject) {
          claims = {
            subject: claims.subject,
            email: claims.email ?? extra.email,
            emailVerified: claims.emailVerified ?? extra.emailVerified,
            name: claims.name ?? extra.name,
          };
        }
      }
    }
    return claims;
  }
}

const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** Reads the claims this server uses from a token payload or a userinfo answer. */
export function claimsOf(payload: Record<string, unknown>): OidcClaims {
  const str = (value: unknown) => (typeof value === 'string' && value ? value : null);
  // Microsoft puts the address in `preferred_username` when `email` is absent; it is an
  // address only when it looks like one.
  const preferred = str(payload.preferred_username);
  const email = str(payload.email) ?? (preferred && preferred.includes('@') ? preferred : null);
  return {
    subject: str(payload.sub) ?? '',
    email: email ? email.toLowerCase() : null,
    emailVerified:
      typeof payload.email_verified === 'boolean'
        ? payload.email_verified
        : payload.email_verified === 'true'
          ? true
          : payload.email_verified === 'false'
            ? false
            : null,
    name: str(payload.name),
  };
}
