/**
 * What a presentation log entry showed, joined at the time of reading from the revision it
 * names (service records R15, R22): never the song's latest, and still there after the song
 * and its run sheet were removed. Structured, never flattened to one string, and with every
 * file as a link, never its bytes.
 */
import {
  align,
  catalogueVersion,
  formatReference,
  passagePieces,
  passageReference,
  PassageSchema,
  type LocalBackground,
  type LocalContent,
  type LocalLogEntry,
  type LocalMedia,
  type LocalPassageColumn,
  type StoredLogEntry,
} from '@worship-q/protocol';
import { parseBlocks } from '@worship-q/lyrics';
import type { SqlValue } from './db';
import { findFile } from './files';
import type { Instance } from './instance';

const text = (value: SqlValue | undefined) => (value == null ? '' : String(value));

/** Makes the link to a workspace's file. */
export type MediaLink = (workspaceId: string, name: string) => string;

export class LogContent {
  constructor(
    private readonly instance: Instance,
    private readonly dataDir: string,
    private readonly link: MediaLink,
  ) {}

  /** The fields of the revision an entry names, or null when the server does not hold it. */
  revision(entry: StoredLogEntry): Record<string, unknown> | null {
    const db = this.instance.db;
    const parse = (row: Record<string, SqlValue> | undefined) =>
      row ? (JSON.parse(text(row.data)) as Record<string, unknown>) : null;
    if (entry.revisionId) {
      const found =
        parse(
          db
            .prepare(
              `SELECT data FROM record WHERE workspace_id = ? AND kind = 'songRevision' AND id = ?`,
            )
            .get(entry.workspaceId, entry.revisionId),
        ) ??
        parse(
          db
            .prepare(`SELECT data FROM church_record WHERE kind = 'songRevision' AND id = ?`)
            .get(entry.revisionId),
        );
      if (found) return found;
    }
    const own = () =>
      parse(
        db
          .prepare(
            `SELECT data FROM record WHERE workspace_id = ? AND kind = 'songRevision'
               AND json_extract(data, '$.songId') = ? AND json_extract(data, '$.revision') = ?
             ORDER BY seq DESC LIMIT 1`,
          )
          .get(entry.workspaceId, entry.songId, entry.revision),
      );
    const church = () =>
      parse(
        db
          .prepare(
            `SELECT data FROM church_record WHERE kind = 'songRevision'
               AND json_extract(data, '$.songId') = ? AND json_extract(data, '$.revision') = ?
             ORDER BY seq DESC LIMIT 1`,
          )
          .get(entry.songId, entry.revision),
      );
    const found = entry.version === 'church' ? (church() ?? own()) : (own() ?? church());
    if (found) return found;
    // The song itself, while it is still at the revision shown.
    const song =
      db
        .prepare(
          `SELECT data, revision FROM record WHERE workspace_id = ? AND kind = 'song' AND id = ?`,
        )
        .get(entry.workspaceId, entry.songId) ??
      db
        .prepare(`SELECT data, revision FROM church_record WHERE kind = 'song' AND id = ?`)
        .get(entry.songId);
    const data = parse(song);
    if (data && (data.revision ?? Number(song!.revision)) === entry.revision) return data;
    return null;
  }

  media(workspaceId: string, name: string): LocalMedia {
    return {
      url: this.link(workspaceId, name),
      name,
      gone: findFile(this.dataDir, workspaceId, name) === null,
    };
  }

  /** What the entry showed, or null when the revision has not reached the server. */
  content(entry: StoredLogEntry): LocalContent | null {
    const data = this.revision(entry);
    if (!data) return null;
    try {
      return this.build(entry, data);
    } catch {
      return null;
    }
  }

