/**
 * The admin web app's routes (phase 3): sign-in through the church's OIDC provider, and
 * everything an administrator does, under `/api/v1/admin/`. Authenticated by a session
 * cookie, never a device token; every request must also carry `ADMIN_HEADER`, which a
 * cross-site form cannot add (decision D35). Browser pages are served at `/admin/`.
 */
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DEFAULT_EXPIRY_MS } from '@worship-q/live-state';
import {
  ADMIN_HEADER,
  ChurchSettingsSchema,
  LIBRARY_TYPES,
  libraryTypes,
  type AdminDevice,
  type AdminLibraryItem,
  type AdminLiveView,
  type AdminMe,
  type AdminWorkspace,
  type LibraryKind,
} from '@worship-q/protocol';
import type { Relay } from '@worship-q/relay';
import { parseQuery, rankSong, songKeys, type SongKeys } from '@worship-q/search';
import { z } from 'zod';
import { churchFilesDir, findFile, moveFilesToChurch } from './files';
import { formatPairingCode, type AdministratorRow, type Instance } from './instance';
import { CALLBACK_PATH, OidcError, type OidcClient } from './oidc';
import { sendFile } from './ranges';
import { storageReport } from './storage';

export const SESSION_COOKIE = 'wq_admin';

export interface AdminConfig {
  instance: Instance;
  relay: Relay;
  /** Null when sign-in is not configured; the routes then say so. */
  oidc: OidcClient | null;
  dataDir: string;
  name: string;
  /** Built admin pages, served at /admin/; optional in tests. */
  adminDir?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdministratorRow;
  }
}

const KIND = z.enum(['song', 'background']);

/** Names of Church Library files the admin app may show: backgrounds and slide images. */
const LIBRARY_FILE =
  /^(?:[A-Za-z0-9-]{1,80}\.(?:jpg|jpeg|png|mp4)|deck-[0-9a-f-]{36}-\d{3,}(?:-t)?\.jpg)$/i;

