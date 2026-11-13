import { createHmac } from 'node:crypto';
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { openDatabase } from './db';
import { DEFAULT_STUN, IceConfigError, iceConfigFromEnv, iceServers, turnCredential } from './ice';
import { Instance } from './instance';

describe('the ICE settings (A10, M5.1)', () => {
  it('gives the public STUN server and no relay with no settings', () => {
    expect(iceConfigFromEnv({})).toEqual({ stun: [DEFAULT_STUN], turn: null });
  });

  it('takes two STUN addresses in order, trimmed, and none for an empty value', () => {
    expect(
      iceConfigFromEnv({ WORSHIP_Q_STUN: ' stun:a.example:3478 , stun:b.example ' }).stun,
    ).toEqual(['stun:a.example:3478', 'stun:b.example']);
    expect(iceConfigFromEnv({ WORSHIP_Q_STUN: '' }).stun).toEqual([]);
  });

  it('refuses to start on a STUN value that is not a stun: address, naming the setting', () => {
    expect(() => iceConfigFromEnv({ WORSHIP_Q_STUN: 'https://example.org' })).toThrow(
      IceConfigError,
    );
    expect(() => iceConfigFromEnv({ WORSHIP_Q_STUN: 'https://example.org' })).toThrow(
      /WORSHIP_Q_STUN/,
    );
  });

  it('offers no relay, with a warning, when only one of its two settings is set', () => {
    const warnings: string[] = [];
    expect(
      iceConfigFromEnv({ WORSHIP_Q_TURN_URL: 'turn:t.example:3478' }, (m) => warnings.push(m)).turn,
    ).toBeNull();
    expect(
      iceConfigFromEnv({ WORSHIP_Q_TURN_SECRET: 's3cret' }, (m) => warnings.push(m)).turn,
    ).toBeNull();
    expect(warnings).toHaveLength(2);
    expect(warnings.join(' ')).not.toContain('s3cret');
  });

  it('makes a credential valid ten minutes: the expiry as user name, its HMAC as password', () => {
    const now = Date.parse('2026-11-13T09:00:00.000Z');
    const { username, credential } = turnCredential('s3cret', now);
    expect(username).toBe(String(now / 1000 + 600));
    expect(credential).toBe(createHmac('sha1', 's3cret').update(username).digest('base64'));
  });

  it('gives different user names a second apart, each verifying', () => {
    const a = turnCredential('k', 1_000_000);
    const b = turnCredential('k', 1_001_000);
    expect(a.username).not.toBe(b.username);
    for (const each of [a, b]) {
      expect(each.credential).toBe(createHmac('sha1', 'k').update(each.username).digest('base64'));
    }
  });

  it('never puts the secret in the list', () => {
    const config = iceConfigFromEnv({
      WORSHIP_Q_TURN_URL: 'turn:t.example:3478',
      WORSHIP_Q_TURN_SECRET: 's3cret',
    });
    const list = iceServers(config, 0);
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain('s3cret');
  });
});

describe('GET /api/v1/ice', () => {
  async function setup(ice?: Parameters<typeof buildServer>[0]['ice']) {
    const instance = new Instance(openDatabase(':memory:'));
    const { code } = instance.createWorkspace('North');
    const device = instance.enroll(code, 'Desk')!;
    const { app } = await buildServer({
      instance,
      dataDir: '/nonexistent',
      name: 'Test',
      sweep: false,
      ice,
    });
    const get = (token: string | null) =>
      app.inject({
        method: 'GET',
        url: '/api/v1/ice',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
        },
      });
    return { app, instance, device, get };
  }

  it('gives an enrolled device the list', async () => {
    const { get, device } = await setup();
    const response = await get(device.token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ iceServers: [{ urls: DEFAULT_STUN }] });
  });

  it('refuses a device that is not enrolled, or revoked', async () => {
    const { get, instance, device } = await setup();
    expect((await get(null)).statusCode).toBe(401);
    expect((await get('nope')).statusCode).toBe(401);
    instance.revokeDevice(device.device.id);
    expect((await get(device.token)).statusCode).toBe(401);
  });

  it('says in info whether a relay is offered, never the secret', async () => {
    const off = await setup();
    expect((await off.app.inject({ method: 'GET', url: '/api/v1/info' })).json().audioRelay).toBe(
      false,
    );
    const on = await setup({ stun: [], turn: { urls: ['turn:t.example:3478'], secret: 's3cret' } });
    const info = await on.app.inject({ method: 'GET', url: '/api/v1/info' });
    expect(info.json().audioRelay).toBe(true);
    expect(info.body).not.toContain('s3cret');
    const list = await on.get(on.device.token);
    expect(list.json().iceServers[0]).toMatchObject({ urls: ['turn:t.example:3478'] });
    expect(list.body).not.toContain('s3cret');
  });
});
