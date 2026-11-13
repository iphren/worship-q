/** The instance's HTTP and WebSocket interface. */
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { copyFile, rename } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  AudioStateSchema,
  isCompatibleProtocol,
  LiveSnapshotSchema,
  MIN_PROTOCOL_VERSION,
  ObsSnapshotSchema,
  ObsStateSchema,
  OutputKindSchema,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  PushRequestSchema,
  TOO_LARGE,
  UPDATE_NEEDED,
  VIDEO_FILE,
  WorkspaceGrantSchema,
  type Deck,
  type MediaLimits,
  type LibraryType,
  type EnrollResponse,
  type OutputLink,
  type PairingStartResponse,
  type PullResponse,
  type PushResponse,
  type RestoreResponse,
  type ServerInfo,
  type BiblePassageResponse,
  type BibleTocResponse,
  type BibleVersionsResponse,
  fromUsfm,
  toUsfm,
} from '@worship-q/protocol';
import { z } from 'zod';
import { registerAdminRoutes } from './admin';
import { BibleError, versionInfo, type Bible } from './bible';
import { DECK_EXTENSIONS, type ConvertedDeck } from './decks/convert';
import { churchFilesDir, findFile, workspaceFilesDir } from './files';
import { convertImage, ImageError } from './images';
import {
  attachment,
  DEFAULT_MEDIA_LIMITS,
  HEIC_EXTENSIONS,
  HEIC_MESSAGE,
  IMAGE_EXTENSIONS,
  limiter,
  VIDEO_EXTENSIONS,
} from './media';
import { sendFile } from './ranges';
import { PAIRING_INTERVAL_MS, type DeviceRow, type Instance } from './instance';
import { ObsReports } from './obsReports';
import { AudioReports } from './audioReports';
import { DEFAULT_STUN, iceServers, type IceConfig } from './ice';
import type { OidcClient } from './oidc';
import { DEFAULT_RETENTION_DAYS, SWEEP_EVERY_MS, sweepDeletedFiles } from './retention';
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
  /** Built admin pages, served at /admin/; optional in tests (phase 3). */
  adminDir?: string;
  /** Administrator sign-in; null or absent when not configured (D27). */
  oidc?: OidcClient | null;
  /**
   * This server's public address, for the pairing link in the QR code (D29). Without it the
   * address the request came in on is used.
   */
  publicUrl?: string;
  /** E-mail addresses made administrators at start, idempotently (D28). */
  administrators?: string[];
  /** Days a deleted item keeps its files (D34). */
  retentionDays?: number;
  /** Whether the retention sweep runs on a timer; off in tests. */
  sweep?: boolean;
  /** Upload limits per kind of media (U1); see `mediaLimitsFromEnv`. */
  mediaLimits?: Partial<MediaLimits>;
  /** Bible passages through the church's provider keys (B17); absent in most tests. */
  bible?: Bible;
  /** The ICE servers for live audio (A10); see `iceConfigFromEnv`. The public STUN default. */
  ice?: IceConfig;
}

const BACKGROUND_NAME = /^[A-Za-z0-9-]{1,80}\.(jpg|jpeg|png|mp4)$/i;
/** A converted slide's image or its small copy; see the decks route. */
const DECK_IMAGE = /^deck-[0-9a-f-]{36}-\d{3,}(-t)?\.jpg$/;
/** Background files and backups, which have no limit of their own. */
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
/** A deck's identifier, as in its images' names. */
const DECK_ID_PARAM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PING_MS = 25_000;

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceRow;
  }
}

