/**
 * Where background files and slide images are kept: one folder per workspace, and one for
 * the Church Library's.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
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

/**
 * Moves a workspace's files into the Church Library's, once its songs and backgrounds
 * are the church's. Returns how many were moved.
 */
export function moveFilesToChurch(dataDir: string, workspaceId: string): number {
  const from = workspaceFilesDir(dataDir, workspaceId);
  if (!existsSync(from)) return 0;
  const to = churchFilesDir(dataDir);
  mkdirSync(to, { recursive: true });
  let moved = 0;
  for (const name of readdirSync(from)) {
    if (name.endsWith('.partial')) continue;
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
