/** Phase 3 admin routes: sign-in (D27, D28), workspaces, devices, administrators, settings, library, live view (D38). */
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveState } from '@worship-q/live-state';
import {
  ADMIN_HEADER,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type AdminLiveView,
  type LiveSnapshot,
} from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { openDatabase } from './db';
import { churchFilesDir, workspaceFilesDir } from './files';
import { Instance, PAIRING_MAX_PENDING, PAIRING_MAX_PENDING_PER_ADDRESS } from './instance';
import { OidcClient } from './oidc';
import { fakeIssuer } from './oidc.test';

function clock(start = '2026-11-02T09:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now).toISOString(), advance: (ms: number) => (now += ms) };
}

async function setup(options: { oidc?: boolean; administrators?: string[] } = {}) {
  const time = clock();
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-admin-'));
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const { fetchImpl, issuer } = fakeIssuer();
  const oidc =
    options.oidc === false
      ? null
      : new OidcClient(
          { issuer, clientId: 'worship-q', publicUrl: 'https://worship.example.org' },
          fetchImpl,
        );
  const { app, relay } = await buildServer({
    instance,
    dataDir,
    name: 'Test Church',
    oidc,
    administrators: options.administrators,
    sweep: false,
  });
  const admin = { [ADMIN_HEADER]: '1' };

  /** Signs in as the browser would: to the provider and back with its code. */
  async function signIn(email: string, returnTo = '/admin/devices') {
    const login = await app.inject({
      method: 'GET',
      url: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    });
    expect(login.statusCode).toBe(302);
    const url = new URL(login.headers.location as string);
    const state = url.searchParams.get('state')!;
    const nonce = url.searchParams.get('nonce')!;
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=${encodeURIComponent(`${email}:${nonce}`)}&state=${state}`,
    });
    const setCookie = callback.headers['set-cookie'];
    const cookie = typeof setCookie === 'string' ? setCookie.split(';')[0]! : '';
    return { callback, cookie, headers: { ...admin, cookie } };
  }

  return { app, relay, instance, time, dataDir, admin, signIn };
}

describe('sign-in (D27, D28)', () => {
  it('lets an administrator in, binds the provider’s subject, and returns to the page asked for', async () => {
    const { app, instance, signIn } = await setup({ administrators: ['Pat@Example.org'] });
    const { callback, headers } = await signIn('pat@example.org');
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/admin/devices');
    expect(callback.headers['set-cookie']).toMatch(/HttpOnly/);
    expect(callback.headers['set-cookie']).toMatch(/SameSite=Lax/);
    const me = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers });
    expect(me.json()).toEqual({
      configured: true,
      hasAdministrators: true,
      admin: { id: expect.any(String), email: 'pat@example.org', name: 'Pat Admin' },
      name: 'Test Church',
    });
    expect(instance.findAdministrator('pat@example.org')?.subject).toBe('sub-pat@example.org');
  });

  it('turns away someone with a provider account who is not on the list', async () => {
    const { app, signIn } = await setup({ administrators: ['pat@example.org'] });
    const { callback, headers } = await signIn('intruder@example.org');
    expect(callback.headers.location).toBe('/admin/?error=not-administrator');
    expect(callback.headers['set-cookie']).toBeUndefined();
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/workspaces', headers });
    expect(list.statusCode).toBe(401);
  });

  it('refuses a callback whose state it never issued, or issued already', async () => {
    const { app, signIn } = await setup({ administrators: ['pat@example.org'] });
    const stale = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=pat@example.org:n&state=unknown',
    });
    expect(stale.headers.location).toBe('/admin/?error=sign-in-failed');
    const first = await signIn('pat@example.org');
    expect(first.callback.headers.location).toBe('/admin/devices');
    // Replaying the same callback fails: the state was taken.
    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const state = new URL(login.headers.location as string).searchParams.get('state')!;
    await app.inject({
      method: 'GET',
      url: `/auth/callback?code=pat@example.org:x&state=${state}`,
    });
    const replay = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=pat@example.org:x&state=${state}`,
    });
    expect(replay.headers.location).toBe('/admin/?error=sign-in-failed');
  });

  it('only returns to pages of the admin app', async () => {
    const { signIn } = await setup({ administrators: ['pat@example.org'] });
    const { callback } = await signIn('pat@example.org', 'https://evil.example.org/');
    expect(callback.headers.location).toBe('/admin/');
    const other = await signIn('pat@example.org', '//evil.example.org');
    expect(other.callback.headers.location).toBe('/admin/');
  });

  it('refuses every admin route without the header, so a cross-site form cannot reach them', async () => {
    const { app, signIn } = await setup({ administrators: ['pat@example.org'] });
    const { cookie } = await signIn('pat@example.org');
    const noHeader = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/workspaces',
      headers: { cookie },
    });
    expect(noHeader.statusCode).toBe(403);
    const me = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { cookie } });
    expect(me.statusCode).toBe(403);
  });

  it('signs out, ending the session', async () => {
    const { app, signIn } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers });
    expect(out.statusCode).toBe(204);
    expect(out.headers['set-cookie']).toMatch(/Max-Age=0/);
    const me = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers });
    expect(me.json().admin).toBeNull();
  });

  it('ends a session idle for eight hours', async () => {
    const { app, signIn, time } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    time.advance(7 * 60 * 60 * 1000);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers })).json().admin,
    ).not.toBeNull();
    // Each request slides the session along.
    time.advance(7 * 60 * 60 * 1000);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers })).json().admin,
    ).not.toBeNull();
    time.advance(8 * 60 * 60 * 1000 + 1000);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers })).json().admin,
    ).toBeNull();
  });

  it('says so when sign-in is not configured, and leaves the command line as the way in', async () => {
    const { app, instance, admin } = await setup({ oidc: false });
    const me = await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: admin });
    expect(me.json()).toMatchObject({ configured: false, hasAdministrators: false, admin: null });
    expect((await app.inject({ method: 'GET', url: '/auth/login' })).statusCode).toBe(503);
    expect(instance.hasAdministrators()).toBe(false);
    const info = await app.inject({ method: 'GET', url: '/api/v1/info' });
    expect(info.json()).toMatchObject({ pairing: true, admin: false, protocolVersion: 3 });
  });

  it('refuses a subject that does not match the one bound at first sign-in', async () => {
    const { instance } = await setup({ administrators: ['pat@example.org'] });
    expect(instance.signIn('pat@example.org', 'sub-1', 'Pat')).not.toBeNull();
    expect(instance.signIn('pat@example.org', 'sub-2', 'Impostor')).toBeNull();
    expect(instance.signIn('pat@example.org', 'sub-1', 'Pat')).not.toBeNull();
  });
});

