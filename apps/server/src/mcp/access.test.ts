/** MCP users and the OAuth state behind them (MCP plan, C1–C4), on their own. */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import { Instance } from '../instance';
import {
  AccessError,
  AUTHORIZATION_TTL_MS,
  CLIENT_IDLE_MS,
  MAX_CLIENTS,
  verifierMatches,
} from './access';
import { undoMcpMigration } from './migration.testing';

function clock(start = '2026-11-28T09:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now).toISOString(), advance: (ms: number) => (now += ms) };
}

function setup() {
  const time = clock();
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const north = instance.createWorkspace('North').workspace;
  return { time, instance, access: instance.mcp, north };
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** A user with tokens, as after a completed authorization. */
function connected(context: ReturnType<typeof setup>) {
  const { access } = context;
  const user = access.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
  const { client } = access.registerClient({
    name: 'A',
    redirectUris: ['https://a.example/cb'],
    authMethod: 'none',
  });
  const { verifier, challenge } = pkcePair();
  const id = access.startAuthorization({
    clientId: client.id,
    redirectUri: 'https://a.example/cb',
    codeChallenge: challenge,
    clientState: 's',
    resource: null,
  });
  const consent = access.attachUser(id, user.id)!;
  const { code } = access.decide(id, consent, true)!;
  const tokens = access.redeemCode(code!, client.id, 'https://a.example/cb', verifier);
  if (typeof tokens === 'string') throw new Error(tokens);
  return { user, client, tokens };
}

describe('MCP users', () => {
  it('are matched by e-mail address, without case or spaces', () => {
    const { access } = setup();
    const user = access.addUser(
      '  Sam@Example.ORG ',
      { allWorkspaces: false, workspaceIds: [] },
      'admin-1',
    );
    expect(user).toMatchObject({
      email: 'sam@example.org',
      addedBy: 'admin-1',
      allWorkspaces: false,
    });
    expect(access.findUser('SAM@example.org')?.id).toBe(user.id);
  });

  it('refuses a bad address, one already added, and unknown workspaces', () => {
    const { access } = setup();
    const code = (work: () => unknown) => {
      try {
        work();
      } catch (error) {
        return (error as AccessError).code;
      }
      return null;
    };
    expect(
      code(() => access.addUser('nope', { allWorkspaces: true, workspaceIds: [] }, null)),
    ).toBe('invalid-email');
    access.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    expect(
      code(() =>
        access.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null),
      ),
    ).toBe('already-added');
    expect(
      code(() =>
        access.addUser('kim@example.org', { allWorkspaces: false, workspaceIds: ['nope'] }, null),
      ),
    ).toBe('unknown-workspace');
    // Nothing of the refused one was kept.
    expect(access.findUser('kim@example.org')).toBeNull();
  });

  it('bind the provider’s subject on first sign-in and refuse another one later', () => {
    const { access } = setup();
    access.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    expect(access.signIn('sam@example.org', 'sub-1', 'Sam')).toMatchObject({
      subject: 'sub-1',
      name: 'Sam',
    });
    expect(access.signIn('sam@example.org', 'sub-1', null)?.name).toBe('Sam');
    expect(access.signIn('sam@example.org', 'sub-2', 'Impostor')).toBeNull();
    expect(access.signIn('kim@example.org', 'sub-3', null)).toBeNull();
  });

  it('removed, lose every token and their workspaces', () => {
    const context = setup();
    const { user, tokens } = connected(context);
    expect(context.access.authenticate(tokens.accessToken)?.id).toBe(user.id);
    expect(context.access.removeUser(user.id)).toBe(true);
    expect(context.access.removeUser(user.id)).toBe(false);
    expect(context.access.authenticate(tokens.accessToken)).toBeNull();
    expect(context.access.getUser(user.id)?.removedAt).not.toBeNull();
    expect(context.access.listUsers()).toEqual([]);
    expect(
      context.access.updateUser(user.id, { allWorkspaces: true, workspaceIds: [] }),
    ).toBeNull();
  });
});

describe('PKCE', () => {
  it('checks the verifier against its S256 challenge', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifierMatches(verifier, challenge)).toBe(true);
    expect(verifierMatches(pkcePair().verifier, challenge)).toBe(false);
    // Too short to be a verifier at all.
    expect(verifierMatches('short', createHash('sha256').update('short').digest('base64url'))).toBe(
      false,
    );
    expect(verifierMatches(verifier, '')).toBe(false);
  });
});

