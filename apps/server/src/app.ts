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
  MIN_PROTOCOL_VERSION,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  PushRequestSchema,
  UPDATE_NEEDED,
  type Deck,
  type EnrollResponse,
  type PullResponse,
  type PushResponse,
} from '@worship-q/protocol';
import { DECK_EXTENSIONS, type ConvertedDeck } from './decks/convert';
import type { DeviceRow, Instance } from './instance';
import { Relay } from './relay';

export interface ServerConfig {
  instance: Instance;
  /** Where background files and backups are kept. */
  dataDir: string;
  /** Built remote-control page, served at /remote/; optional in tests. */
  remoteDir?: string;
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
  const filesDir = (workspaceId: string) => join(config.dataDir, 'files', workspaceId);
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
  }));

  // Slide images for phones, which have no device token. A deck image's name holds a random
  // identifier, so only someone shown the slides can name one.
  app.get<{ Params: { workspace: string; name: string } }>(
    '/api/v1/remote/files/:workspace/:name',
    async (request, reply) => {
      const { workspace, name } = request.params;
      if (!/^[0-9a-f-]{36}$/.test(workspace) || !DECK_IMAGE.test(name)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      const path = join(filesDir(workspace), name);
      if (!existsSync(path)) return reply.code(404).send({ error: 'not-found' });
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
      };
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
      const { remap, stored } = instance.push(device.workspaceId, device.id, parsed.data.records);
      if (stored > 0) relay.contentChanged(device.workspaceId, device.id);
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
      const dir = filesDir(request.device!.workspaceId);
      mkdirSync(dir, { recursive: true });
      await receive(request.body as Readable, join(dir, name));
      return { stored: true };
    });

    api.get<{ Params: { name: string } }>('/api/v1/files/:name', async (request, reply) => {
      const { name } = request.params;
      if (!BACKGROUND_NAME.test(name)) return reply.code(400).send({ error: 'invalid-name' });
      const path = join(filesDir(request.device!.workspaceId), name);
      if (!existsSync(path)) return reply.code(404).send({ error: 'not-found' });
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
        const dir = filesDir(request.device!.workspaceId);
        mkdirSync(dir, { recursive: true });
        const pages: Deck['pages'] = [];
        for (const page of converted.pages) {
          const image = `deck-${id}-${page.image}`;
          const thumbnail = `deck-${id}-${page.image.replace(/\.jpg$/, '-t.jpg')}`;
          await rename(join(out, page.image), join(dir, image));
          await rename(join(out, page.thumbnail), join(dir, thumbnail));
          pages.push({ image, thumbnail, slide: page.slide, step: page.step, text: page.text });
        }
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
