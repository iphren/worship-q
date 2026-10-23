/**
 * Imports the songs of the legacy lyrics service (its MariaDB `songs` table) into a
 * workspace, as synchronized records that every desktop of the workspace then pulls.
 *
 * Importing again is safe: each legacy song keeps one identifier, a song is stored only
 * when the legacy copy changed, and a song edited in Worship Q since it was imported is
 * left alone. A song gone from the legacy service (deleted, or only on probation) is
 * removed, unless it was edited in Worship Q.
 */
import { createHash, randomUUID } from 'node:crypto';
import { assignLineIds } from '@worship-q/lyrics';
import type { SyncRecord } from '@worship-q/protocol';
import type { Instance } from './instance';

/** The device recorded as the author of imported records. */
export const LEGACY_IMPORTER = 'legacy-import';

/** A row of the legacy `songs` table; only the columns the import reads. */
export interface LegacySong {
  songId: number;
  id: string;
  title: string;
  lyrics: string | null;
  lyricist?: string | null;
  composer?: string | null;
  copyright?: string | null;
  ccli?: string | null;
  year?: number | null;
  deleted?: number | boolean;
}

export interface LegacyImportPlan {
  records: SyncRecord[];
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  /** Titles of songs edited in Worship Q, which the import leaves as they are. */
  kept: string[];
  /** Legacy songs without a title or lyrics. */
  skipped: number;
}

/** Reads an export: a JSON array of rows, or one JSON object per line. */
export function parseLegacyExport(content: string): LegacySong[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as LegacySong[];
  return trimmed
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LegacySong);
}

/** A stable UUID derived from `name`, so a legacy song keeps its identifier. */
function stableId(name: string): string {
  const hex = createHash('sha1').update(`worship-q legacy ${name}`).digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const clean = (value: string | null | undefined) => (value ?? '').trim();

/** Lyricist and composer, once each when they are the same person. */
function author(song: LegacySong): string {
  const names = [clean(song.lyricist), clean(song.composer)].filter(Boolean);
  return [...new Set(names)].join(', ');
}

function isLive(song: LegacySong): boolean {
  return !Number(song.deleted ?? 0) && !song.id.endsWith('-probation');
}

/** The fields an import compares and writes. */
function contentOf(song: LegacySong) {
  return {
    title: clean(song.title),
    lyrics: (song.lyrics ?? '').replace(/\r\n?/g, '\n').trim(),
    author: author(song),
    copyright: clean(song.copyright),
    ccli: clean(song.ccli) || null,
    year: typeof song.year === 'number' && song.year > 0 ? song.year : null,
  };
}

const CONTENT_KEYS = ['title', 'lyrics', 'author', 'copyright', 'ccli', 'year'] as const;

export function planLegacyImport(
  instance: Instance,
  workspaceId: string,
  songs: readonly LegacySong[],
  now: string,
): LegacyImportPlan {
  const plan: LegacyImportPlan = {
    records: [],
    added: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    kept: [],
    skipped: 0,
  };
  const existing = new Map(
    instance.records(workspaceId, 'song').map((entry) => [entry.record.id, entry]),
  );
  const seen = new Set<string>();

  const write = (id: string, revision: number, data: Record<string, unknown>) => {
    plan.records.push(
      { kind: 'song', id, key: id, revision, updatedAt: now, data },
      {
        kind: 'songRevision',
        id: stableId(`${id}:${revision}`),
        key: stableId(`${id}:${revision}`),
        revision: 1,
        updatedAt: now,
        data: { ...data, songId: id, revision },
      },
    );
  };

  for (const song of songs) {
    if (!isLive(song)) continue;
    const content = contentOf(song);
    if (!content.title || !content.lyrics) {
      plan.skipped++;
      continue;
    }
    const id = stableId(`song ${song.songId}`);
    seen.add(id);
    const current = existing.get(id);
    if (!current) {
      write(id, 1, {
        ...content,
        lineIds: assignLineIds(null, content.lyrics, randomUUID),
        background: null,
        createdAt: now,
        removedAt: null,
      });
      plan.added++;
      continue;
    }
    const data = current.record.data;
    if (current.deviceId !== LEGACY_IMPORTER) {
      plan.kept.push(content.title);
      continue;
    }
    if (CONTENT_KEYS.every((key) => data[key] === content[key]) && !data.removedAt) {
      plan.unchanged++;
      continue;
    }
    const previous = {
      lyrics: String(data.lyrics ?? ''),
      lineIds: Array.isArray(data.lineIds) ? (data.lineIds as string[]) : [],
    };
    write(id, current.record.revision + 1, {
      ...data,
      ...content,
      lineIds: assignLineIds(previous, content.lyrics, randomUUID),
      removedAt: null,
    });
    plan.updated++;
  }

  for (const [id, current] of existing) {
    if (seen.has(id) || current.record.data.removedAt) continue;
    if (current.deviceId !== LEGACY_IMPORTER) continue;
    write(id, current.record.revision + 1, { ...current.record.data, removedAt: now });
    plan.removed++;
  }
  return plan;
}

/** Stores a plan's records, giving the workspace its content identifier if it has none. */
export function applyLegacyImport(
  instance: Instance,
  workspaceId: string,
  plan: LegacyImportPlan,
): number {
  instance.claimContent(workspaceId, randomUUID());
  return instance.push(workspaceId, LEGACY_IMPORTER, plan.records).stored;
}