describe('administrators (D28)', () => {
  it('lists, adds by e-mail idempotently, and never removes the last one', async () => {
    const { app, signIn } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    const added = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/administrators',
      headers,
      payload: { email: 'Sam@Example.org' },
    });
    expect(added.json().administrator).toMatchObject({
      email: 'sam@example.org',
      addedBy: 'pat@example.org',
      lastSignInAt: null,
    });
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/administrators',
      headers,
      payload: { email: 'sam@example.org' },
    });
    expect(again.json().administrator.id).toBe(added.json().administrator.id);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/administrators',
      headers,
      payload: { email: 'not-an-address' },
    });
    expect(bad.statusCode).toBe(400);

    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/administrators', headers });
    expect(list.json().administrators.map((a: { email: string }) => a.email)).toEqual([
      'pat@example.org',
      'sam@example.org',
    ]);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/administrators/${added.json().administrator.id}`,
      headers,
    });
    expect(removed.json()).toEqual({ removed: true });
    const me = list.json().administrators[0].id;
    const last = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/administrators/${me}`,
      headers,
    });
    expect(last.statusCode).toBe(409);
  });

  it('seeds administrators from the environment only once', async () => {
    const { instance } = await setup({
      administrators: ['pat@example.org', ' ', 'pat@example.org'],
    });
    expect(instance.listAdministrators()).toHaveLength(1);
  });

  it('keeps an administrator removed in the app removed, although the environment names them', async () => {
    const { instance, dataDir } = await setup({
      administrators: ['pat@example.org', 'sam@example.org'],
    });
    const sam = instance.findAdministrator('sam@example.org')!;
    expect(instance.removeAdministrator(sam.id)).toBe(true);
    // The server starts again with the same environment.
    const restarted = await buildServer({
      instance,
      dataDir,
      name: 'Test Church',
      administrators: ['pat@example.org', 'sam@example.org', 'lee@example.org'],
      sweep: false,
    });
    await restarted.app.close();
    expect(
      instance
        .listAdministrators()
        .map((a) => a.email)
        .sort(),
    ).toEqual(['lee@example.org', 'pat@example.org']);
    // The command line brings them back.
    instance.addAdministrator('sam@example.org', null);
    expect(instance.findAdministrator('sam@example.org')).not.toBeNull();
  });
});

