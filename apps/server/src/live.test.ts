/** Phase 2 server routes: live-state backup (M4.1), output links and files (M7.1, M7.5), peers (M5.2). */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveState, DEFAULT_EXPIRY_MS } from '@worship-q/live-state';
import { PROTOCOL_HEADER, PROTOCOL_VERSION, type LiveSnapshot } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { openDatabase } from './db';
import { workspaceFilesDir } from './files';
import { Instance } from './instance';

function clock(start = '2026-10-11T09:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now).toISOString(), advance: (ms: number) => (now += ms) };
}

async function setup() {
  const time = clock();
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-live-'));
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const { workspace, code } = instance.createWorkspace('North Branch');
  const { token, device } = instance.enroll(code, 'Projector')!;
  const { app, relay } = await buildServer({ instance, dataDir, name: 'Test' });
  const headers = {
    authorization: `Bearer ${token}`,
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    'content-type': 'application/json',
  };
  // A request without a body, as the desktop sends a DELETE.
  const bare = {
    authorization: headers.authorization,
    [PROTOCOL_HEADER]: headers[PROTOCOL_HEADER],
  };
  const snapshot = (revision: number, coordinatorId = device.id): LiveSnapshot => {
    const state = createLiveState('rs1', time.now());
    return {
      revision,
      coordinatorId,
      state: { ...state, lastActiveAt: time.now(), updatedAt: time.now() },
      date: '2026-10-11',
      items: [],
      presented: null,
      devices: [],
    };
  };
  return { app, relay, instance, workspace, device, headers, bare, time, snapshot, dataDir };
}

describe('live-state backup (D17, D18)', () => {
  it('keeps the coordinator’s snapshot and grants, and gives them back', async () => {
    const { app, headers, snapshot } = await setup();
    const grants = [
      { id: 'g1', secretHash: 'h', name: 'Sam', createdAt: '2026-10-11T09:00:00.000Z' },
    ];
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/live',
      headers,
      payload: { snapshot: snapshot(3), grants },
    });
    expect(put.json()).toEqual({ stored: true });
    const got = await app.inject({ method: 'GET', url: '/api/v1/live', headers });
    expect(got.json()).toMatchObject({ snapshot: { revision: 3 }, grants });
  });

  it('never lets an older revision of the same coordinator replace a newer one', async () => {
    const { app, headers, snapshot } = await setup();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/live',
      headers,
      payload: { snapshot: snapshot(5) },
    });
    const older = await app.inject({
      method: 'PUT',
      url: '/api/v1/live',
      headers,
      payload: { snapshot: snapshot(4) },
    });
    expect(older.json()).toEqual({ stored: false });
    // A new coordinator starts its own numbering and always wins (D18).
    const other = await app.inject({
      method: 'PUT',
      url: '/api/v1/live',
      headers,
      payload: { snapshot: snapshot(1, 'other-device') },
    });
    expect(other.json()).toEqual({ stored: true });
    const got = await app.inject({ method: 'GET', url: '/api/v1/live', headers });
    expect(got.json().snapshot).toMatchObject({ revision: 1, coordinatorId: 'other-device' });
  });

  it('drops an expired snapshot on read', async () => {
    const { app, headers, snapshot, time } = await setup();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/live',
      headers,
      payload: { snapshot: snapshot(1) },
    });
    time.advance(DEFAULT_EXPIRY_MS - 1000);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/live', headers })).json().snapshot,
    ).not.toBeNull();
    time.advance(2000);
    expect((await app.inject({ method: 'GET', url: '/api/v1/live', headers })).json()).toEqual({
      snapshot: null,
      grants: [],
      deviceId: null,
      updatedAt: null,
    });
  });

  it('rejects a malformed snapshot and a request without a device token', async () => {
    const { app, headers } = await setup();
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/v1/live',
      headers,
      payload: { snapshot: {} },
    });
    expect(bad.statusCode).toBe(400);
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/live' });
    expect(anonymous.statusCode).toBe(426);
  });
});