describe('authorizations', () => {
  it('wait for consent only so long', () => {
    const { access, time } = setup();
    const user = access.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    const { client } = access.registerClient({
      name: 'A',
      redirectUris: ['https://a.example/cb'],
      authMethod: 'none',
    });
    const id = access.startAuthorization({
      clientId: client.id,
      redirectUri: 'https://a.example/cb',
      codeChallenge: pkcePair().challenge,
      clientState: null,
      resource: null,
    });
    time.advance(AUTHORIZATION_TTL_MS + 1000);
    expect(access.pendingAuthorization(id)).toBeNull();
    expect(access.attachUser(id, user.id)).toBeNull();
  });

  it('give no code to a user removed between sign-in and consent', () => {
    const { access } = setup();
    const user = access.addUser('sam@example.org', { allWorkspaces: true, workspaceIds: [] }, null);
    const { client } = access.registerClient({
      name: 'A',
      redirectUris: ['https://a.example/cb'],
      authMethod: 'none',
    });
    const id = access.startAuthorization({
      clientId: client.id,
      redirectUri: 'https://a.example/cb',
      codeChallenge: pkcePair().challenge,
      clientState: null,
      resource: null,
    });
    const consent = access.attachUser(id, user.id)!;
    access.removeUser(user.id);
    expect(access.decide(id, consent, true)?.code).toBeNull();
  });
});

describe('clients', () => {
  it('are forgotten after a long time unused', () => {
    const { access, time } = setup();
    const { client } = access.registerClient({
      name: 'Old',
      redirectUris: ['https://a.example/cb'],
      authMethod: 'none',
    });
    time.advance(CLIENT_IDLE_MS + 1000);
    access.registerClient({
      name: 'New',
      redirectUris: ['https://a.example/cb'],
      authMethod: 'none',
    });
    expect(access.getClient(client.id)).toBeNull();
  });

  it('are kept to a number, the longest unused going first', () => {
    const { access, time } = setup();
    const first = access.registerClient({
      name: '0',
      redirectUris: ['https://a.example/cb'],
      authMethod: 'none',
    });
    for (let i = 1; i < MAX_CLIENTS; i++) {
      time.advance(1000);
      access.registerClient({
        name: String(i),
        redirectUris: ['https://a.example/cb'],
        authMethod: 'none',
      });
    }
    time.advance(1000);
    access.registerClient({
      name: 'one more',
      redirectUris: ['https://a.example/cb'],
      authMethod: 'none',
    });
    expect(access.getClient(first.client.id)).toBeNull();
  });

  it('with a secret, must send it', () => {
    const { access } = setup();
    const { client, secret } = access.registerClient({
      name: 'A',
      redirectUris: ['https://a.example/cb'],
      authMethod: 'client_secret_post',
    });
    expect(access.authenticateClient(client.id, null)).toBeNull();
    expect(access.authenticateClient(client.id, 'wrong')).toBeNull();
    expect(access.authenticateClient(client.id, secret)?.id).toBe(client.id);
    expect(access.authenticateClient('nope', secret)).toBeNull();
  });
});

describe('tokens', () => {
  it('counts each connected assistant once', () => {
    const context = setup();
    const { user, client, tokens } = connected(context);
    const next = context.access.refresh(tokens.refreshToken, client.id);
    expect(typeof next).toBe('object');
    expect(context.access.connections(user.id)).toBe(1);
    context.access.revokeUserTokens(user.id);
    expect(context.access.connections(user.id)).toBe(0);
  });

  it('are revoked only by the client they were issued to', () => {
    const context = setup();
    const { tokens } = connected(context);
    context.access.revokeToken(tokens.accessToken, 'another-client');
    expect(context.access.authenticate(tokens.accessToken)).not.toBeNull();
  });

  it('an access token revoked alone leaves the refresh token working', () => {
    const context = setup();
    const { client, tokens } = connected(context);
    context.access.revokeToken(tokens.accessToken, client.id);
    expect(context.access.authenticate(tokens.accessToken)).toBeNull();
    expect(typeof context.access.refresh(tokens.refreshToken, client.id)).toBe('object');
  });
});

describe('the migration', () => {
  it('brings an older database up, keeping a sign-in under way as an administrator’s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'worship-q-mcp-migrate-'));
    try {
      const path = join(dir, 'instance.db');
      const before = openDatabase(path);
      const version = Number(before.prepare('PRAGMA user_version').get()!.user_version);
      undoMcpMigration(before);
      before
        .prepare(
          `INSERT INTO auth_state (state, verifier, nonce, return_to, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('s1', 'v', 'n', '/admin/', new Date().toISOString());
      before.exec(`PRAGMA user_version = ${version - 1}`);
      before.close();
      const after = new Instance(openDatabase(path));
      expect(Number(after.db.prepare('PRAGMA user_version').get()!.user_version)).toBe(version);
      expect(after.takeAuthState('s1')).toEqual({
        verifier: 'v',
        nonce: 'n',
        returnTo: '/admin/',
        mcpAuthorizationId: null,
      });
      expect(after.mcp.listUsers()).toEqual([]);
      after.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
