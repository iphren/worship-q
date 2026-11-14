/**
 * The local API (service records R20–R22): a read-only JSON API of the church server for
 * other services on the server's own machine. It is a listener of its own, on a port Compose
 * publishes on loopback only and the reverse proxy never forwards to; the public listener
 * does not serve it at all. Requests carry no key (R21): the port is the guard.
 *
 * Everything is under `/local/v1` and covers every workspace of the church. Media are links,
 * never bytes: one route serves a workspace's files, with ranges. See `docs/local-api.md`.
 */
import { existsSync } from 'node:fs';
import Fastify, { type FastifyReply } from 'fastify';
import {
  align,
  catalogueVersion,
  formatReference,
  passagePieces,
  passageReference,
  PassageSchema,
  VIDEO_FILE,
  type LocalBackground,
  type LocalMedia,
  type LocalPassageColumn,
} from '@worship-q/protocol';
import { parseBlocks } from '@worship-q/lyrics';
import type { SqlValue } from './db';
import { findFile } from './files';
import type { Instance } from './instance';
import { LogContent } from './logContent';
import type { PresentationLog } from './presentationLog';
import { recordingFileType, type Recordings } from './recordings';
import { sendFile } from './ranges';

/** The version of the local API, apart from the device protocol. */
export const LOCAL_API_VERSION = 1;
export const DEFAULT_LOCAL_PORT = 8081;
const PREFIX = '/local/v1';
const LOG_LIMIT_MAX = 1000;

/** The local listener's port from the environment; null turns it off (an empty value). */
export function localPortFromEnv(env: Record<string, string | undefined>): number | null {
  const raw = env.WORSHIP_Q_LOCAL_PORT;
  if (raw === undefined) return DEFAULT_LOCAL_PORT;
  if (raw.trim() === '') return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`WORSHIP_Q_LOCAL_PORT is not a port: ${raw}`);
  }
  return port;
}

/** A name of a workspace's file the media route serves: backgrounds, slide images, videos. */
const MEDIA_FILE =
  /^(?:(?![A-Za-z0-9-]*-original\.)[A-Za-z0-9-]{1,80}\.(?:jpg|jpeg|png|mp4)|deck-[0-9a-f-]{36}-\d{3,}(?:-t)?\.jpg)$/i;
const WORKSPACE_ID = /^[0-9a-f-]{36}$/;

export interface LocalConfig {
  instance: Instance;
  dataDir: string;
  recordings: Recordings;
  presentationLog: PresentationLog;
  name: string;
  logger?: boolean;
}

/** A song of a run sheet with all it can show, joined from its current record. */
export type LocalItemContent = { title: string; text: string } & (
  | {
      kind: 'lyrics';
      author: string;
      copyright: string;
      ccli: string | null;
      blocks: string[][];
    }
  | {
      kind: 'deck';
      pages: {
        page: number;
        slide: number;
        step: number;
        lines: string[];
        image: LocalMedia;
        thumbnail: LocalMedia | null;
      }[];
    }
  | { kind: 'passage'; slides: { slide: number; columns: LocalPassageColumn[] }[] }
  | { kind: 'video'; video: LocalMedia; durationSeconds: number }
  | { kind: 'website'; url: string }
);

const text = (value: SqlValue | undefined) => (value == null ? '' : String(value));

const mediaUrl = (workspaceId: string, name: string) =>
  `${PREFIX}/workspaces/${workspaceId}/media/${encodeURIComponent(name)}`;