describe('browser output links (D22)', () => {
  it('creates a link whose token is shown once, lists it, and refuses it once revoked', async () => {
    const { app, headers, bare, instance } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/outputs',
      headers: { ...headers, host: 'worship.example.org', 'x-forwarded-proto': 'https' },
      payload: { kind: 'subtitle', name: 'OBS laptop' },
    });
    const link = created.json() as { id: string; url: string; kind: string; name: string };
    expect(link).toMatchObject({ kind: 'subtitle', name: 'OBS laptop' });
    expect(link.url).toMatch(/^https:\/\/worship\.example\.org\/output\/subtitle\?t=.+/);
    const token = new URL(link.url).searchParams.get('t')!;
    expect(instance.authenticateOutputLink(token)?.id).toBe(link.id);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/outputs', headers });
    expect(listed.json().links).toEqual([
      { id: link.id, kind: 'subtitle', name: 'OBS laptop', createdAt: expect.any(String) },
    ]);
    // Neither the token nor its hash is listed.
    expect(JSON.stringify(listed.json())).not.toContain(token);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/outputs/${link.id}`,
      headers: bare,
    });
    expect(revoked.json()).toEqual({ revoked: [link.id] });
    expect(instance.authenticateOutputLink(token)).toBeNull();
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/outputs', headers })).json().links,
    ).toEqual([]);
  });

  it('refuses an unknown kind, and revokes every link at once', async () => {
    const { app, headers, bare } = await setup();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/outputs',
      headers,
      payload: { kind: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    await app.inject({
      method: 'POST',
      url: '/api/v1/outputs',
      headers,
      payload: { kind: 'slideshow' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/outputs',
      headers,
      payload: { kind: 'subtitle' },
    });
    const all = await app.inject({ method: 'DELETE', url: '/api/v1/outputs/all', headers: bare });
    expect(all.json().revoked).toHaveLength(2);
  });

  it('serves background files to a page with a valid token, cached by the browser (M7.5)', async () => {
    const { app, instance, workspace, dataDir } = await setup();
    const dir = workspaceFilesDir(dataDir, workspace.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bg-1.jpg'), 'picture');
    const { token } = instance.createOutputLink(workspace.id, 'slideshow', 'Foyer');
    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/output/files/bg-1.jpg?t=${token}`,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toContain('immutable');
    expect(first.body).toBe('picture');
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/output/files/bg-1.jpg?t=${token}`,
      headers: { 'if-none-match': first.headers.etag as string },
    });
    expect(second.statusCode).toBe(304);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/output/files/bg-1.jpg?t=nope' })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/output/files/missing.jpg?t=${token}` }))
        .statusCode,
    ).toBe(404);
  });

  it('describes the output’s look from the workspace’s synchronized settings', async () => {
    const { instance, workspace, device } = await setup();
    instance.setChurchSetting('subtitleFontFamily', 'Noto Sans SC');
    instance.push(workspace.id, device.id, [
      {
        kind: 'setting',
        id: 'outputLook.slideshow',
        key: 'outputLook.slideshow',
        revision: 1,
        updatedAt: '2026-10-11T09:00:00.000Z',
        data: {
          value: {
            fontFamily: 'Georgia',
            scale: 1.2,
            backgroundColor: '#123456',
            backgroundAssetId: 'bg1',
          },
        },
      },
      {
        kind: 'setting',
        id: 'linesPerPiece',
        key: 'linesPerPiece',
        revision: 1,
        updatedAt: '2026-10-11T09:00:00.000Z',
        data: { value: 3 },
      },
      {
        kind: 'background',
        id: 'bg1',
        key: 'bg1',
        revision: 1,
        updatedAt: '2026-10-11T09:00:00.000Z',
        data: {
          kind: 'video',
          fileName: 'bg1.mp4',
          originalName: 'sea.mp4',
          createdAt: '',
          removedAt: null,
        },
      },
    ]);
    expect(instance.outputLook(workspace.id, 'slideshow')).toEqual({
      fontFamily: 'Georgia',
      scale: 1.2,
      backgroundColor: '#123456',
      backgroundFile: { kind: 'video', fileName: 'bg1.mp4' },
      linesPerPiece: 3,
      wrapLongLines: true,
    });
    expect(instance.outputLook(workspace.id, 'subtitle')).toMatchObject({
      fontFamily: 'Noto Sans SC',
      scale: 1,
      backgroundFile: null,
    });
  });
});

describe('LAN credentials (M5.3)', () => {
  it('lists the workspace’s devices with token hashes, never tokens', async () => {
    const { app, headers, device } = await setup();
    const token = headers.authorization.slice(7);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/lan-credentials',
      headers,
    });
    const { devices } = response.json() as { devices: { deviceId: string; tokenHash: string }[] };
    expect(devices.map((d) => d.deviceId)).toEqual([device.id]);
    expect(devices[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(devices)).not.toContain(token);
  });
});

describe('peers (D20)', () => {
  it('lists the connected desktops with their LAN details', async () => {
    const { app, headers, relay, device } = await setup();
    const socket = {
      received: [] as string[],
      send(d: string) {
        this.received.push(d);
      },
      close() {},
    };
    relay.desktop(socket).message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token: headers.authorization.slice(7),
        capabilities: { roles: ['coordinator'], appVersion: 'test' },
        lan: { fingerprint: 'AB:CD', addresses: ['192.168.1.20'], port: 47311 },
      }),
    );
    const peers = await app.inject({ method: 'GET', url: '/api/v1/workspace/peers', headers });
    expect(peers.json()).toMatchObject({
      coordinatorName: 'Projector',
      peers: [
        { deviceId: device.id, role: 'operator', lan: { fingerprint: 'AB:CD', port: 47311 } },
      ],
    });
  });
});
