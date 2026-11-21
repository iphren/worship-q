/**
 * Public mode (public server plan; discovery §4.1): the same server, run by the project for
 * workspaces without a church server. It serves the relay, the keyless Bible, slide decks
 * and images (deleted once fetched), and live audio's ICE servers; it cannot be joined as a
 * church server, and keeps nothing.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PUBLIC_SERVER, type MediaLimits, type PublicLimits } from '@worship-q/protocol';
import type { Instance } from './instance';

export interface PublicConfig {
  limits: PublicLimits;
  /** Joins per hour from one IP address. */
  joinsPerHour: number;
  /** Bible requests per hour from one copy of the app. */
  biblePerHour: number;
  /** An IP address may do this many times what one copy of the app may. */
  ipFactor: number;
  /** Days a workspace may go unseen before it is forgotten (S4). */
  idleDays: number;
  /**
   * Proxies in front of the server that add to X-Forwarded-For: the reverse proxy, and a CDN
   * if there is one before it. The address before them is the visitor's, and anything earlier
   * the visitor wrote. Too few counts every visitor as the CDN, which shows at once; too many
   * lets visitors choose their address, which does not. So the default is the reverse proxy.
   */
  proxyHops: number;
}

export const DEFAULT_PUBLIC: PublicConfig = {
  limits: { listeners: 2, phones: 2, mediaPerDay: 100 },
  joinsPerHour: 5,
  biblePerHour: 600,
  ipFactor: 5,
  idleDays: 90,
  proxyHops: 1,
};

/** The public server's own upload limits, smaller than a church's; videos are not taken. */
export const PUBLIC_MEDIA_LIMITS: MediaLimits = {
  image: 25 * 1024 * 1024,
  deck: 100 * 1024 * 1024,
  video: 0,
};

/** Files and work folders older than this are deleted, confirmed or not (plan §3). */
export const KEEP_FILES_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * Public mode's settings, or null when it is off. A setting that is present but not a whole
 * number of at least one stops the server, naming it, so a typing mistake is never a limit
 * of zero or none.
 */
