/**
 * The retention sweep (decision D34): the files of songs and backgrounds deleted longer ago
 * than the retention period are removed, and the records marked, so a later restore knows
 * the files are gone. Records themselves are kept; they are small and carry the history.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { churchFilesDir, DECK_ID, workspaceFilesDir } from './files';
import type { DeletedItem, Instance } from './instance';

export const DEFAULT_RETENTION_DAYS = 90;
export const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  items: DeletedItem[];
  files: number;
}

/** The retention period from the environment, or the default; never less than a day. */
export function retentionDaysFromEnv(env: Record<string, string | undefined>): number {
  const value = Number(env.WORSHIP_Q_RETENTION_DAYS);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_RETENTION_DAYS;
}

/**
 * Removes the files of items deleted more than `retentionDays` before now. Returns what was
 * swept. Safe to run any time: items already swept are marked and left alone.
 */
export function sweepDeletedFiles(
  instance: Instance,
  dataDir: string,
  retentionDays: number,
  now: string = instance.now(),
): SweepResult {
  const before = new Date(Date.parse(now) - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const candidates = instance.deletedItems(before);
  const inUse = instance.filesInUse(before);
  // An item whose files something else still uses keeps them all, and is looked at again
  // at the next sweep; it can still be restored meanwhile.
  const items = candidates.filter((item) => !item.fileNames.some((name) => inUse.has(name)));
  let files = 0;
  for (const item of items) {
    const dir =
      item.workspaceId === null
        ? churchFilesDir(dataDir)
        : workspaceFilesDir(dataDir, item.workspaceId);
    const names = new Set(item.fileNames);
    // A deck's original is kept beside its images under the same identifier.
    const deckIds = new Set(
      item.fileNames.map((name) => DECK_ID.exec(name)?.[1]).filter((id): id is string => !!id),
    );
    if (deckIds.size > 0 && existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        const id = DECK_ID.exec(name)?.[1];
        if (id && deckIds.has(id) && name.startsWith(`deck-${id}-original`)) names.add(name);
      }
    }
    for (const name of names) {
      const path = join(dir, name);
      if (existsSync(path)) {
        rmSync(path, { force: true });
        files++;
      }
    }
    instance.markFilesRemoved(item);
  }
  return { items, files };
}