/** The session token in the request's cookies, if any. */
export function sessionToken(request: FastifyRequest): string {
  const header = request.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function cookie(request: FastifyRequest, token: string, maxAge: number): string {
  const secure = request.protocol === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Only a page of the admin app may be returned to after sign-in. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/admin(\/|\?|#|$)/.test(value) && !value.startsWith('//')
    ? value
    : '/admin/';
}

export async function registerAdminRoutes(app: FastifyInstance, config: AdminConfig) {
  const { instance, relay, oidc } = config;

  // ── Sign-in (D27, D28) ───────────────────────────────────────────────────

  app.get<{ Querystring: { returnTo?: string } }>('/auth/login', async (request, reply) => {
    if (!oidc) return reply.code(503).send({ error: 'sign-in-not-configured' });
    try {
      const { url, state, verifier, nonce } = await oidc.beginSignIn();
      instance.putAuthState(state, verifier, nonce, safeReturnTo(request.query.returnTo));
      return reply.redirect(url, 302);
    } catch (error) {
      request.log.error(error);
      return reply.redirect('/admin/?error=provider-unreachable', 302);
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    CALLBACK_PATH,
    async (request, reply) => {
      if (!oidc) return reply.code(503).send({ error: 'sign-in-not-configured' });
      const { code, state, error } = request.query;
      const pending = state ? instance.takeAuthState(state) : null;
      if (error || !code || !pending) return reply.redirect('/admin/?error=sign-in-failed', 302);
      let claims;
      try {
        claims = await oidc.finishSignIn(code, pending.verifier, pending.nonce);
      } catch (cause) {
        request.log.warn(cause instanceof OidcError ? cause.message : cause);
        return reply.redirect('/admin/?error=sign-in-failed', 302);
      }
      // An address the provider says is unverified proves nothing (D28).
      if (!claims.email || claims.emailVerified === false) {
        return reply.redirect('/admin/?error=no-email', 302);
      }
      const signedIn = instance.signIn(claims.email, claims.subject, claims.name);
      if (!signedIn) return reply.redirect('/admin/?error=not-administrator', 302);
      reply.header('set-cookie', cookie(request, signedIn.token, 8 * 60 * 60));
      return reply.redirect(pending.returnTo, 302);
    },
  );

  const requireHeader = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers[ADMIN_HEADER] === undefined) {
      return reply.code(403).send({ error: 'missing-header' });
    }
  };

  app.post('/auth/logout', { preHandler: requireHeader }, async (request, reply) => {
    instance.signOut(sessionToken(request));
    reply.header('set-cookie', cookie(request, '', 0));
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/me', { preHandler: requireHeader }, async (request) => {
    const admin = instance.authenticateSession(sessionToken(request));
    return {
      configured: oidc !== null,
      hasAdministrators: instance.hasAdministrators(),
      admin: admin ? { id: admin.id, email: admin.email, name: admin.name } : null,
      name: config.name,
    } satisfies AdminMe;
  });

  // Church Library files for the admin app's preview. Images and videos are loaded by the
  // browser, which cannot add `ADMIN_HEADER`, so the session cookie alone is enough here;
  // the route only reads.
  app.get<{ Params: { name: string } }>('/api/v1/admin/files/:name', async (request, reply) => {
    if (!instance.authenticateSession(sessionToken(request))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { name } = request.params;
    if (!LIBRARY_FILE.test(name)) return reply.code(404).send({ error: 'not-found' });
    const path = join(churchFilesDir(config.dataDir), name);
    if (!existsSync(path)) return reply.code(404).send({ error: 'not-found' });
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    return sendFile(request, reply, path, name);
  });

  // A workspace's files (backgrounds and slide images), for the live view's drawing of its
  // outputs. Like the Church Library files above, the session cookie alone admits them.
  app.get<{ Params: { id: string; name: string } }>(
    '/api/v1/admin/workspaces/:id/files/:name',
    async (request, reply) => {
      if (!instance.authenticateSession(sessionToken(request))) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const { id, name } = request.params;
      if (!LIBRARY_FILE.test(name) || !instance.getWorkspace(id)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      const path = findFile(config.dataDir, id, name);
      if (!path) return reply.code(404).send({ error: 'not-found' });
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      return sendFile(request, reply, path, name);
    },
  );

  // ── Everything else needs a signed-in administrator ──────────────────────

  await app.register(async (api) => {
    api.addHook('preHandler', async (request, reply) => {
      if (request.headers[ADMIN_HEADER] === undefined) {
        return reply.code(403).send({ error: 'missing-header' });
      }
      const admin = instance.authenticateSession(sessionToken(request));
      if (!admin) return reply.code(401).send({ error: 'unauthorized' });
      request.admin = admin;
    });

    const connectedIds = () =>
      new Set(
        instance
          .listWorkspaces()
          .flatMap((w) => relay.peers(w.id))
          .filter((p) => p.role !== 'output')
          .map((p) => p.deviceId),
      );

    const adminEmail = (id: string | null) =>
      id ? (instance.getAdministrator(id)?.email ?? id) : null;

    // ── Workspaces ─────────────────────────────────────────────────────────

    const workspaceView = (w: ReturnType<Instance['listWorkspaces']>[number]): AdminWorkspace => ({
      id: w.id,
      name: w.name,
      contentId: w.contentId,
      libraryTypes: w.libraryTypes,
      codesEnabled: w.codesEnabled,
      devices: instance.listDevices(w.id).filter((d) => !d.revokedAt).length,
      createdAt: w.createdAt,
      live: instance.getLive(w.id) !== null,
    });

    api.get('/api/v1/admin/workspaces', async () => ({
      workspaces: instance.listWorkspaces().map(workspaceView),
    }));

    api.post<{ Body: { name?: string } }>('/api/v1/admin/workspaces', async (request, reply) => {
      const name = String(request.body?.name ?? '').trim();
      if (!name) return reply.code(400).send({ error: 'name-required' });
      const { workspace, code } = instance.createWorkspace(name);
      return { workspace: workspaceView(workspace), code };
    });

    api.patch<{ Params: { id: string }; Body: { name?: string; codesEnabled?: boolean } }>(
      '/api/v1/admin/workspaces/:id',
      async (request, reply) => {
        const workspace = instance.getWorkspace(request.params.id);
        if (!workspace) return reply.code(404).send({ error: 'not-found' });
        const { name, codesEnabled } = request.body ?? {};
        if (typeof name === 'string') {
          if (!name.trim()) return reply.code(400).send({ error: 'name-required' });
          instance.renameWorkspace(workspace.id, name);
        }
        if (typeof codesEnabled === 'boolean') instance.setCodesEnabled(workspace.id, codesEnabled);
        return { workspace: workspaceView(instance.getWorkspace(workspace.id)!) };
      },
    );

    /** A new connection code; the old one stops working at once. */
    api.post<{ Params: { id: string } }>(
      '/api/v1/admin/workspaces/:id/code',
      async (request, reply) => {
        if (!instance.getWorkspace(request.params.id)) {
          return reply.code(404).send({ error: 'not-found' });
        }
        return { code: instance.rotateCode(request.params.id) };
      },
    );

    /** What turning on management of some types would do (D36); `types` is comma-separated. */
    api.get<{ Params: { id: string }; Querystring: { types?: string } }>(
      '/api/v1/admin/workspaces/:id/library-plan',
      async (request, reply) => {
        if (!instance.getWorkspace(request.params.id)) {
          return reply.code(404).send({ error: 'not-found' });
        }
        const types =
          request.query.types === undefined
            ? LIBRARY_TYPES
            : libraryTypes(request.query.types.split(','));
        return instance.libraryPlan(request.params.id, types);
      },
    );

    /**
     * Sets which Church Library types the workspace manages (D36); the plan for the types
     * turned on was shown and confirmed first.
     */
    api.post<{ Params: { id: string }; Body: { types?: unknown } }>(
      '/api/v1/admin/workspaces/:id/library',
      async (request, reply) => {
        const workspace = instance.getWorkspace(request.params.id);
        if (!workspace) return reply.code(404).send({ error: 'not-found' });
        const requested = request.body?.types;
        if (!Array.isArray(requested)) return reply.code(400).send({ error: 'invalid-types' });
        const types = libraryTypes(requested);
        let moved = 0;
        if (types.join() !== workspace.libraryTypes.join()) {
          const files = instance.setLibraryTypes(workspace.id, types);
          moved = moveFilesToChurch(config.dataDir, workspace.id, files);
          relay.contentChangedAll('');
        }
        return { workspace: workspaceView(instance.getWorkspace(workspace.id)!), moved };
      },
    );

    /** The workspace's live state as the server last heard of it (D38). */
    api.get<{ Params: { id: string } }>(
      '/api/v1/admin/workspaces/:id/live',
      async (request, reply) => {
        const workspace = instance.getWorkspace(request.params.id);
        if (!workspace) return reply.code(404).send({ error: 'not-found' });
        reply.header('cache-control', 'no-store');
        const live = instance.getLive(workspace.id);
        if (!live) return { live: false } satisfies AdminLiveView;
        const coordinatorId = live.snapshot.coordinatorId;
        const assetId = live.snapshot.presented?.background?.assetId ?? null;
        const peer = relay.peers(workspace.id).find((p) => p.deviceId === coordinatorId);
        return {
          live: true,
          snapshot: live.snapshot,
          coordinator: {
            deviceId: coordinatorId,
            name: peer?.name ?? instance.getDevice(coordinatorId)?.name ?? null,
            connected: peer !== undefined,
          },
          updatedAt: live.updatedAt,
          expiresAt: new Date(
            Date.parse(live.snapshot.state.lastActiveAt) + DEFAULT_EXPIRY_MS,
          ).toISOString(),
          looks: {
            slideshow: instance.outputLook(workspace.id, 'slideshow'),
            subtitle: instance.outputLook(workspace.id, 'subtitle'),
          },
          songBackground: assetId ? instance.backgroundFile(workspace.id, assetId) : null,
        } satisfies AdminLiveView;
      },
    );

    // ── Devices and pairing (D29, D30) ─────────────────────────────────────

    api.get('/api/v1/admin/devices', async () => {
      const names = new Map(instance.listWorkspaces().map((w) => [w.id, w.name]));
      const connected = connectedIds();
      return {
        devices: instance.listDevices().map((d): AdminDevice => ({
          id: d.id,
          workspaceId: d.workspaceId,
          workspaceName: names.get(d.workspaceId) ?? '',
          name: d.name,
          createdAt: d.createdAt,
          lastSeenAt: d.lastSeenAt,
          revokedAt: d.revokedAt,
          enrolledBy: d.enrolledBy,
          approvedBy: adminEmail(d.approvedBy),
          connected: connected.has(d.id),
        })),
        pending: instance.listPairingRequests().map((r) => ({
          ...r,
          code: formatPairingCode(r.code),
        })),
      };
    });

    api.patch<{ Params: { id: string }; Body: { name?: string } }>(
      '/api/v1/admin/devices/:id',
      async (request, reply) => {
        const name = String(request.body?.name ?? '').trim();
        if (!name) return reply.code(400).send({ error: 'name-required' });
        if (!instance.getDevice(request.params.id)) {
          return reply.code(404).send({ error: 'not-found' });
        }
        instance.renameDevice(request.params.id, name);
        return { renamed: true };
      },
    );

    api.delete<{ Params: { id: string } }>('/api/v1/admin/devices/:id', async (request) => {
      const revoked = instance.revokeDevice(request.params.id);
      if (revoked) relay.deviceRevoked(request.params.id);
      return { revoked };
    });

    api.post<{ Params: { code: string }; Body: { workspaceId?: string; name?: string } }>(
      '/api/v1/admin/pairing/:code/approve',
      async (request, reply) => {
        const workspaceId = String(request.body?.workspaceId ?? '');
        if (!instance.getWorkspace(workspaceId)) {
          return reply.code(400).send({ error: 'workspace-required' });
        }
        const device = instance.approvePairing(
          request.params.code,
          workspaceId,
          typeof request.body?.name === 'string' ? request.body.name : null,
          request.admin!.id,
        );
        if (!device) return reply.code(404).send({ error: 'not-pending' });
        return { device: { id: device.id, name: device.name, workspaceId: device.workspaceId } };
      },
    );

    api.post<{ Params: { code: string } }>(
      '/api/v1/admin/pairing/:code/refuse',
      async (request, reply) => {
        if (!instance.refusePairing(request.params.code, request.admin!.id)) {
          return reply.code(404).send({ error: 'not-pending' });
        }
        return { refused: true };
      },
    );

    // ── Administrators (D28) ───────────────────────────────────────────────

    const administratorView = (a: AdministratorRow) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      addedBy: adminEmail(a.addedBy),
      createdAt: a.createdAt,
      lastSignInAt: a.lastSignInAt,
    });

    api.get('/api/v1/admin/administrators', async () => ({
      administrators: instance.listAdministrators().map(administratorView),
    }));

    api.post<{ Body: { email?: string } }>(
      '/api/v1/admin/administrators',
      async (request, reply) => {
        try {
          const added = instance.addAdministrator(
            String(request.body?.email ?? ''),
            request.admin!.id,
          );
          return { administrator: administratorView(added) };
        } catch {
          return reply.code(400).send({ error: 'invalid-email' });
        }
      },
    );

    api.delete<{ Params: { id: string } }>(
      '/api/v1/admin/administrators/:id',
      async (request, reply) => {
        try {
          const removed = instance.removeAdministrator(request.params.id);
          if (!removed) return reply.code(404).send({ error: 'not-found' });
          return { removed: true };
        } catch {
          return reply.code(409).send({ error: 'last-administrator' });
        }
      },
    );

    // ── Church defaults ────────────────────────────────────────────────────

    api.get('/api/v1/admin/settings', async () => ({
      settings: instance.churchSettings(),
      keys: Object.keys(ChurchSettingsSchema.shape),
    }));

    api.put<{ Body: { key?: string; value?: unknown } }>(
      '/api/v1/admin/settings',
      async (request, reply) => {
        const key = String(request.body?.key ?? '');
        if (!(key in ChurchSettingsSchema.shape)) {
          return reply.code(400).send({ error: 'unknown-setting' });
        }
        try {
          if (request.body?.value === null || request.body?.value === undefined) {
            instance.unsetChurchSetting(key);
          } else {
            instance.setChurchSetting(key, request.body.value);
          }
        } catch {
          return reply.code(400).send({ error: 'invalid-value' });
        }
        relay.contentChangedAll('');
        return { settings: instance.churchSettings() };
      },
    );

    // ── The Church Library (D34, D37) ──────────────────────────────────────

    /** Search keys of Church Library items, kept until the item changes. */
    const searchKeys = new Map<string, { revision: number; keys: SongKeys }>();
    /** `workspaceId` is null for the church's items. */
    const keysOf = (workspaceId: string | null, item: AdminLibraryItem) => {
      const cacheKey = `${workspaceId ?? ''}:${item.kind}:${item.id}`;
      const cached = searchKeys.get(cacheKey);
      if (cached?.revision === item.revision) return cached.keys;
      let content = null;
      if (item.kind === 'song') {
        // A hidden church song is searched by what the church has.
        content =
          workspaceId === null
            ? instance.churchContent(item.kind, item.id)
            : item.change?.type === 'hidden'
              ? instance.churchContent(item.kind, item.change.churchId)
              : instance.workspaceContent(workspaceId, item.kind, item.id);
      }
      const lyrics =
        content && 'lyrics' in content ? [content.lyrics, content.websiteUrl ?? ''].join('\n') : '';
      const keys = songKeys({ title: item.title, lyrics });
      searchKeys.set(cacheKey, { revision: item.revision, keys });
      return keys;
    };
    // As the desktop's song search: by characters in either script, pinyin or initials, in
    // the title before the lyrics; ties keep the newest change first.
    const search = (workspaceId: string | null, items: AdminLibraryItem[], q: unknown) => {
      const terms = parseQuery(String(q ?? ''));
      if (terms.length === 0) return items;
      return items
        .map((item) => ({ item, rank: rankSong(terms, keysOf(workspaceId, item)) }))
        .filter((entry) => entry.rank !== null)
        .sort((a, b) => a.rank! - b.rank!)
        .map((entry) => entry.item);
    };

    api.get<{ Params: { kind: string }; Querystring: { q?: string } }>(
      '/api/v1/admin/library/:kind',
      async (request, reply) => {
        const kind = KIND.safeParse(request.params.kind);
        if (!kind.success) return reply.code(400).send({ error: 'invalid-kind' });
        const items = instance.listChurch(kind.data as LibraryKind);
        return { items: search(null, items, request.query.q) };
      },
    );

    /** How one workspace's songs or backgrounds differ from the Church Library. */
    api.get<{ Params: { id: string; kind: string }; Querystring: { q?: string } }>(
      '/api/v1/admin/workspaces/:id/library/:kind',
      async (request, reply) => {
        const kind = KIND.safeParse(request.params.kind);
        if (!kind.success) return reply.code(400).send({ error: 'invalid-kind' });
        if (!instance.getWorkspace(request.params.id)) {
          return reply.code(404).send({ error: 'not-found' });
        }
        const items = instance.listWorkspaceLibrary(request.params.id, kind.data as LibraryKind);
        return { items: search(request.params.id, items, request.query.q) };
      },
    );

    api.get<{ Params: { id: string; kind: string; itemId: string } }>(
      '/api/v1/admin/workspaces/:id/library/:kind/:itemId',
      async (request, reply) => {
        const kind = KIND.safeParse(request.params.kind);
        if (!kind.success) return reply.code(400).send({ error: 'invalid-kind' });
        const content = instance.workspaceContent(
          request.params.id,
          kind.data as LibraryKind,
          request.params.itemId,
        );
        if (!content) return reply.code(404).send({ error: 'not-found' });
        return content;
      },
    );

    api.get<{ Params: { kind: string; id: string } }>(
      '/api/v1/admin/library/:kind/:id',
      async (request, reply) => {
        const kind = KIND.safeParse(request.params.kind);
        if (!kind.success) return reply.code(400).send({ error: 'invalid-kind' });
        const content = instance.churchContent(kind.data as LibraryKind, request.params.id);
        if (!content) return reply.code(404).send({ error: 'not-found' });
        return content;
      },
    );

    api.get<{ Params: { kind: string; id: string } }>(
      '/api/v1/admin/library/:kind/:id/usage',
      async (request, reply) => {
        const kind = KIND.safeParse(request.params.kind);
        if (!kind.success) return reply.code(400).send({ error: 'invalid-kind' });
        return instance.churchUsage(kind.data as LibraryKind, request.params.id);
      },
    );

    api.delete<{ Params: { kind: string; id: string } }>(
      '/api/v1/admin/library/:kind/:id',
      async (request, reply) => {
        const kind = KIND.safeParse(request.params.kind);
        if (!kind.success) return reply.code(400).send({ error: 'invalid-kind' });
        const deleted = instance.deleteChurch(
          kind.data as LibraryKind,
          request.params.id,
          request.admin!.id,
        );
        if (!deleted) return reply.code(404).send({ error: 'not-found' });
        relay.contentChangedAll('');
        return { deleted: true };
      },
    );

    api.post<{ Params: { kind: string; id: string } }>(
      '/api/v1/admin/library/:kind/:id/restore',
      async (request, reply) => {
        const kind = KIND.safeParse(request.params.kind);
        if (!kind.success) return reply.code(400).send({ error: 'invalid-kind' });
        const result = instance.restoreChurch(kind.data as LibraryKind, request.params.id);
        if (result === 'not-deleted') return reply.code(404).send({ error: 'not-deleted' });
        if (result === 'files-removed') return reply.code(409).send({ error: 'files-removed' });
        relay.contentChangedAll('');
        return { restored: true };
      },
    );

    // ── Storage (U11) ──────────────────────────────────────────────────────

    api.get('/api/v1/admin/storage', async () => storageReport(instance, config.dataDir));
  });

  // ── The pages ────────────────────────────────────────────────────────────

  if (config.adminDir && existsSync(config.adminDir)) {
    const root = resolve(config.adminDir);
    await app.register(fastifyStatic, {
      root,
      prefix: '/admin/',
      decorateReply: false,
      wildcard: false,
      setHeaders: (reply, path) =>
        reply.header(
          'cache-control',
          path.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        ),
    });
    const page = join(root, 'index.html');
    // The app routes in the browser: every page path gets the one page.
    const serve = (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'no-cache');
      reply.type('text/html');
      return reply.send(createReadStream(page));
    };
    app.get('/admin', (_request, reply) => reply.redirect('/admin/'));
    app.get('/admin/*', (request, reply) => {
      if (extname(request.url.split('?')[0] ?? '')) return reply.code(404).send();
      return serve(request, reply);
    });
  }
}