  private build(entry: StoredLogEntry, data: Record<string, unknown>): LocalContent | null {
    const title = typeof data.title === 'string' ? data.title : '';
    const part = entry.part;
    switch (part.kind) {
      case 'lyrics': {
        const blocks = parseBlocks(typeof data.lyrics === 'string' ? data.lyrics : '');
        const all = blocks.flat();
        const lines = all.slice(part.line, part.line + part.count);
        let block = 0;
        let seen = 0;
        for (const [index, lines] of blocks.entries()) {
          if (part.line < seen + lines.length) {
            block = index;
            break;
          }
          seen += lines.length;
        }
        return {
          kind: 'lyrics',
          title,
          author: typeof data.author === 'string' ? data.author : '',
          copyright: typeof data.copyright === 'string' ? data.copyright : '',
          ccli: typeof data.ccli === 'string' ? data.ccli : null,
          block,
          lines,
          text: lines.join('\n'),
        };
      }
      case 'deck': {
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
        const page = deck?.pages?.[part.page];
        if (!page) return null;
        return {
          kind: 'deck',
          title,
          slide: page.slide,
          step: page.step,
          page: part.page,
          lines: page.text,
          image: this.media(entry.workspaceId, page.image),
          thumbnail: page.thumbnail ? this.media(entry.workspaceId, page.thumbnail) : null,
          text: page.text.join('\n'),
        };
      }
      case 'passage': {
        const passage = PassageSchema.safeParse(data.passage);
        if (!passage.success) return null;
        const aligned = align(passage.data);
        const slides = passagePieces(aligned);
        const reference = passageReference(passage.data);
        const columns: LocalPassageColumn[] = passage.data.texts.map((version, column) => {
          const units = slides.flatMap((slide) => slide.columns[column]?.units ?? []);
          const range = part.units[column] ?? { start: 0, count: 0 };
          const language = catalogueVersion(version.version)?.language ?? 'en';
          return {
            version: version.version,
            reference: reference ? formatReference(reference, language) : passage.data.reference,
            units: units.slice(range.start, range.start + range.count),
            credit: version.credit,
            copyright: version.copyright,
          };
        });
        const plain = columns
          .map((column) =>
            [
              column.reference,
              ...column.units.map((unit) =>
                [unit.label, unit.lines.map((line) => line.text).join('\n')]
                  .filter(Boolean)
                  .join(' '),
              ),
            ].join('\n'),
          )
          .join('\n\n');
        return { kind: 'passage', title, slide: part.slide, columns, text: plain };
      }
      case 'video': {
        const video = data.video as { file?: unknown; durationSeconds?: unknown } | null;
        if (!video || typeof video.file !== 'string') return null;
        return {
          kind: 'video',
          title,
          video: this.media(entry.workspaceId, video.file),
          durationSeconds: Number(video.durationSeconds ?? 0),
          text: title,
        };
      }
      case 'website': {
        const website = data.website as { url?: unknown } | null;
        const url = typeof website?.url === 'string' ? website.url : '';
        return { kind: 'website', title, url, text: url };
      }
    }
  }

  /** The background the entry opened with: its colour, and a link to its image or video. */
  background(entry: StoredLogEntry): LocalBackground | null {
    if (!entry.background) return null;
    const { color, assetId } = entry.background;
    if (!assetId) return { color, media: null };
    const row =
      this.instance.db
        .prepare(
          `SELECT data FROM record WHERE workspace_id = ? AND kind = 'background' AND id = ?`,
        )
        .get(entry.workspaceId, assetId) ??
      this.instance.db
        .prepare(`SELECT data FROM church_record WHERE kind = 'background' AND id = ?`)
        .get(assetId);
    if (!row) return { color, media: null };
    const data = JSON.parse(text(row.data)) as { fileName?: unknown; kind?: unknown };
    if (typeof data.fileName !== 'string') return { color, media: null };
    return {
      color,
      media: {
        ...this.media(entry.workspaceId, data.fileName),
        kind: data.kind === 'video' ? 'video' : 'image',
      },
    };
  }

  /** An entry with its content in full. */
  entry(entry: StoredLogEntry): LocalLogEntry {
    return {
      id: entry.id,
      workspaceId: entry.workspaceId,
      device: { id: entry.deviceId, name: entry.deviceName },
      runSheet: { id: entry.runSheetId, date: entry.date },
      itemId: entry.itemId,
      previous: entry.previous,
      song: {
        id: entry.songId,
        revision: entry.revision,
        revisionId: entry.revisionId,
        version: entry.version,
      },
      part: entry.part,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      closedByServer: entry.closedByServer,
      clockOffsetMs: entry.clockOffsetMs,
      cursor: entry.cursor,
      content: this.content(entry),
      background: this.background(entry),
    };
  }
}
