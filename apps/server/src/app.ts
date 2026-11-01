/** The instance's HTTP and WebSocket interface. */
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  isCompatibleProtocol,
  LiveSnapshotSchema,
  MIN_PROTOCOL_VERSION,
  OutputKindSchema,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  PushRequestSchema,
  UPDATE_NEEDED,
  WorkspaceGrantSchema,
  type Deck,
  type EnrollResponse,
  type OutputLink,
  type PullResponse,
  type PushResponse,
} from '@worship-q/protocol';
import { z } from 'zod';
import { DECK_EXTENSIONS, type ConvertedDeck } from './decks/convert';
import { churchFilesDir, findFile, workspaceFilesDir } from './files';
import type { DeviceRow, Instance } from './instance';
import { Relay } from '@worship-q/relay';

export interface ServerConfig {
  instance: Instance;
  /** Where background files and backups are kept. */
  dataDir: string;
  /** Built remote-control page, served at /remote/; optional in tests. */
  remoteDir?: string;
  /** Built browser output pages, served at /output/; optional in tests. */
  outputDir?: string;
  name: string;
  /** Backups kept per workspace; older ones are removed. */
  keepBackups?: number;
  /**
   * Converts an uploaded slide deck into images in `outDir`; see `convertDeck`. Without it,
   * slide decks cannot be imported.
   */
  convertDeck?: (source: string, outDir: string, workDir: string) => Promise<ConvertedDeck>;
  logger?: boolean;
}

const BACKGROUND_NAME = /^[A-Za-z0-9-]{1,80}\.(jpg|jpeg|png|mp4)$/i;
/** A converted slide's image or its small copy; see the decks route. */
const DECK_IMAGE = /^deck-[0-9a-f-]{36}-\d{3,}(-t)?\.jpg$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const PING_MS = 25_000;

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceRow;
  }
}

