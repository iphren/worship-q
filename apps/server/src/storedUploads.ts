/**
 * Uploads stored once (media uploads plan, U28). The server remembers the SHA-256 of every
 * video, slide deck and image as it was uploaded, with what the upload answered. The same
 * file uploaded again is answered with the files already kept, and the new copy is dropped.
 *
 * A remembered upload is only a hint. It is used again only when its files are still where
 * the workspace can fetch them, and a song that is not deleted names every one of them:
 * files named only by a deleted song are waiting for the retention sweep (D34), and could be
 * gone before the device saves its new song.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DeckSchema, VIDEO_FILE, type Deck } from '@worship-q/protocol';
import { churchFilesDir, DECK_ID, workspaceFilesDir } from './files';
import { fileNamesOf, type Instance } from './instance';

/** Slide decks and images are both kept as decks, but come by different routes. */
export type StoredKind = 'video' | 'deck' | 'image';

/** Set in `counter` once the files kept before this work have been hashed. */
const BACKFILLED = 'stored_upload_backfill';

/** The SHA-256 of a file, read in pieces. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

function remember(
  instance: Instance,
  ref: string,
  kind: StoredKind,
  hash: string,
  result: unknown,
  replace = true,
): void {
  instance.db
    .prepare(
      `INSERT OR ${replace ? 'REPLACE' : 'IGNORE'} INTO stored_upload
       (ref, kind, hash, result, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ref, kind, hash, JSON.stringify(result), instance.now());
}

/** Remembers a video stored as `file`. */
export function rememberVideo(instance: Instance, hash: string, file: string): void {
  remember(instance, file, 'video', hash, { file });
}

/** The identifier a deck's files share, as `deck-<id>`; null when they do not share one. */
function deckRef(deck: Deck): string | null {
  const ids = new Set(fileNamesOf('song', { deck }).map((name) => DECK_ID.exec(name)?.[1]));
  const [id] = [...ids];
  return ids.size === 1 && id ? `deck-${id}` : null;
}

/** Remembers a deck made from an upload, or made again from its original (U4). */
export function rememberDeck(instance: Instance, hash: string, deck: Deck): void {
  const ref = deckRef(deck);
  if (ref) remember(instance, ref, deck.kind === 'image' ? 'image' : 'deck', hash, deck);
}

/** The files named by the songs a workspace sees that are not deleted: its own and the church's. */
function liveFiles(instance: Instance, workspaceId: string): Set<string> {
  const names = new Set<string>();
  for (const { record, workspaceId: owner } of instance.allRecords('song')) {
    if (owner !== null && owner !== workspaceId) continue;
    if (record.data.removedAt) continue;
    for (const name of fileNamesOf('song', record.data)) names.add(name);
  }
  return names;
}

/** Remembered uploads with this content, the newest first. */
function candidates(instance: Instance, kind: StoredKind, hash: string) {
  return instance.db
    .prepare(
      'SELECT ref, result FROM stored_upload WHERE hash = ? AND kind = ? ORDER BY rowid DESC',
    )
    .all(hash, kind)
    .map((row) => ({ ref: String(row.ref), result: String(row.result) }));
}

/** The first of `dirs` that holds every one of `names`. */
const holding = (dirs: readonly string[], names: readonly string[]) =>
  dirs.find((dir) => names.every((name) => existsSync(join(dir, name))));

/**
 * A video already kept with the content of the one just uploaded, if it can be used again.
 * `dirs` are the folders the workspace's new song may name files in: where its uploads go,
 * and the Church Library's. `extension` is the upload's, which the kept file must share,
 * since a video is served by its extension.
 */
export function findStoredVideo(
  instance: Instance,
  dirs: readonly string[],
  workspaceId: string,
  hash: string,
  extension: string,
): { file: string; bytes: number } | null {
  let live: Set<string> | null = null;
  for (const { ref } of candidates(instance, 'video', hash)) {
    if (!VIDEO_FILE.test(ref) || extname(ref) !== extension) continue;
    const dir = holding(dirs, [ref]);
    if (!dir) continue;
    live ??= liveFiles(instance, workspaceId);
    if (!live.has(ref)) continue;
    return { file: ref, bytes: statSync(join(dir, ref)).size };
  }
  return null;
}