export async function buildLocalServer(config: LocalConfig) {
  const { instance, recordings, presentationLog } = config;
  const app = Fastify({ logger: config.logger ?? false });
  const content = new LogContent(instance, config.dataDir, mediaUrl);

  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not-found' });
  const workspaceOf = (id: string) => (WORKSPACE_ID.test(id) ? instance.getWorkspace(id) : null);
  const time = (value: unknown): string | null | 'invalid' => {
    if (value === undefined || value === '') return null;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : 'invalid';
  };

  /** A song record as it can be shown, whole. */
  const songContent = (workspaceId: string, data: Record<string, unknown>): LocalItemContent => {
    const title = typeof data.title === 'string' ? data.title : '';
    const passage = PassageSchema.safeParse(data.passage);
    if (data.passage && passage.success) {
      const slides = passagePieces(align(passage.data));
      const reference = passageReference(passage.data);
      return {
        kind: 'passage',
        title,
        slides: slides.map((slide, index) => ({
          slide: index,
          columns: passage.data.texts.map((version, column) => ({
            version: version.version,
            reference: reference
              ? formatReference(reference, catalogueVersion(version.version)?.language ?? 'en')
              : passage.data.reference,
            units: slide.columns[column]?.units ?? [],
            credit: version.credit,
            copyright: version.copyright,
          })),
        })),
        text: typeof data.lyrics === 'string' ? data.lyrics : '',
      };
    }
    const video = data.video as { file?: unknown; durationSeconds?: unknown } | null | undefined;
    if (video && typeof video.file === 'string') {
      return {
        kind: 'video',
        title,
        video: content.media(workspaceId, video.file),
        durationSeconds: Number(video.durationSeconds ?? 0),
        text: title,
      };
    }
    const website = data.website as { url?: unknown } | null | undefined;
    if (website && typeof website.url === 'string') {
      return { kind: 'website', title, url: website.url, text: website.url };
    }
    const deck = data.deck as
      | {
          pages?: {
            image: string;
            thumbnail?: string;
            slide: number;
            step: number;
            text: string[];
          }[];
        }
      | null
      | undefined;
    if (deck?.pages) {
      return {
        kind: 'deck',
        title,
        pages: deck.pages.map((page, index) => ({
          page: index,
          slide: page.slide,
          step: page.step,
          lines: page.text,
          image: content.media(workspaceId, page.image),
          thumbnail: page.thumbnail ? content.media(workspaceId, page.thumbnail) : null,
        })),
        text: deck.pages.map((page) => page.text.join('\n')).join('\n\n'),
      };
    }
    const lyrics = typeof data.lyrics === 'string' ? data.lyrics : '';
    return {
      kind: 'lyrics',
      title,
      author: typeof data.author === 'string' ? data.author : '',
      copyright: typeof data.copyright === 'string' ? data.copyright : '',
      ccli: typeof data.ccli === 'string' ? data.ccli : null,
      blocks: parseBlocks(lyrics),
      text: parseBlocks(lyrics)
        .map((block) => block.join('\n'))
        .join('\n\n'),
    };
  };

  /** The song a workspace presents by id: its own, or the Church Library's. */
  const songRecord = (workspaceId: string, songId: string) => {
    const row =
      instance.db
        .prepare(
          `SELECT data, revision FROM record WHERE workspace_id = ? AND kind = 'song' AND id = ?`,
        )
        .get(workspaceId, songId) ??
      instance.db
        .prepare(`SELECT data, revision FROM church_record WHERE kind = 'song' AND id = ?`)
        .get(songId);
    return row
      ? {
          data: JSON.parse(text(row.data)) as Record<string, unknown>,
          revision: Number(row.revision),
        }
      : null;
  };

  // Every route is read-only: other methods are refused, never routed.
  app.route({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'],
    url: `${PREFIX}/*`,
    handler: async (_request, reply) => {
      reply.header('allow', 'GET, HEAD');
      return reply.code(405).send({ error: 'method-not-allowed' });
    },
  });

  app.get(PREFIX, async () => ({
    name: config.name,
    version: LOCAL_API_VERSION,
    recordingOn: recordings.enabled(),
  }));

  app.get(`${PREFIX}/workspaces`, async () => ({
    workspaces: instance.listWorkspaces().map((w) => ({ id: w.id, name: w.name })),
  }));

  app.get<{ Params: { id: string } }>(`${PREFIX}/workspaces/:id`, async (request, reply) => {
    const workspace = workspaceOf(request.params.id);
    if (!workspace) return notFound(reply);
    return {
      id: workspace.id,
      name: workspace.name,
      live: instance.getLive(workspace.id) !== null,
    };
  });

  app.get<{ Params: { id: string } }>(
    `${PREFIX}/workspaces/:id/run-sheets`,
    async (request, reply) => {
      const days = workspaceOf(request.params.id) ? instance.runSheetDays(request.params.id) : null;
      if (!days) return notFound(reply);
      return { dates: days.dates, liveDate: days.liveDate };
    },
  );

  app.get<{ Params: { id: string; date: string } }>(
    `${PREFIX}/workspaces/:id/run-sheets/:date`,
    async (request, reply) => {
      const { id, date } = request.params;
      if (!workspaceOf(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return notFound(reply);
      const row = instance.db
        .prepare(
          `SELECT id, data FROM record WHERE workspace_id = ? AND kind = 'runSheet' AND key = ?`,
        )
        .get(id, date);
      if (!row) return notFound(reply);
      const data = JSON.parse(text(row.data)) as { items?: unknown };
      const items = Array.isArray(data.items)
        ? (data.items as { id?: unknown; songId?: unknown }[])
        : [];
      return {
        id: text(row.id),
        date,
        items: items.map((item, position) => {
          const songId = String(item.songId ?? '');
          const song = songRecord(id, songId);
          return {
            id: String(item.id ?? songId),
            position,
            song: song
              ? {
                  id: songId,
                  revision: song.revision,
                  removed: song.data.removedAt != null,
                }
              : { id: songId, revision: null, removed: true },
            content: song ? songContent(id, song.data) : null,
          };
        }),
      };
    },
  );

  /** What is on screen now, from the coordinator's latest snapshot. */
  app.get<{ Params: { id: string } }>(`${PREFIX}/workspaces/:id/live`, async (request, reply) => {
    const workspace = workspaceOf(request.params.id);
    if (!workspace) return notFound(reply);
    const live = instance.getLive(workspace.id);
    if (!live || live.snapshot.state.status !== 'live') return { live: false };
    const { snapshot } = live;
    const presented = snapshot.presented;
    const piece = presented?.pieces.find((p) => p.id === presented.pieceId) ?? null;
    let background: LocalBackground | null = null;
    if (presented?.background) {
      const asset = presented.background.assetId
        ? instance.backgroundFile(workspace.id, presented.background.assetId)
        : null;
      background = {
        color: presented.background.color,
        media: asset ? { ...content.media(workspace.id, asset.fileName), kind: asset.kind } : null,
      };
    }
    return {
      live: true,
      runSheet: { id: snapshot.state.runSheetId, date: snapshot.date },
      blank: snapshot.state.blank,
      updatedAt: live.updatedAt,
      presented:
        presented && piece
          ? {
              itemId: presented.itemId,
              songId: presented.songId,
              title: presented.title,
              kind: presented.kind,
              previous: presented.previous,
              pieceId: piece.id,
              lines: piece.lines,
              image: piece.image ? content.media(workspace.id, piece.image) : null,
              video: piece.video ? content.media(workspace.id, piece.video.file) : null,
              websiteUrl: presented.websiteUrl,
              passage: piece.passage ?? null,
              background,
            }
          : null,
    };
  });

  /**
   * The presentation log: by `from` and `to` on the entries' start, or every change `after` a
   * cursor, at most `limit`. The cursor is the server's order of arrival, so an entry that
   * closes later, or arrives late, is returned again.
   */
  app.get<{
    Querystring: {
      workspace?: string;
      from?: string;
      to?: string;
      after?: string;
      limit?: string;
    };
  }>(`${PREFIX}/presentation-log`, async (request, reply) => {
    const { workspace, after } = request.query;
    if (workspace !== undefined && !workspaceOf(workspace)) return notFound(reply);
    const limit = Math.min(LOG_LIMIT_MAX, Math.max(1, Number(request.query.limit ?? 200) || 200));
    if (after !== undefined) {
      const cursor = Number(after);
      if (!Number.isInteger(cursor) || cursor < 0) {
        return reply.code(400).send({ error: 'bad-cursor' });
      }
      const entries = presentationLog.after(workspace ?? null, cursor, limit);
      return {
        entries: entries.map((entry) => content.entry(entry)),
        cursor: entries.at(-1)?.cursor ?? Math.max(cursor, 0),
        more: entries.length === limit,
      };
    }
    const from = time(request.query.from);
    const to = time(request.query.to);
    if (from === 'invalid' || to === 'invalid') return reply.code(400).send({ error: 'bad-range' });
    const entries = presentationLog.range(workspace ?? null, from, to);
    return {
      entries: entries.map((entry) => content.entry(entry)),
      // Where to follow on from, for a reader that read the range and now polls.
      cursor: presentationLog.latestCursor(),
    };
  });

  app.get<{ Querystring: { workspace?: string; from?: string; to?: string } }>(
    `${PREFIX}/recordings`,
    async (request, reply) => {
      const { workspace } = request.query;
      if (workspace !== undefined && !workspaceOf(workspace)) return notFound(reply);
      const from = time(request.query.from);
      const to = time(request.query.to);
      if (from === 'invalid' || to === 'invalid') {
        return reply.code(400).send({ error: 'bad-range' });
      }
      return {
        recordings: recordings
          .list(workspace ?? null, { from, to })
          .map((recording) => ({ ...recording, url: `${PREFIX}/recordings/${recording.id}/file` })),
      };
    },
  );

  app.get<{ Params: { id: string } }>(`${PREFIX}/recordings/:id`, async (request, reply) => {
    const recording = recordings.get(request.params.id);
    if (!recording) return notFound(reply);
    return { ...recording, url: `${PREFIX}/recordings/${recording.id}/file` };
  });

  /** A recording's file, with ranges, readable while it is still being received. */
  app.get<{ Params: { id: string } }>(`${PREFIX}/recordings/:id/file`, async (request, reply) => {
    const recording = recordings.get(request.params.id);
    const path = recording ? recordings.path(recording) : '';
    if (!recording || !existsSync(path)) return notFound(reply);
    reply.header('cache-control', 'no-store');
    return sendFile(request, reply, path, '', recordingFileType(recording.container));
  });

  /** A workspace's file, its own or the Church Library's, that the log and run sheets link to. */
  app.get<{ Params: { id: string; name: string } }>(
    `${PREFIX}/workspaces/:id/media/:name`,
    async (request, reply) => {
      const { id, name } = request.params;
      if (!workspaceOf(id) || (!MEDIA_FILE.test(name) && !VIDEO_FILE.test(name))) {
        return notFound(reply);
      }
      const path = findFile(config.dataDir, id, name);
      if (!path) return notFound(reply);
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      return sendFile(request, reply, path, name);
    },
  );

  return app;
}