export async function buildServer(config: ServerConfig) {
  const { instance } = config;
  const relay = new Relay(instance);
  const sweeper = setInterval(() => relay.sweep(), 30_000);
  sweeper.unref();
  const app = Fastify({
    logger: config.logger ?? false,
    bodyLimit: 16 * 1024 * 1024,
    // Behind CloudFront and a reverse proxy.
    trustProxy: true,
  });
  // New files of a workspace that manages the Church Library are the church's.
  const uploadDir = (workspaceId: string) =>
    instance.getWorkspace(workspaceId)?.manageLibrary
      ? churchFilesDir(config.dataDir)
      : workspaceFilesDir(config.dataDir, workspaceId);
  // One conversion at a time: LibreOffice is heavy, and its settings folder is shared.
  let conversions: Promise<unknown> = Promise.resolve();
  const queued = <T>(task: () => Promise<T>): Promise<T> => {
    const result = conversions.then(task, task);
    conversions = result.catch(() => undefined);
    return result;
  };
  const backupsDir = (workspaceId: string) => join(config.dataDir, 'backups', workspaceId);

  // Devices authenticate with a bearer token, never cookies, so any origin may call the API.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', PROTOCOL_HEADER],
    maxAge: 600,
  });
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

  // Files and backups arrive as a raw stream.
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
    done(null, payload),
  );

  const requireDevice = async (request: FastifyRequest, reply: FastifyReply) => {
    const version = Number(request.headers[PROTOCOL_HEADER]);
    if (!isCompatibleProtocol(version)) {
      return reply.code(426).send({ error: UPDATE_NEEDED, protocolVersion: PROTOCOL_VERSION });
    }
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const device = token ? instance.authenticate(token) : null;
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    request.device = device;
  };

  app.get('/api/v1/info', async () => ({
    name: config.name,
    protocolVersion: PROTOCOL_VERSION,
    minProtocolVersion: MIN_PROTOCOL_VERSION,
    /** Slide decks can be imported. */
    decks: config.convertDeck !== undefined,
    /** Browser output pages are served. */
    outputs: config.outputDir !== undefined,
  }));

  // What a browser output page is to look like, before it connects (M7.2, M7.4).
  app.get<{ Querystring: { t?: string } }>('/api/v1/output/look', async (request, reply) => {
    const link = instance.authenticateOutputLink(String(request.query.t ?? ''));
    if (!link) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('cache-control', 'no-store');
    return { kind: link.kind, look: instance.outputLook(link.workspaceId, link.kind) };
  });

  // Background files for browser output pages, which hold an output token rather than a
  // device token. File names carry a random identifier, and the files never change, so the
  // browser may keep them.
  app.get<{ Params: { name: string }; Querystring: { t?: string } }>(
    '/api/v1/output/files/:name',
    async (request, reply) => {
      const { name } = request.params;
      const link = instance.authenticateOutputLink(String(request.query.t ?? ''));
      if (!link) return reply.code(401).send({ error: 'unauthorized' });
      if (!BACKGROUND_NAME.test(name) && !DECK_IMAGE.test(name)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      const path = findFile(config.dataDir, link.workspaceId, name);
      if (!path) return reply.code(404).send({ error: 'not-found' });
      const etag = `"${name}"`;
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      reply.header('etag', etag);
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      reply.header('content-length', statSync(path).size);
      reply.type(
        name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.png') ? 'image/png' : 'image/jpeg',
      );
      return reply.send(createReadStream(path));
    },
  );

  // Slide images for phones, which have no device token. A deck image's name holds a random
  // identifier, so only someone shown the slides can name one.
  app.get<{ Params: { workspace: string; name: string } }>(
    '/api/v1/remote/files/:workspace/:name',
    async (request, reply) => {
      const { workspace, name } = request.params;
      if (!/^[0-9a-f-]{36}$/.test(workspace) || !DECK_IMAGE.test(name)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      const path = findFile(config.dataDir, workspace, name);
      if (!path) return reply.code(404).send({ error: 'not-found' });
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.header('content-length', statSync(path).size);
      reply.type('image/jpeg');
      return reply.send(createReadStream(path));
    },
  );

  app.post<{ Body: { protocolVersion?: number; code?: string; deviceName?: string } }>(
    '/api/v1/enroll',
    async (request, reply) => {
      const { protocolVersion, code, deviceName } = request.body ?? {};
      if (!isCompatibleProtocol(protocolVersion)) {
        return reply.code(426).send({ error: UPDATE_NEEDED, protocolVersion: PROTOCOL_VERSION });
      }
      const enrolled = instance.enroll(String(code ?? ''), String(deviceName ?? ''));
      if (!enrolled) {
        // Slows down guessing.
        await new Promise((done) => setTimeout(done, 1000));
        return reply.code(403).send({ error: 'invalid-code' });
      }
      const workspace = instance.getWorkspace(enrolled.device.workspaceId)!;
      return {
        deviceId: enrolled.device.id,
        deviceToken: enrolled.token,
        workspace: { id: workspace.id, name: workspace.name, contentId: workspace.contentId },
      } satisfies EnrollResponse;
    },
  );

  app.register(async (api) => {
    api.addHook('preHandler', requireDevice);

    api.get('/api/v1/workspace', async (request) => {
      const workspace = instance.getWorkspace(request.device!.workspaceId)!;
      return {
        id: workspace.id,
        name: workspace.name,
        contentId: workspace.contentId,
        deviceName: request.device!.name,
        manageLibrary: workspace.manageLibrary,
      };
    });

    /** The workspace's devices by token hash, for accepting them on the LAN (plan M5.3). */
    api.get('/api/v1/workspace/lan-credentials', async (request) => ({
      devices: instance.lanCredentials(request.device!.workspaceId),
    }));

    /** Every desktop and output of the workspace connected to the relay (D20). */
    api.get('/api/v1/workspace/peers', async (request) => ({
      peers: relay.peers(request.device!.workspaceId),
      coordinatorName: relay.coordinatorName(request.device!.workspaceId),
    }));

    // ── Live state backup (D17, D18) ───────────────────────────────────────

    api.put('/api/v1/live', async (request, reply) => {
      const parsed = z
        .object({ snapshot: LiveSnapshotSchema, grants: z.array(WorkspaceGrantSchema).default([]) })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid-snapshot' });
      const device = request.device!;
      const stored = instance.putLive(
        device.workspaceId,
        device.id,
        parsed.data.snapshot,
        parsed.data.grants,
      );
      return { stored };
    });

    api.get('/api/v1/live', async (request) => {
      const live = instance.getLive(request.device!.workspaceId);
      return live ?? { snapshot: null, grants: [], deviceId: null, updatedAt: null };
    });

    // ── Browser output links (D22) ─────────────────────────────────────────

    const outputUrl = (request: FastifyRequest, kind: string, token: string) =>
      `${request.protocol}://${request.host}/output/${kind}?t=${encodeURIComponent(token)}`;

    api.get('/api/v1/outputs', async (request) => ({
      links: instance
        .listOutputLinks(request.device!.workspaceId)
        .map(
          ({ id, kind, name, createdAt }) => ({ id, kind, name, createdAt }) satisfies OutputLink,
        ),
    }));

    api.post<{ Body: { kind?: string; name?: string } }>(
      '/api/v1/outputs',
      async (request, reply) => {
        const kind = OutputKindSchema.safeParse(request.body?.kind);
        if (!kind.success) return reply.code(400).send({ error: 'invalid-kind' });
        const { link, token } = instance.createOutputLink(
          request.device!.workspaceId,
          kind.data,
          String(request.body?.name ?? ''),
        );
        return {
          id: link.id,
          kind: link.kind,
          name: link.name,
          createdAt: link.createdAt,
          url: outputUrl(request, link.kind, token),
        } satisfies OutputLink;
      },
    );

    api.delete<{ Params: { id: string } }>('/api/v1/outputs/:id', async (request) => {
      const revoked = instance.revokeOutputLinks(
        request.device!.workspaceId,
        request.params.id === 'all' ? undefined : request.params.id,
      );
      for (const id of revoked) relay.outputRevoked(id);
      return { revoked };
    });

    api.post<{ Body: { contentId?: string } }>('/api/v1/claim', async (request, reply) => {
      const contentId = String(request.body?.contentId ?? '');
      if (!contentId) return reply.code(400).send({ error: 'missing-content-id' });
      return { contentId: instance.claimContent(request.device!.workspaceId, contentId) };
    });

    api.post('/api/v1/sync/push', async (request, reply) => {
      const parsed = PushRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid-records' });
      const device = request.device!;
      const { remap, stored, central } = instance.push(
        device.workspaceId,
        device.id,
        parsed.data.records,
      );
      // The Church Library reaches every workspace.
      if (central > 0) relay.contentChangedAll(device.id);
      else if (stored > 0) relay.contentChanged(device.workspaceId, device.id);
      return { remap } satisfies PushResponse;
    });

    api.get<{ Querystring: { since?: string } }>('/api/v1/sync/pull', async (request) => {
      const since = Math.max(0, Number(request.query.since ?? 0) || 0);
      const page = instance.pull(request.device!.workspaceId, since);
      return { ...page, church: instance.churchSettings() } satisfies PullResponse;
    });

    api.put<{ Params: { name: string } }>('/api/v1/files/:name', async (request, reply) => {
      const { name } = request.params;
      if (!BACKGROUND_NAME.test(name)) return reply.code(400).send({ error: 'invalid-name' });
      const dir = uploadDir(request.device!.workspaceId);
      mkdirSync(dir, { recursive: true });
      await receive(request.body as Readable, join(dir, name));
      return { stored: true };
    });

    api.get<{ Params: { name: string } }>('/api/v1/files/:name', async (request, reply) => {
      const { name } = request.params;
      if (!BACKGROUND_NAME.test(name)) return reply.code(400).send({ error: 'invalid-name' });
      const path = findFile(config.dataDir, request.device!.workspaceId, name);
      if (!path) return reply.code(404).send({ error: 'not-found' });
      reply.header('content-length', statSync(path).size);
      reply.type('application/octet-stream');
      return reply.send(createReadStream(path));
    });

    // Converts a slide deck into images kept with the workspace's files, and describes them.
    // The device then fetches the images and saves the deck as a song.
    api.post<{ Querystring: { name?: string } }>('/api/v1/decks', async (request, reply) => {
      const convert = config.convertDeck;
      if (!convert) return reply.code(501).send({ error: 'decks-unavailable' });
      const source = basename(String(request.query.name ?? '')) || 'slides.pptx';
      const extension = extname(source).toLowerCase();
      if (!DECK_EXTENSIONS.includes(extension)) {
        return reply.code(400).send({ error: 'unsupported-format' });
      }
      const id = randomUUID();
      const work = join(config.dataDir, 'work', id);
      mkdirSync(work, { recursive: true });
      try {
        const upload = join(work, `upload${extension}`);
        await receive(request.body as Readable, upload);
        const out = join(work, 'out');
        const converted = await queued(() => convert(upload, out, join(work, 'convert')));
        const dir = uploadDir(request.device!.workspaceId);
        mkdirSync(dir, { recursive: true });
        const pages: Deck['pages'] = [];
        for (const page of converted.pages) {
          const image = `deck-${id}-${page.image}`;
          const thumbnail = `deck-${id}-${page.image.replace(/\.jpg$/, '-t.jpg')}`;
          await rename(join(out, page.image), join(dir, image));
          await rename(join(out, page.thumbnail), join(dir, thumbnail));
          pages.push({ image, thumbnail, slide: page.slide, step: page.step, text: page.text });
        }
        // Kept so the deck can be converted again later. Its name holds the same identifier
        // as the deck's images, and no route serves it.
        await rename(upload, join(dir, `deck-${id}-original${extension}`));
        return {
          source,
          width: converted.width,
          height: converted.height,
          pages,
        } satisfies Deck;
      } catch (error) {
        request.log.error(error);
        return reply.code(422).send({
          error: 'conversion-failed',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });

    api.put('/api/v1/backups', async (request) => {
      const device = request.device!;
      const dir = backupsDir(device.workspaceId);
      mkdirSync(dir, { recursive: true });
      const file = `${new Date().toISOString().replace(/[:.]/g, '-')}-${device.id}.worshipq`;
      await receive(request.body as Readable, join(dir, file));
      const id = instance.addBackup(
        device.workspaceId,
        device.id,
        file,
        statSync(join(dir, file)).size,
      );
      // Keep the most recent ones.
      for (const old of instance.listBackups(device.workspaceId).slice(config.keepBackups ?? 30)) {
        rmSync(join(dir, old.file), { force: true });
        instance.removeBackup(old.id);
      }
      return { id };
    });

    api.get('/api/v1/backups', async (request) =>
      instance
        .listBackups(request.device!.workspaceId)
        .map(({ id, size, createdAt, deviceId }) => ({
          id,
          size,
          createdAt,
          deviceId,
        })),
    );

    api.get<{ Params: { id: string } }>('/api/v1/backups/:id', async (request, reply) => {
      const backup = instance
        .listBackups(request.device!.workspaceId)
        .find((b) => b.id === request.params.id);
      const path = backup ? join(backupsDir(request.device!.workspaceId), backup.file) : '';
      if (!backup || !existsSync(path)) return reply.code(404).send({ error: 'not-found' });
      reply.header('content-length', statSync(path).size);
      reply.type('application/octet-stream');
      return reply.send(createReadStream(path));
    });
  });

  // ── Live connections ─────────────────────────────────────────────────────

  const keepAlive = (socket: import('ws').WebSocket) => {
    let alive = true;
    socket.on('pong', () => (alive = true));
    const timer = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, PING_MS);
    socket.on('close', () => clearInterval(timer));
  };

  app.get('/api/v1/coordinator', { websocket: true }, (socket) => {
    keepAlive(socket);
    const handlers = relay.desktop(socket);
    socket.on('message', (raw) => handlers.message(raw));
    socket.on('close', () => handlers.close());
  });

  app.get('/api/v1/remote', { websocket: true }, (socket) => {
    keepAlive(socket);
    const handlers = relay.remote(socket);
    socket.on('message', (raw) => handlers.message(raw));
    socket.on('close', () => handlers.close());
  });

  app.get('/api/v1/output', { websocket: true }, (socket) => {
    keepAlive(socket);
    const handlers = relay.output(socket);
    socket.on('message', (raw) => handlers.message(raw));
    socket.on('close', () => handlers.close());
  });

  // ── Remote-control page ──────────────────────────────────────────────────

  if (config.remoteDir && existsSync(config.remoteDir)) {
    await app.register(fastifyStatic, {
      root: resolve(config.remoteDir),
      prefix: '/remote/',
      // Hashed assets never change; the page itself is checked every time.
      setHeaders: (reply, path) =>
        reply.header(
          'cache-control',
          path.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        ),
    });
    app.get('/remote', (_request, reply) => reply.redirect('/remote/'));
  }
  // ── Browser output pages ─────────────────────────────────────────────────

  if (config.outputDir && existsSync(config.outputDir)) {
    await app.register(fastifyStatic, {
      root: resolve(config.outputDir),
      prefix: '/output/',
      decorateReply: false,
      setHeaders: (reply, path) =>
        reply.header(
          'cache-control',
          path.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        ),
    });
    // One page for both outputs; the path says which (D22).
    const page = join(resolve(config.outputDir), 'index.html');
    for (const kind of ['slideshow', 'subtitle']) {
      app.get(`/output/${kind}`, (_request, reply) => {
        reply.header('cache-control', 'no-cache');
        reply.type('text/html');
        return reply.send(createReadStream(page));
      });
    }
  }
  app.get('/', async () => ({ name: config.name, app: 'worship-q' }));
  app.addHook('onClose', async () => clearInterval(sweeper));

  return { app, relay };
}

/** Writes an upload to a temporary file and moves it into place once complete. */
async function receive(body: Readable, target: string): Promise<void> {
  const partial = `${target}.partial`;
  let size = 0;
  body.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_FILE_BYTES) body.destroy(new Error('too-large'));
  });
  try {
    await pipeline(body, createWriteStream(partial));
    await rename(partial, target);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}