/**
 * A deck already made from the content of the file just uploaded, if it can be used again:
 * the newest conversion whose images, small copies and original are all still kept together.
 * See `findStoredVideo` for `dirs` and `extension`.
 */
export function findStoredDeck(
  instance: Instance,
  dirs: readonly string[],
  workspaceId: string,
  kind: 'deck' | 'image',
  hash: string,
  extension: string,
): Deck | null {
  let live: Set<string> | null = null;
  for (const { ref, result } of candidates(instance, kind, hash)) {
    let deck: Deck;
    try {
      deck = DeckSchema.parse(JSON.parse(result));
    } catch {
      continue;
    }
    const names = fileNamesOf('song', { deck });
    if (names.length === 0 || deckRef(deck) !== ref) continue;
    // The original is kept too, so the deck can still be downloaded and converted again.
    if (!holding(dirs, [...names, `${ref}-original${extension}`])) continue;
    live ??= liveFiles(instance, workspaceId);
    if (!names.every((name) => live!.has(name))) continue;
    return deck;
  }
  return null;
}

/** Forgets the uploads whose files were removed. */
export function forgetStoredFiles(instance: Instance, names: Iterable<string>): void {
  const refs = new Set<string>();
  for (const name of names) {
    const id = DECK_ID.exec(name)?.[1];
    if (id) refs.add(`deck-${id}`);
    else if (VIDEO_FILE.test(name)) refs.add(name);
  }
  const forget = instance.db.prepare('DELETE FROM stored_upload WHERE ref = ?');
  for (const ref of refs) forget.run(ref);
}

/**
 * Hashes the videos and deck originals kept before uploads were remembered, once: those the
 * songs of every workspace and of the Church Library name. Returns how many were remembered,
 * or null when it had already run. A file that cannot be read is left out; a run that is cut
 * off starts again at the next start and skips what it had done.
 */
export async function backfillStoredUploads(
  instance: Instance,
  dataDir: string,
): Promise<number | null> {
  const done = instance.db.prepare('SELECT 1 FROM counter WHERE name = ?').get(BACKFILLED);
  if (done) return null;
  const known = instance.db.prepare('SELECT 1 FROM stored_upload WHERE ref = ?');
  const church = churchFilesDir(dataDir);
  let remembered = 0;
  const add = async (ref: string, kind: StoredKind, path: string, result: unknown) => {
    try {
      const hash = await hashFile(path);
      // An upload that arrived meanwhile is newer, and stays.
      remember(instance, ref, kind, hash, result, false);
      remembered++;
    } catch {
      // Removed while it was read, or unreadable: it is stored again if uploaded again.
    }
  };
  for (const { record, workspaceId } of instance.allRecords('song')) {
    const dirs =
      workspaceId === null ? [church] : [workspaceFilesDir(dataDir, workspaceId), church];
    const video = (record.data.video as { file?: unknown } | null | undefined)?.file;
    if (typeof video === 'string' && VIDEO_FILE.test(video) && !known.get(video)) {
      const dir = holding(dirs, [video]);
      if (dir) await add(video, 'video', join(dir, video), { file: video });
    }
    const deck = DeckSchema.safeParse(record.data.deck);
    const ref = deck.success ? deckRef(deck.data) : null;
    if (!deck.success || !ref || known.get(ref)) continue;
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const original = readdirSync(dir).find(
        (name) => name.startsWith(`${ref}-original.`) && !name.endsWith('.partial'),
      );
      if (!original) continue;
      await add(ref, deck.data.kind === 'image' ? 'image' : 'deck', join(dir, original), deck.data);
      break;
    }
  }
  instance.db.prepare('INSERT OR REPLACE INTO counter (name, value) VALUES (?, 1)').run(BACKFILLED);
  return remembered;
}
