/**
 * Where background files and slide images are kept: one folder per workspace, and one for
 * the Church Library's.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Workspace identifiers are UUIDs, so this never names a workspace's folder. */
const CHURCH = 'church';

export function workspaceFilesDir(dataDir: string, workspaceId: string): string {
  return join(dataDir, 'files', workspaceId);
}

export function churchFilesDir(dataDir: string): string {
  return join(dataDir, 'files', CHURCH);
}

/** A file a workspace can fetch: its own, or else the Church Library's. */
export function findFile(dataDir: string, workspaceId: string, name: string): string | null {
  for (const dir of [workspaceFilesDir(dataDir, workspaceId), churchFilesDir(dataDir)]) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/** The identifier in a deck image's name, `deck-<id>-001.jpg`, shared with its original. */
export const DECK_ID = /^deck-([0-9a-f-]{36})-/;

/**
 * The named files found in a folder, with the originals kept beside the decks among them
 * (`deck-<id>-original.*`), which no record names.
 */
function withOriginals(dir: string, names: readonly string[]): string[] {
  const all = new Set(names);
  const deckIds = new Set(
    names.map((name) => DECK_ID.exec(name)?.[1]).filter((id): id is string => !!id),
  );
  if (deckIds.size > 0) {
    for (const name of readdirSync(dir)) {
      const id = DECK_ID.exec(name)?.[1];
      if (id && deckIds.has(id) && name.startsWith(`deck-${id}-original`)) all.add(name);
    }
  }
  // A file still arriving is never moved.
  return [...all].filter((name) => !name.endsWith('.partial') && existsSync(join(dir, name)));
}

/**
 * Moves the named files of a workspace into the Church Library's, once the records using
 * them are the church's. Returns how many were moved.
 */
export function moveFilesToChurch(
  dataDir: string,
  workspaceId: string,
  names: readonly string[],
): number {
  const from = workspaceFilesDir(dataDir, workspaceId);
  if (!existsSync(from)) return 0;
  const to = churchFilesDir(dataDir);
  mkdirSync(to, { recursive: true });
  let moved = 0;
  for (const name of withOriginals(from, names)) {
    const target = join(to, name);
    // File names are unique, so one already there is the same file.
    if (existsSync(target)) rmSync(join(from, name), { force: true });
    else {
      renameSync(join(from, name), target);
      moved++;
    }
  }
  return moved;
}

/**
 * Moves the named files of the Church Library into a workspace's, once the records using
 * them are the workspace's own. Those in `shared`, which another record still uses, are
 * copied instead. Returns how many were moved or copied.
 */
export function moveFilesToWorkspace(
  dataDir: string,
  workspaceId: string,
  names: readonly string[],
  shared: readonly string[] = [],
): number {
  const from = churchFilesDir(dataDir);
  if (!existsSync(from)) return 0;
  const to = workspaceFilesDir(dataDir, workspaceId);
  mkdirSync(to, { recursive: true });
  const sharedNames = new Set(shared);
  // A deck's original is shared when its images are.
  const sharedDecks = new Set(shared.map((name) => DECK_ID.exec(name)?.[1]).filter(Boolean));
  const isShared = (name: string) =>
    sharedNames.has(name) || sharedDecks.has(DECK_ID.exec(name)?.[1]);
  let moved = 0;
  for (const name of withOriginals(from, names)) {
    const target = join(to, name);
    if (existsSync(target)) {
      if (!isShared(name)) rmSync(join(from, name), { force: true });
      continue;
    }
    if (isShared(name)) copyFileSync(join(from, name), target);
    else renameSync(join(from, name), target);
    moved++;
  }
  return moved;
}