export async function buildServer(config: ServerConfig) {
  const { instance } = config;
  // `app` is made below; the relay only warns once connections arrive, by when it exists.
  const relay = new Relay(instance, undefined, (message, detail) => app.log.warn(detail, message), {
    note: (message, detail) => app.log.info(detail, message),
    // A broadcaster's answer to an administrator listening in the admin app (A22).
    adminAudio: (workspaceId, deviceId, signal) =>
      audioReports.fromBroadcaster(workspaceId, deviceId, signal),
  });
  const obsReports = new ObsReports(instance.now);
  const ice: IceConfig = config.ice ?? { stun: [DEFAULT_STUN], turn: null };
  const audioReports = new AudioReports(
    () => Date.parse(instance.now()),
    (workspaceId, deviceId, name, signal, listener) =>
      relay.adminAudioSignal(workspaceId, deviceId, name, signal, listener),
  );
  const audioSweeper = setInterval(() => audioReports.sweep(), 10_000);
  audioSweeper.unref();
  const sweeper = setInterval(() => relay.sweep(), 30_000);
  sweeper.unref();
  for (const email of config.administrators ?? []) {
    if (email.trim()) instance.seedAdministrator(email);
  }
  const retentionDays = config.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const retention =
    config.sweep === false
      ? null
      : setInterval(() => {
          try {
            const swept = sweepDeletedFiles(instance, config.dataDir, retentionDays);
            if (swept.files > 0) app.log.info(`Retention sweep removed ${swept.files} files`);
          } catch (error) {
            app.log.error(error);
          }
        }, SWEEP_EVERY_MS);
  retention?.unref();
  const app = Fastify({
    logger: config.logger ?? false,
    bodyLimit: 16 * 1024 * 1024,
    // Behind CloudFront and a reverse proxy.
    trustProxy: true,
  });
  // New files of a type the workspace manages in the Church Library are the church's.
  const uploadDir = (workspaceId: string, type: LibraryType) =>
    instance.getWorkspace(workspaceId)?.libraryTypes.includes(type)
      ? churchFilesDir(config.dataDir)
      : workspaceFilesDir(config.dataDir, workspaceId);
  const manages = (workspaceId: string) => {
    const types = instance.getWorkspace(workspaceId)?.libraryTypes ?? [];
    return { manageLibrary: types.includes('songs'), manageLibraryTypes: types };
  };
  // One conversion at a time: LibreOffice is heavy, and its settings folder is shared.
  let conversions: Promise<unknown> = Promise.resolve();
  const queued = <T>(task: () => Promise<T>): Promise<T> => {
    const result = conversions.then(task, task);
    conversions = result.catch(() => undefined);
    return result;
  };
  const backupsDir = (workspaceId: string) => join(config.dataDir, 'backups', workspaceId);
  const limits: MediaLimits = { ...DEFAULT_MEDIA_LIMITS, ...config.mediaLimits };
  // Resizing an image is quick but takes memory; two at once (U13).
  const imageSlots = limiter(2);

  /**
   * Turns a file into a deck kept with the workspace's files, under a new identifier, with
   * the file itself kept beside the images as the deck's original (U4). An image is reduced
   * to one page (U13); anything else is converted as slides.
   */
  const makeDeck = async (
    workspaceId: string,
    upload: string,
    source: string,
    work: string,
  ): Promise<Deck> => {
    const extension = extname(upload).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.includes(extension);
    const out = join(work, 'out');
    mkdirSync(out, { recursive: true });
    const converted = isImage
      ? await imageSlots(() => convertImage(upload, out))
      : await queued(() => config.convertDeck!(upload, out, join(work, 'convert')));
    const id = randomUUID();
    const dir = uploadDir(workspaceId, 'slides');
    mkdirSync(dir, { recursive: true });
    const pages: Deck['pages'] = [];
    for (const page of converted.pages) {
      const image = `deck-${id}-${page.image}`;
      const thumbnail = `deck-${id}-${page.image.replace(/\.jpg$/, '-t.jpg')}`;
      await rename(join(out, page.image), join(dir, image));
      await rename(join(out, page.thumbnail), join(dir, thumbnail));
      pages.push({ image, thumbnail, slide: page.slide, step: page.step, text: page.text });
    }
    // Kept so the deck can be converted again and downloaded later. Its name holds the same
    // identifier as the deck's images; only the original route serves it.
    await rename(upload, join(dir, `deck-${id}-original${extension}`));
    return {
      source,
      ...(isImage ? { kind: 'image' as const } : {}),
      width: converted.width,
      height: converted.height,
      pages,
    };
  };

  /** A deck's kept original, from the workspace's files or the Church Library's. */
  const findOriginal = (workspaceId: string, deckId: string): string | null => {
    if (!DECK_ID_PARAM.test(deckId)) return null;
    const prefix = `deck-${deckId}-original.`;
    for (const dir of [
      workspaceFilesDir(config.dataDir, workspaceId),
      churchFilesDir(config.dataDir),
    ]) {
      if (!existsSync(dir)) continue;
      const name = readdirSync(dir).find(
        (file) => file.startsWith(prefix) && !file.endsWith('.partial'),
      );
      if (name) return join(dir, name);
    }
    return null;
  };

  /** Answers an upload that failed while arriving: too large, empty, or broken off. */
  const uploadRefused = (reply: FastifyReply, error: unknown) => {
    if (error instanceof UploadError) {
      return reply.code(error.status).send({ error: error.code, ...error.detail });
    }
    throw error;
  };

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

  app.get('/api/v1/info', async () => {
    const info: ServerInfo = {
      name: config.name,
      protocolVersion: PROTOCOL_VERSION,
      minProtocolVersion: MIN_PROTOCOL_VERSION,
      decks: config.convertDeck !== undefined,
      outputs: config.outputDir !== undefined,
      pairing: true,
      admin: !!config.oidc,
      codes: !instance.hasAdministrators(),
      media: { images: true, videos: true, limits },
      bible: config.bible ? config.bible.offered(instance.churchSettings()).length > 0 : false,
      audioRelay: ice.turn !== null,
    };
    return info;
  });

  // ── Pairing (D29): a device asks, shows the code, and polls ──────────────

  const publicUrl = (request: FastifyRequest) =>
    config.publicUrl ?? `${request.protocol}://${request.host}`;

  app.post<{ Body: { protocolVersion?: number; deviceName?: string } }>(
    '/api/v1/pair',
    async (request, reply) => {
      const { protocolVersion, deviceName } = request.body ?? {};
      if (!isCompatibleProtocol(protocolVersion)) {
        return reply.code(426).send({ error: UPDATE_NEEDED, protocolVersion: PROTOCOL_VERSION });
      }
      const started = instance.startPairing(String(deviceName ?? ''), request.ip);
      if (!started) return reply.code(429).send({ error: 'too-many-requests' });
      const { secret, code, expiresAt } = started;
      return {
        secret,
        code,
        url: `${publicUrl(request)}/admin/pair?code=${encodeURIComponent(code)}`,
        expiresAt,
        intervalMs: PAIRING_INTERVAL_MS,
      } satisfies PairingStartResponse;
    },
  );

  app.post<{ Body: { secret?: string } }>('/api/v1/pair/poll', async (request) => {
    return instance.pollPairing(String(request.body?.secret ?? ''));
  });

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
      if (!BACKGROUND_NAME.test(name) && !DECK_IMAGE.test(name) && !VIDEO_FILE.test(name)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      if (name.includes('-original.')) return reply.code(404).send({ error: 'not-found' });
      const path = findFile(config.dataDir, link.workspaceId, name);
      if (!path) return reply.code(404).send({ error: 'not-found' });
      const etag = `"${name}"`;
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      reply.header('etag', etag);
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      return sendFile(request, reply, path, name);
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
        // Slows down guessing. A code that is off (D30) is told apart, so the device can
        // say that an administrator must approve it instead.
        await new Promise((done) => setTimeout(done, 1000));
        return reply.code(403).send({ error: instance.codeRefusal(String(code ?? '')) });
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
        ...manages(workspace.id),
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

    // ── The Bible (B17–B26) ────────────────────────────────────────────────

    const bibleStatus: Record<BibleError['kind'], number> = {
      'not-offered': 403,
      'not-found': 404,
      'too-large': 413,
      unavailable: 503,
    };
    /** Runs a Bible request for a version the church offers, mapping its errors. */
    const bibleAnswer = async <T>(
      version: string,
      reply: FastifyReply,
      answer: (bible: Bible) => Promise<T>,
    ): Promise<T | FastifyReply> => {
      const bible = config.bible;
      if (!bible || !bible.isOffered(version, instance.churchSettings())) {
        return reply.code(403).send({ error: 'not-offered' });
      }
      try {
        return await answer(bible);
      } catch (error) {
        if (error instanceof BibleError) {
          return reply
            .code(bibleStatus[error.kind])
            .send({ error: error.kind, reason: error.message });
        }
        // Never pass a provider's answer on: it might echo a request with its key.
        app.log.warn({ version, error: (error as Error).message }, 'Bible request failed');
        return reply.code(503).send({ error: 'unavailable' });
      }
    };

    api.get(
      '/api/v1/bible/versions',
      async () =>
        ({
          versions: (config.bible?.offered(instance.churchSettings()) ?? []).map((version) => {
            const tocHash = config.bible!.tocs.peekHash(version.id);
            return { ...versionInfo(version), ...(tocHash ? { tocHash } : {}) };
          }),
        }) satisfies BibleVersionsResponse,
    );

    api.get<{ Params: { version: string }; Querystring: { book?: string; chapter?: string } }>(
      '/api/v1/bible/:version/toc',
      async (request, reply) =>
        bibleAnswer(request.params.version, reply, async (bible) => {
          const { book, chapter } = request.query;
          // A chapter whose verses are not known yet is fetched first (B20).
          if (book && chapter && /^\d+$/.test(chapter)) {
            await bible.tocs.ensureChapter(request.params.version, book, Number(chapter));
          }
          return (await bible.tocs.get(request.params.version)) satisfies BibleTocResponse;
        }),
    );

    api.get<{
      Params: { version: string };
      Querystring: { ref?: string; device?: string; session?: string };
    }>('/api/v1/bible/:version/passage', async (request, reply) =>
      bibleAnswer(request.params.version, reply, async (bible) => {
        const reference = fromUsfm(String(request.query.ref ?? ''));
        if (!reference) throw new BibleError('not-found', 'Not a reference');
        const text = await bible.passages.get(request.params.version, reference);
        // Every API.Bible passage served is reported (B25).
        if (text.fumsToken) {
          bible.fums.report(
            [text.fumsToken],
            String(request.query.device ?? request.device!.id),
            String(request.query.session ?? ''),
          );
        }
        return { reference: toUsfm(reference), text } satisfies BiblePassageResponse;
      }),
    );

    api.get<{ Params: { version: string }; Querystring: { q?: string } }>(
      '/api/v1/bible/:version/search',
      async (request, reply) =>
        bibleAnswer(request.params.version, reply, async (bible) =>
          bible.search(request.params.version, String(request.query.q ?? '').slice(0, 200)),
        ),
    );

    /** A saved item's tokens, sent by the coordinator when it is first presented (B25). */
    api.post<{ Body: { tokens?: unknown; device?: unknown; session?: unknown } }>(
      '/api/v1/bible/fums',
      async (request, reply) => {
        const parsed = z
          .object({
            tokens: z.array(z.string().min(1).max(2000)).min(1).max(100),
            device: z.string().max(100),
            session: z.string().max(100),
          })
          .safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
        config.bible?.fums.report(parsed.data.tokens, parsed.data.device, parsed.data.session);
        return reply.code(204).send();
      },
    );

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

    // ── OBS state for the admin app ────────────────────────────────────────

    /** The OBS computer's own state, kept for the admin app; see `ObsReports`. */
    api.put('/api/v1/obs', async (request, reply) => {
      const parsed = z
        .object({ state: ObsStateSchema, snapshot: ObsSnapshotSchema.nullish() })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid-state' });
      const device = request.device!;
      // A computer speaks only for its own OBS link.
      if (parsed.data.state.ownerId !== device.id) {
        return reply.code(403).send({ error: 'not-owner' });
      }
      const { state, snapshot } = parsed.data;
      return { stored: obsReports.put(device.workspaceId, device.id, state, snapshot ?? null) };
    });

    // ── Live audio (live audio plan A10, A21) ──────────────────────────────

    /** The ICE servers, with a fresh ten-minute relay credential when one is configured. */
    api.get('/api/v1/ice', async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return { iceServers: iceServers(ice, Date.parse(instance.now())) };
    });

    /** The broadcaster's own audio state, kept for the admin app; see `AudioReports`. */
    api.put('/api/v1/audio', async (request, reply) => {
      const parsed = z.object({ state: AudioStateSchema }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid-state' });
      const device = request.device!;
      // A computer speaks only for its own broadcast.
      if (parsed.data.state.ownerId !== device.id) {
        return reply.code(403).send({ error: 'not-owner' });
      }
      return { stored: audioReports.put(device.workspaceId, device.id, parsed.data.state) };
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
        Number(request.headers[PROTOCOL_HEADER]),
      );
      // The Church Library reaches every workspace.
      if (central > 0) relay.contentChangedAll(device.id);
      else if (stored > 0) relay.contentChanged(device.workspaceId, device.id);
      return { remap } satisfies PushResponse;
    });

    api.get<{ Querystring: { since?: string } }>('/api/v1/sync/pull', async (request) => {
      const since = Math.max(0, Number(request.query.since ?? 0) || 0);
      const protocol = Number(request.headers[PROTOCOL_HEADER]);
      const page = instance.pull(request.device!.workspaceId, since, 500, protocol);
      return {
        ...page,
        church: instance.churchSettings(),
        ...manages(request.device!.workspaceId),
      } satisfies PullResponse;
    });

    /** Drops the workspace's own version of a church song or background (D32). */
    api.post<{ Body: { kind?: string; key?: string } }>(
      '/api/v1/sync/restore',
      async (request, reply) => {
        const kind = request.body?.kind;
        const key = String(request.body?.key ?? '');
        if ((kind !== 'song' && kind !== 'background') || !key) {
          return reply.code(400).send({ error: 'invalid-request' });
        }
        const device = request.device!;
        const record = instance.dropOwnVersion(device.workspaceId, kind, key);
        if (!record) return reply.code(409).send({ error: 'no-church-version' });
        relay.contentChanged(device.workspaceId, device.id);
        return { record } satisfies RestoreResponse;
      },
    );

    api.put<{ Params: { name: string } }>('/api/v1/files/:name', async (request, reply) => {
      const { name } = request.params;
      if (!BACKGROUND_NAME.test(name)) return reply.code(400).send({ error: 'invalid-name' });
      const dir = uploadDir(request.device!.workspaceId, 'backgrounds');
      mkdirSync(dir, { recursive: true });
      try {
        await receive(request, join(dir, name), MAX_FILE_BYTES);
      } catch (error) {
        return uploadRefused(reply, error);
      }
      return { stored: true };
    });

    api.get<{ Params: { name: string } }>('/api/v1/files/:name', async (request, reply) => {
      const { name } = request.params;
      const video = VIDEO_FILE.test(name);
      // A deck's original is served only by its own route.
      if ((!BACKGROUND_NAME.test(name) && !video) || name.includes('-original.')) {
        return reply.code(400).send({ error: 'invalid-name' });
      }
      const path = findFile(config.dataDir, request.device!.workspaceId, name);
      if (!path) return reply.code(404).send({ error: 'not-found' });
      // Videos are fetched in parts when a download resumes or a page plays one.
      if (video) return sendFile(request, reply, path, name);
      reply.header('content-length', statSync(path).size);
      reply.type('application/octet-stream');
      return reply.send(createReadStream(path));
    });

    /** Stores a video as uploaded (U10, U14); the device then saves it as a song. */
    api.post<{ Querystring: { name?: string } }>('/api/v1/videos', async (request, reply) => {
      const source = basename(String(request.query.name ?? ''));
      const extension = extname(source).toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(extension) || source === extension) {
        return reply.code(400).send({ error: 'unsupported-format' });
      }
      const file = `video-${randomUUID()}${extension}`;
      const dir = uploadDir(request.device!.workspaceId, 'slides');
      mkdirSync(dir, { recursive: true });
      try {
        const bytes = await receive(request, join(dir, file), limits.video);
        return { file, source, bytes };
      } catch (error) {
        return uploadRefused(reply, error);
      }
    });

    /** Makes an uploaded image a deck of one page (U13). */
    api.post<{ Querystring: { name?: string } }>('/api/v1/images', async (request, reply) => {
      const source = basename(String(request.query.name ?? '')) || 'image.jpg';
      const extension = extname(source).toLowerCase();
      if (HEIC_EXTENSIONS.includes(extension)) {
        return reply.code(400).send({ error: 'heic-unsupported', message: HEIC_MESSAGE });
      }
      if (!IMAGE_EXTENSIONS.includes(extension)) {
        return reply.code(400).send({ error: 'unsupported-format' });
      }
      const work = join(config.dataDir, 'work', randomUUID());
      mkdirSync(work, { recursive: true });
      try {
        const upload = join(work, `upload${extension}`);
        await receive(request, upload, limits.image);
        return await makeDeck(request.device!.workspaceId, upload, source, work);
      } catch (error) {
        if (error instanceof ImageError) {
          return reply.code(422).send({ error: 'conversion-failed', message: error.message });
        }
        return uploadRefused(reply, error);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });

    /**
     * A deck's kept original (U18), named after `name` with the original's own extension, so
     * a photo converted from HEIC on a Mac downloads as `.jpg`.
     */
    api.get<{ Params: { id: string }; Querystring: { name?: string } }>(
      '/api/v1/decks/:id/original',
      async (request, reply) => {
        const path = findOriginal(request.device!.workspaceId, request.params.id);
        if (!path) return reply.code(404).send({ error: 'no-original' });
        const extension = extname(path);
        const asked = basename(String(request.query.name ?? ''));
        const stem = asked ? asked.slice(0, asked.length - extname(asked).length) : '';
        reply.header('content-disposition', attachment(`${stem || 'original'}${extension}`));
        reply.header('content-length', statSync(path).size);
        reply.type('application/octet-stream');
        return reply.send(createReadStream(path));
      },
    );

    /**
     * Converts a deck's kept original again, under a new identifier (U4). The old images stay
     * until the retention sweep finds no record using them.
     */
    api.post<{ Params: { id: string }; Querystring: { name?: string } }>(
      '/api/v1/decks/:id/reconvert',
      async (request, reply) => {
        const original = findOriginal(request.device!.workspaceId, request.params.id);
        if (!original) return reply.code(404).send({ error: 'no-original' });
        const extension = extname(original).toLowerCase();
        const isImage = IMAGE_EXTENSIONS.includes(extension);
        if (!isImage && !config.convertDeck) {
          return reply.code(501).send({ error: 'decks-unavailable' });
        }
        const source = basename(String(request.query.name ?? '')) || `original${extension}`;
        const work = join(config.dataDir, 'work', randomUUID());
        mkdirSync(work, { recursive: true });
        try {
          const upload = join(work, `upload${extension}`);
          await copyFile(original, upload);
          return await makeDeck(request.device!.workspaceId, upload, source, work);
        } catch (error) {
          request.log.error(error);
          return reply.code(422).send({
            error: 'conversion-failed',
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          rmSync(work, { recursive: true, force: true });
        }
      },
    );

    // Converts a slide deck into images kept with the workspace's files, and describes them.
    // The device then fetches the images and saves the deck as a song.
    api.post<{ Querystring: { name?: string } }>('/api/v1/decks', async (request, reply) => {
      if (!config.convertDeck) return reply.code(501).send({ error: 'decks-unavailable' });
      const source = basename(String(request.query.name ?? '')) || 'slides.pptx';
      const extension = extname(source).toLowerCase();
      if (!DECK_EXTENSIONS.includes(extension)) {
        return reply.code(400).send({ error: 'unsupported-format' });
      }
      const work = join(config.dataDir, 'work', randomUUID());
      mkdirSync(work, { recursive: true });
      try {
        const upload = join(work, `upload${extension}`);
        try {
          await receive(request, upload, limits.deck);
        } catch (error) {
          return uploadRefused(reply, error);
        }
        return await makeDeck(request.device!.workspaceId, upload, source, work);
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

    api.put('/api/v1/backups', async (request, reply) => {
      const device = request.device!;
      const dir = backupsDir(device.workspaceId);
      mkdirSync(dir, { recursive: true });
      const file = `${new Date().toISOString().replace(/[:.]/g, '-')}-${device.id}.worshipq`;
      try {
        await receive(request, join(dir, file), MAX_FILE_BYTES);
      } catch (error) {
        return uploadRefused(reply, error);
      }
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

  /**
   * Pings the socket and ends it when a ping goes unanswered. Every closing is logged with
   * its code, so a dropped phone or desktop can be traced to the side that dropped it.
   */
  const keepAlive = (
    socket: import('ws').WebSocket,
    kind: string,
    request: import('fastify').FastifyRequest,
  ) => {
    const openedAt = Date.now();
    let lastMessageAt = openedAt;
    let alive = true;
    let terminated = false;
    socket.on('pong', () => (alive = true));
    socket.on('message', () => (lastMessageAt = Date.now()));
    const timer = setInterval(() => {
      if (!alive) {
        terminated = true;
        return socket.terminate();
      }
      alive = false;
      socket.ping();
    }, PING_MS);
    socket.on('error', (error) =>
      app.log.info({ kind, ip: request.ip, error: error.message }, 'WebSocket error'),
    );
    socket.on('close', (code, reason) => {
      clearInterval(timer);
      const now = Date.now();
      app.log.info(
        {
          kind,
          ip: request.ip,
          code,
          reason: reason.toString(),
          unansweredPing: terminated,
          openForMs: now - openedAt,
          sinceLastMessageMs: now - lastMessageAt,
        },
        'WebSocket closed',
      );
    });
  };

  app.get('/api/v1/coordinator', { websocket: true }, (socket, request) => {
    keepAlive(socket, 'coordinator', request);
    const handlers = relay.desktop(socket);
    socket.on('message', (raw) => handlers.message(raw));
    socket.on('close', () => handlers.close());
  });

  app.get('/api/v1/remote', { websocket: true }, (socket, request) => {
    keepAlive(socket, 'remote', request);
    const handlers = relay.remote(socket);
    socket.on('message', (raw) => handlers.message(raw));
    socket.on('close', () => handlers.close());
  });

  app.get('/api/v1/output', { websocket: true }, (socket, request) => {
    keepAlive(socket, 'output', request);
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
  await registerAdminRoutes(app, {
    instance,
    relay,
    obsReports,
    audioReports,
    ice,
    oidc: config.oidc ?? null,
    dataDir: config.dataDir,
    name: config.name,
    adminDir: config.adminDir,
    bible: config.bible,
  });

  app.get('/', async () => ({ name: config.name, app: 'worship-q' }));
  app.addHook('onClose', async () => {
    config.bible?.stop();
    clearInterval(sweeper);
    clearInterval(audioSweeper);
    if (retention) clearInterval(retention);
  });

  return { app, relay };
}

/** An upload refused while it arrived, with the answer to give. */
class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/**
 * Writes an upload to a temporary file and moves it into place once complete, returning its
 * size. A body over `limit` bytes is refused with 413 and `limitBytes` (U2), already from
 * its declared length when it has one; an empty body, or one shorter than declared, is
 * refused too. Nothing is left behind when it fails.
 */
async function receive(request: FastifyRequest, target: string, limit: number): Promise<number> {
  const body = request.body as Readable;
  const declared = request.headers['content-length'];
  const expected = declared === undefined ? null : Number(declared);
  const tooLarge = () => new UploadError(413, TOO_LARGE, { limitBytes: limit });
  if (expected !== null && expected > limit) {
    body.resume();
    throw tooLarge();
  }
  const partial = `${target}.partial`;
  let size = 0;
  let over = false;
  // Counts what arrives and stops the copy once the limit is passed.
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > limit) {
        over = true;
        return done(new Error(TOO_LARGE));
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(body, counter, createWriteStream(partial));
    if (expected !== null && size !== expected) throw new UploadError(400, 'incomplete');
    if (size === 0) throw new UploadError(400, 'empty');
    await rename(partial, target);
    return size;
  } catch (error) {
    rmSync(partial, { force: true });
    if (over) throw tooLarge();
    throw error;
  }
}