describe('workspaces', () => {
  it('creates, renames, rotates the code, and switches codes on for a while (D30)', async () => {
    const { app, instance, signIn } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/workspaces',
      headers,
      payload: { name: 'North Branch' },
    });
    const { workspace, code } = created.json();
    expect(workspace).toMatchObject({
      name: 'North Branch',
      codesEnabled: false,
      manageLibrary: false,
      devices: 0,
      live: false,
    });
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Administrators exist, so the code is off until turned on.
    expect(instance.enroll(code, 'Laptop')).toBeNull();
    expect(instance.codeRefusal(code)).toBe('codes-off');

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/workspaces/${workspace.id}`,
      headers,
      payload: { name: 'North', codesEnabled: true },
    });
    expect(renamed.json().workspace).toMatchObject({ name: 'North', codesEnabled: true });
    expect(instance.enroll(code, 'Laptop')).not.toBeNull();

    const rotated = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/workspaces/${workspace.id}/code`,
      headers,
    });
    expect(instance.enroll(code, 'Laptop')).toBeNull();
    expect(instance.enroll(rotated.json().code, 'Laptop')).not.toBeNull();

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/workspaces',
      headers,
      payload: { name: '  ' },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('shows the conversion plan and turns Manage Church Library on, moving files (D36)', async () => {
    const { app, instance, signIn, dataDir } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    const { workspace, code } = instance.createWorkspace('South');
    instance.setCodesEnabled(workspace.id, true);
    const { device } = instance.enroll(code, 'Laptop')!;
    instance.push(workspace.id, device.id, [
      {
        kind: 'background',
        id: 'bg1',
        key: 'bg1',
        revision: 1,
        updatedAt: '2026-11-01T00:00:00.000Z',
        data: { kind: 'image', fileName: 'bg1.jpg', originalName: 'Sea.jpg', removedAt: null },
      },
    ]);
    mkdirSync(workspaceFilesDir(dataDir, workspace.id), { recursive: true });
    writeFileSync(join(workspaceFilesDir(dataDir, workspace.id), 'bg1.jpg'), 'x');

    const plan = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/workspaces/${workspace.id}/library-plan`,
      headers,
    });
    expect(plan.json()).toEqual({ songs: [], backgrounds: ['Sea.jpg'], overrides: [], hidden: [] });
    const on = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/workspaces/${workspace.id}/library`,
      headers,
      payload: { on: true },
    });
    expect(on.json()).toMatchObject({ workspace: { manageLibrary: true }, moved: 1 });
    expect(existsSync(join(churchFilesDir(dataDir), 'bg1.jpg'))).toBe(true);
    // Off again leaves the Church Library as it is.
    const off = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/workspaces/${workspace.id}/library`,
      headers,
      payload: { on: false },
    });
    expect(off.json().workspace.manageLibrary).toBe(false);
    expect(instance.listChurch('background')).toHaveLength(1);
  });

  it('shows a workspace’s live state from the server’s copy, or that it is not presenting (D38)', async () => {
    const { app, instance, signIn, relay, time } = await setup({
      administrators: ['pat@example.org'],
    });
    const { headers } = await signIn('pat@example.org');
    const { workspace, code } = instance.createWorkspace('North');
    instance.setCodesEnabled(workspace.id, true);
    const { device, token } = instance.enroll(code, 'Projector')!;
    const url = `/api/v1/admin/workspaces/${workspace.id}/live`;
    expect((await app.inject({ method: 'GET', url, headers })).json()).toEqual({ live: false });

    const state = createLiveState('rs1', time.now());
    const snapshot: LiveSnapshot = {
      revision: 4,
      coordinatorId: device.id,
      state: { ...state, lastActiveAt: time.now(), updatedAt: time.now() },
      date: '2026-11-02',
      items: [],
      presented: null,
      devices: [],
    };
    instance.putLive(workspace.id, device.id, snapshot, []);
    const view = (await app.inject({ method: 'GET', url, headers })).json() as AdminLiveView;
    expect(view).toMatchObject({
      live: true,
      snapshot: { revision: 4 },
      coordinator: { deviceId: device.id, name: 'Projector', connected: false },
      expiresAt: new Date(Date.parse(time.now()) + 4 * 60 * 60 * 1000).toISOString(),
    });

    // Connected to the relay, the coordinator is shown as connected.
    const socket = { send() {}, close() {} };
    relay.desktop(socket).message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token,
        capabilities: { roles: ['coordinator'], appVersion: 'test' },
      }),
    );
    const connected = (await app.inject({ method: 'GET', url, headers })).json() as AdminLiveView;
    expect(connected.live && connected.coordinator.connected).toBe(true);
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/workspaces', headers });
    expect(list.json().workspaces[0]).toMatchObject({ live: true, devices: 1 });

    time.advance(4 * 60 * 60 * 1000 + 1000);
    expect((await app.inject({ method: 'GET', url, headers })).json()).toEqual({ live: false });
  });
});

describe('devices', () => {
  it('lists devices with how they joined, renames, and revokes them at once', async () => {
    const { app, instance, signIn, relay } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    const { workspace, code } = instance.createWorkspace('North');
    instance.setCodesEnabled(workspace.id, true);
    const { device, token } = instance.enroll(code, 'Laptop')!;
    const socket = {
      closed: null as number | null,
      send() {},
      close(c?: number) {
        this.closed = c ?? 1000;
      },
    };
    relay.desktop(socket).message(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token,
        capabilities: { roles: ['coordinator'], appVersion: 'test' },
      }),
    );
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/devices', headers });
    expect(list.json().devices).toEqual([
      expect.objectContaining({
        id: device.id,
        workspaceName: 'North',
        name: 'Laptop',
        enrolledBy: 'code',
        approvedBy: null,
        connected: true,
        revokedAt: null,
      }),
    ]);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/devices/${device.id}`,
      headers,
      payload: { name: 'Projector PC' },
    });
    expect(instance.getDevice(device.id)?.name).toBe('Projector PC');
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/devices/${device.id}`,
      headers,
    });
    expect(revoked.json()).toEqual({ revoked: true });
    expect(socket.closed).toBe(4001);
    expect(instance.authenticate(token)).toBeNull();
  });
});

describe('church defaults', () => {
  it('shows, sets and unsets them with validation', async () => {
    const { app, signIn, instance } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    const set = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings',
      headers,
      payload: { key: 'linesPerPiece', value: 3 },
    });
    expect(set.json().settings).toEqual({ linesPerPiece: 3 });
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings',
      headers,
      payload: { key: 'linesPerPiece', value: 99 },
    });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings',
      headers,
      payload: { key: 'colour', value: 'red' },
    });
    expect(unknown.statusCode).toBe(400);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings',
      headers,
      payload: { key: 'linesPerPiece', value: null },
    });
    expect(instance.churchSettings()).toEqual({});
    const shown = await app.inject({ method: 'GET', url: '/api/v1/admin/settings', headers });
    expect(shown.json().keys).toContain('slideshowFontFamily');
  });
});

describe('the Church Library (D34, D37)', () => {
  it('lists church songs, deletes one recoverably, shows who uses it, and restores it', async () => {
    const { app, instance, signIn } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    const { workspace: a, code: codeA } = instance.createWorkspace('Managing');
    const { workspace: b, code: codeB } = instance.createWorkspace('North');
    instance.setCodesEnabled(a.id, true);
    instance.setCodesEnabled(b.id, true);
    instance.setManageLibrary(a.id, true);
    const da = instance.enroll(codeA, 'A')!.device;
    const db = instance.enroll(codeB, 'B')!.device;
    const stamp = '2026-11-01T00:00:00.000Z';
    instance.push(a.id, da.id, [
      {
        kind: 'song',
        id: 's1',
        key: 's1',
        revision: 1,
        updatedAt: stamp,
        data: { title: 'Holy', lyrics: 'a', removedAt: null },
      },
    ]);
    instance.push(b.id, db.id, [
      {
        kind: 'runSheet',
        id: 'rs1',
        key: '2026-11-08',
        revision: 2,
        updatedAt: stamp,
        data: { date: '2026-11-08', items: [{ id: 'i1', songId: 's1' }] },
      },
    ]);
    const listed = await app.inject({ method: 'GET', url: '/api/v1/admin/library/song', headers });
    expect(listed.json().items).toEqual([
      expect.objectContaining({
        id: 's1',
        title: 'Holy',
        removedAt: null,
        filesRemovedAt: null,
        fromWorkspace: { id: a.id, name: 'Managing' },
        fileName: null,
      }),
    ]);
    const usage = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/library/song/s1/usage',
      headers,
    });
    expect(usage.json()).toEqual({
      workspaces: [{ id: b.id, name: 'North', dates: ['2026-11-08'] }],
    });

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/library/song/s1',
      headers,
    });
    expect(deleted.json()).toEqual({ deleted: true });
    // The Deleted list says who deleted it; the last change still came from Managing.
    const afterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/library/song',
      headers,
    });
    expect(afterDelete.json().items[0]).toMatchObject({
      fromWorkspace: { id: a.id, name: 'Managing' },
      deletedBy: { administrator: 'pat@example.org' },
    });
    // Every workspace receives the removal on its next pull.
    const pulled = instance.pull(b.id, 0);
    expect(pulled.records.find((r) => r.kind === 'song')?.data.removedAt).toBe(instance.now());
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/v1/admin/library/song/s1', headers }))
        .statusCode,
    ).toBe(404);

    const restored = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/library/song/s1/restore',
      headers,
    });
    expect(restored.json()).toEqual({ restored: true });
    expect(instance.listChurch('song')[0]!.deletedBy).toBeNull();
    // A deletion by the managing workspace names it.
    instance.push(a.id, da.id, [
      {
        kind: 'song',
        id: 's1',
        key: 's1',
        revision: 10,
        updatedAt: '2026-11-03T00:00:00.000Z',
        data: { title: 'Holy', lyrics: 'a', removedAt: '2026-11-03T00:00:00.000Z' },
      },
    ]);
    expect(instance.listChurch('song')[0]!.deletedBy).toEqual({
      workspace: { id: a.id, name: 'Managing' },
    });
    instance.restoreChurch('song', 's1');
    expect(
      instance.pull(b.id, 0).records.find((r) => r.kind === 'song')?.data.removedAt,
    ).toBeNull();
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/admin/library/song/s1/restore', headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/library/videos', headers }))
        .statusCode,
    ).toBe(400);
  });

  it('names the workspaces whose songs or output settings use a background', async () => {
    const { instance } = await setup({ administrators: ['pat@example.org'] });
    const { workspace: a } = instance.createWorkspace('Managing');
    const { workspace: b } = instance.createWorkspace('North');
    const { workspace: c } = instance.createWorkspace('South');
    instance.setManageLibrary(a.id, true);
    const stamp = '2026-11-01T00:00:00.000Z';
    instance.push(a.id, 'da', [
      {
        kind: 'background',
        id: 'bg1',
        key: 'bg1',
        revision: 1,
        updatedAt: stamp,
        data: { kind: 'image', fileName: 'bg1.jpg', originalName: 'Sea.jpg', removedAt: null },
      },
    ]);
    instance.push(b.id, 'db', [
      {
        kind: 'setting',
        id: 'outputLook.slideshow',
        key: 'outputLook.slideshow',
        revision: 1,
        updatedAt: stamp,
        data: { value: { backgroundAssetId: 'bg1' } },
      },
    ]);
    instance.push(c.id, 'dc', [
      {
        kind: 'song',
        id: 'own',
        key: 'own',
        revision: 1,
        updatedAt: stamp,
        data: {
          title: 'Mine',
          lyrics: 'x',
          background: { color: '#000000', assetId: 'bg1' },
          removedAt: null,
        },
      },
    ]);
    expect(instance.churchUsage('background', 'bg1').workspaces.map((w) => w.name)).toEqual([
      'North',
      'South',
    ]);
    expect(instance.churchUsage('background', 'other').workspaces).toEqual([]);
  });
});

describe('storage (U11)', () => {
  it('reports space by kind of file and by workspace', async () => {
    const { app, instance, signIn, dataDir } = await setup({ administrators: ['pat@example.org'] });
    const { headers } = await signIn('pat@example.org');
    const { workspace } = instance.createWorkspace('North');
    const dir = workspaceFilesDir(dataDir, workspace.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bg-1.jpg'), 'ab');
    writeFileSync(join(dir, 'bg-2.mp4'), 'abcd');
    mkdirSync(join(dataDir, 'backups', workspace.id), { recursive: true });
    writeFileSync(join(dataDir, 'backups', workspace.id, 'one.worshipq'), 'abcdefgh');
    const report = await app.inject({ method: 'GET', url: '/api/v1/admin/storage', headers });
    const body = report.json();
    expect(body.totals).toMatchObject({
      backgroundImages: { bytes: 2, files: 1 },
      backgroundVideos: { bytes: 4, files: 1 },
      backups: { bytes: 8, files: 1 },
    });
    expect(body.workspaces).toEqual([
      expect.objectContaining({ id: workspace.id, name: 'North' }),
      expect.objectContaining({ id: 'church', name: 'Church Library' }),
    ]);
    expect(body.volume.totalBytes).toBeGreaterThan(0);
  });
});

describe('pairing from the device’s side (D29)', () => {
  const headers = {
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    'content-type': 'application/json',
  };

  it('starts a request, waits, and is approved into a workspace, handing the token over until it is used', async () => {
    const { app, instance, signIn } = await setup({ administrators: ['pat@example.org'] });
    const { workspace } = instance.createWorkspace('North');
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers: { ...headers, host: 'worship.example.org', 'x-forwarded-proto': 'https' },
      payload: { protocolVersion: PROTOCOL_VERSION, deviceName: 'Foyer laptop' },
    });
    const { secret, code, url, intervalMs } = started.json();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(url).toBe(`https://worship.example.org/admin/pair?code=${encodeURIComponent(code)}`);
    expect(intervalMs).toBe(5000);
    expect(JSON.stringify(started.json())).not.toContain(secret.slice(0, 8) + '"url');
    const poll = () =>
      app.inject({ method: 'POST', url: '/api/v1/pair/poll', headers, payload: { secret } });
    expect((await poll()).json()).toEqual({ status: 'pending' });

    const admin = await signIn('pat@example.org');
    const devices = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/devices',
      headers: admin.headers,
    });
    expect(devices.json().pending).toEqual([
      {
        code,
        deviceName: 'Foyer laptop',
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      },
    ]);
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/pairing/${code.toLowerCase()}/approve`,
      headers: admin.headers,
      payload: { workspaceId: workspace.id, name: 'Foyer' },
    });
    expect(approved.json().device).toMatchObject({ name: 'Foyer', workspaceId: workspace.id });

    const result = (await poll()).json();
    expect(result).toMatchObject({
      status: 'approved',
      deviceId: approved.json().device.id,
      workspace: { id: workspace.id, name: 'North' },
    });
    // An answer lost on the way can be asked for again, until the device uses its token.
    expect((await poll()).json()).toEqual(result);
    expect(instance.authenticate(result.deviceToken)).toMatchObject({
      name: 'Foyer',
      enrolledBy: 'pairing',
    });
    // Once used, the token is forgotten by the request.
    expect((await poll()).json()).toEqual({ status: 'expired' });
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/devices',
      headers: admin.headers,
    });
    expect(listed.json().devices[0]).toMatchObject({
      enrolledBy: 'pairing',
      approvedBy: 'pat@example.org',
    });
    expect(listed.json().pending).toEqual([]);
  });

  it('is refused, expires, and needs a compatible protocol', async () => {
    const { app, instance, signIn, time } = await setup({ administrators: ['pat@example.org'] });
    instance.createWorkspace('North');
    const admin = await signIn('pat@example.org');
    const one = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/pair',
        headers,
        payload: { protocolVersion: PROTOCOL_VERSION, deviceName: 'One' },
      })
    ).json();
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/pairing/${one.code}/refuse`,
      headers: admin.headers,
    });
    expect(refused.json()).toEqual({ refused: true });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/pair/poll',
          headers,
          payload: { secret: one.secret },
        })
      ).json(),
    ).toEqual({ status: 'refused' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/admin/pairing/${one.code}/refuse`,
          headers: admin.headers,
        })
      ).statusCode,
    ).toBe(404);

    const two = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/pair',
        headers,
        payload: { protocolVersion: PROTOCOL_VERSION, deviceName: 'Two' },
      })
    ).json();
    time.advance(16 * 60 * 1000);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/pair/poll',
          headers,
          payload: { secret: two.secret },
        })
      ).json(),
    ).toEqual({ status: 'expired' });
    const late = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/pairing/${two.code}/approve`,
      headers: admin.headers,
      payload: { workspaceId: instance.listWorkspaces()[0]!.id },
    });
    expect(late.statusCode).toBe(404);

    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers,
      payload: { protocolVersion: 1, deviceName: 'Old' },
    });
    expect(old.statusCode).toBe(426);
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/pair/poll',
      headers,
      payload: { secret: 'nope' },
    });
    expect(unknown.json()).toEqual({ status: 'expired' });
  });

  it('limits how many requests may wait, from one address and in all', async () => {
    const { app, instance, signIn } = await setup({ administrators: ['pat@example.org'] });
    const { workspace } = instance.createWorkspace('North');
    const ask = (from: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/pair',
        headers: { ...headers, 'x-forwarded-for': from },
        payload: { protocolVersion: PROTOCOL_VERSION, deviceName: 'Laptop' },
      });
    const first = [];
    for (let i = 0; i < PAIRING_MAX_PENDING_PER_ADDRESS; i++) {
      const started = await ask('203.0.113.7');
      expect(started.statusCode).toBe(200);
      first.push(started.json());
    }
    const refused = await ask('203.0.113.7');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: 'too-many-requests' });
    // Another address may still ask.
    expect((await ask('198.51.100.1')).statusCode).toBe(200);
    // Once one is decided, the address may ask again.
    const admin = await signIn('pat@example.org');
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/pairing/${first[0].code}/approve`,
      headers: admin.headers,
      payload: { workspaceId: workspace.id },
    });
    expect((await ask('203.0.113.7')).statusCode).toBe(200);

    // And there is a limit in all, whatever the addresses.
    for (let i = instance.listPairingRequests().length; i < PAIRING_MAX_PENDING; i++) {
      expect((await ask(`192.0.2.${i}`)).statusCode).toBe(200);
    }
    expect((await ask('192.0.2.250')).statusCode).toBe(429);
  });

  it('keeps connection codes working until the first administrator exists (D30)', async () => {
    const { app, instance } = await setup({ administrators: [] });
    const { workspace, code } = instance.createWorkspace('North');
    const enroll = (c: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/enroll',
        headers,
        payload: { protocolVersion: PROTOCOL_VERSION, code: c, deviceName: 'Laptop' },
      });
    expect((await enroll(code)).statusCode).toBe(200);
    expect((await enroll('WRONG-CODE-HERE')).json()).toEqual({ error: 'invalid-code' });
    instance.addAdministrator('pat@example.org', null);
    expect((await enroll(code)).json()).toEqual({ error: 'codes-off' });
    instance.setCodesEnabled(workspace.id, true);
    expect((await enroll(code)).statusCode).toBe(200);
  }, 15_000);
});