export function publicConfigFromEnv(env: Record<string, string | undefined>): PublicConfig | null {
  if (!/^(1|true|yes|on)$/i.test(env.WORSHIP_Q_PUBLIC ?? '')) return null;
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a whole number of at least 1, not "${raw}"`);
    }
    return value;
  };
  const d = DEFAULT_PUBLIC;
  return {
    limits: {
      listeners: read('WORSHIP_Q_PUBLIC_LISTENERS', d.limits.listeners),
      phones: read('WORSHIP_Q_PUBLIC_PHONES', d.limits.phones),
      mediaPerDay: read('WORSHIP_Q_PUBLIC_MEDIA_PER_DAY', d.limits.mediaPerDay),
    },
    joinsPerHour: read('WORSHIP_Q_PUBLIC_JOINS_PER_HOUR', d.joinsPerHour),
    biblePerHour: read('WORSHIP_Q_PUBLIC_BIBLE_PER_HOUR', d.biblePerHour),
    ipFactor: read('WORSHIP_Q_PUBLIC_IP_FACTOR', d.ipFactor),
    idleDays: read('WORSHIP_Q_PUBLIC_IDLE_DAYS', d.idleDays),
    proxyHops: read('WORSHIP_Q_PUBLIC_PROXY_HOPS', d.proxyHops),
  };
}

// ── What a public server answers ───────────────────────────────────────────

/**
 * Every route a public server serves, as `METHOD /pattern`. Everything else answers 404, so a
 * route added later stays off in public mode until it is listed here.
 */
export const PUBLIC_ROUTES = new Set([
  'GET /',
  'GET /api/v1/info',
  'POST /api/v1/public/join',
  'GET /api/v1/workspace',
  'GET /api/v1/workspace/peers',
  'GET /api/v1/bible/versions',
  'GET /api/v1/bible/:version/toc',
  'GET /api/v1/bible/:version/passage',
  'GET /api/v1/bible/:version/search',
  'GET /api/v1/ice',
  'POST /api/v1/decks',
  'POST /api/v1/images',
  'DELETE /api/v1/decks/:id',
  'GET /api/v1/files/:name',
  'GET /api/v1/coordinator',
  'GET /api/v1/remote',
  'GET /remote',
]);

/** Joining as a church device, refused with the answer each route gives (S5). */
const REFUSED_JOINS: Record<string, string> = {
  'POST /api/v1/pair': PUBLIC_SERVER,
  'POST /api/v1/pair/poll': PUBLIC_SERVER,
  // Older desktops know no `public-server`; `invalid-code` is the least misleading they know.
  'POST /api/v1/enroll': 'invalid-code',
};

/** Whether a public server serves `method` on the route `url` (a pattern, as registered). */
export function publicRoute(method: string, url: string | undefined): boolean {
  // No route matched: Fastify answers 404 by itself.
  if (url === undefined) return true;
  if (method === 'OPTIONS') return true;
  const asked = method === 'HEAD' ? 'GET' : method;
  if (asked === 'GET' && url.startsWith('/remote/')) return true;
  return PUBLIC_ROUTES.has(`${asked} ${url}`);
}

/** Turns away, before any handler runs, every request a public server does not serve. */
export function restrictToPublicRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const url = request.routeOptions.url;
    const refusal = REFUSED_JOINS[`${request.method} ${url}`];
    if (refusal) return reply.code(403).send({ error: refusal });
    if (!publicRoute(request.method, url)) return reply.code(404).send({ error: 'not-found' });
  });
}

// ── One kind of server per data folder (S11) ───────────────────────────────

const MARKER = 'public-server';

/**
 * Refuses to start a public server on a church's data folder, or a church server on a public
 * one, so a mistyped setting can never sweep a church's content or offer it to strangers.
 * The first start in public mode on an empty folder marks it public.
 */
export function checkDataKind(instance: Instance, publicMode: boolean): void {
  const db = instance.db;
  const marked = !!db.prepare('SELECT 1 FROM counter WHERE name = ?').get(MARKER);
  if (publicMode) {
    if (marked) return;
    const church =
      db.prepare('SELECT 1 FROM record LIMIT 1').get() ??
      db.prepare('SELECT 1 FROM church_record LIMIT 1').get() ??
      db.prepare('SELECT 1 FROM administrator LIMIT 1').get();
    if (church) {
      throw new Error(
        'WORSHIP_Q_PUBLIC is on, but this data folder holds a church server’s content. A public server needs a data folder of its own.',
      );
    }
    db.prepare('INSERT INTO counter (name, value) VALUES (?, 1)').run(MARKER);
    return;
  }
  if (marked) {
    throw new Error(
      'This data folder belongs to a public server. Set WORSHIP_Q_PUBLIC=1, or give the church server a data folder of its own.',
    );
  }
}

// ── The sweep (plan §3, S4) ────────────────────────────────────────────────

export interface PublicSweepResult {
  files: number;
  workspaces: number;
}

/**
 * Deletes every file in a workspace's folder, and every work folder, older than a day, and
 * forgets workspaces unseen for `idleDays`, with their folders. Never touches the database,
 * the Bible's tables of contents or LibreOffice's profile.
 */
export function sweepPublic(
  instance: Instance,
  dataDir: string,
  idleDays: number,
  now = Date.parse(instance.now()),
): PublicSweepResult {
  let files = 0;
  const workspacesDir = join(dataDir, 'files');
  if (existsSync(workspacesDir)) {
    for (const workspace of readdirSync(workspacesDir)) {
      const dir = join(workspacesDir, workspace);
      if (!statSync(dir).isDirectory()) continue;
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (now - statSync(path).mtimeMs > KEEP_FILES_MS) {
          rmSync(path, { recursive: true, force: true });
          files++;
        }
      }
    }
  }
  const work = join(dataDir, 'work');
  if (existsSync(work)) {
    for (const name of readdirSync(work)) {
      const path = join(work, name);
      if (now - statSync(path).mtimeMs > KEEP_FILES_MS) {
        rmSync(path, { recursive: true, force: true });
        files++;
      }
    }
  }
  const before = new Date(now - idleDays * 24 * 60 * 60 * 1000).toISOString();
  const forgotten = instance.forgetIdleWorkspaces(before);
  for (const id of forgotten) rmSync(join(workspacesDir, id), { recursive: true, force: true });
  return { files, workspaces: forgotten.length };
}
