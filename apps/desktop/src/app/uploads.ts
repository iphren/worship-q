/**
 * The media upload queue (media uploads plan, U15, U16, U25, U26). Files are sent one at a
 * time, in the order added; each then shows its own progress until its item is ready.
 * Nothing is created before the media is ready: a deck, PDF or image becomes a song once the
 * server has converted it and its images are on this computer, a video once it is sent and
 * copied into this computer's storage. Uploads live as long as the app runs; quitting drops
 * them, and leaves nothing half-created.
 */
import {
  DeckSchema,
  deckLyrics,
  type Deck,
  type IsoDate,
  type Song,
  type SongFields,
  type Video,
} from '@worship-q/protocol';
import { t } from '../i18n';
import {
  baseName,
  isHeic,
  mediaKindOf,
  offerProblem,
  replacementKinds,
  sizeProblem,
  songMediaKind,
  titleFromFile,
  type MediaKind,
  type MediaOffer,
} from './media';

/** Where a finished upload goes. */
export type UploadTarget =
  | { kind: 'library' }
  /**
   * A run sheet: after `afterItemId`, first when it is null, last when it is undefined
   * (U16, U17). The item is also in the library.
   */
  | { kind: 'runSheet'; date: IsoDate; afterItemId?: string | null }
  /** A new version of an existing media item (U26). */
  | { kind: 'newVersion'; songId: string };

export type UploadStage =
  | { kind: 'waiting' }
  /** Being sent; a HEIC photo being converted first shows as 0 % (U25). */
  | { kind: 'uploading'; sent: number; total: number }
  /** Converted on the server and fetched back (decks, PDFs and images only, U15). */
  | { kind: 'processing' }
  | { kind: 'failed'; message: string }
  /** Ready: the song made or updated; `note` when it could not go where it was aimed. */
  | { kind: 'done'; songId: string | null; note?: string };

export interface Upload {
  readonly id: string;
  /** The file chosen, as given. */
  readonly path: string;
  readonly name: string;
  readonly kind: MediaKind;
  readonly target: UploadTarget;
  readonly stage: UploadStage;
}

/** What the queue needs from the native core, the server connection and the session. */
export interface UploadDeps {
  newId(): string;
  /** `macos`, `windows`, or another platform; HEIC is converted on macOS only (U25). */
  platform: string;
  /** What the server takes now; asked for every upload, so a changed limit is used. */
  offer(): MediaOffer | null;
  /** The server and this device's token, or null when not connected. */
  credentials(): { server: string; token: string } | null;
  fileSize(path: string): Promise<number>;
  /** A JPEG made from a HEIC photo; fails with `unreadable` or `unsupported`. */
  convertHeic(path: string): Promise<string>;
  removeConverted(path: string): Promise<void>;
  /** Reads a video's duration and size in a hidden player; fails when it cannot play it. */
  probeVideo(path: string): Promise<{ durationSeconds: number; width: number; height: number }>;
  /** Sends a file; returns the server's answer. Fails with the native core's codes. */
  upload(
    credentials: { server: string; token: string },
    id: string,
    route: 'images' | 'videos' | 'decks',
    source: string,
    name: string,
    onProgress: (sent: number, total: number) => void,
  ): Promise<string>;
  cancel(id: string): Promise<void>;
  /** Fetches a deck's images into this computer's storage. */
  fetchDeckImages(credentials: { server: string; token: string }, deck: Deck): Promise<void>;
  /** Keeps a copy of an uploaded video on this computer (U14). */
  storeVideo(source: string, file: string): Promise<void>;
  createSong(fields: Partial<SongFields>): Promise<Song>;
  saveSong(id: string, fields: Partial<SongFields>): Promise<Song>;
  getSong(id: string): Promise<Song | null>;
  canEdit(date: IsoDate): boolean;
  addSong(date: IsoDate, songId: string, afterItemId?: string | null): Promise<{ id: string }>;
}

/** An upload stopped on purpose; the entry is removed. */
class Cancelled extends Error {}

/** The reason an upload failed, from the native core's codes, for the operator. */
export function uploadMessage(
  error: unknown,
  kind: MediaKind,
  path: string,
  bytes: number | null = null,
): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code.startsWith('too-large:')) {
    // The server's own limit, which may have changed since this computer last asked.
    const limit = Number(code.slice('too-large:'.length));
    const limits = { image: limit, deck: limit, video: limit };
    return sizeProblem(kind, Math.max(bytes ?? limit + 1, limit + 1), limits)!;
  }
  if (code.startsWith('refused:')) return code.slice('refused:'.length);
  if (code.startsWith('file:')) return t('media.fileGone', { path });
  switch (code) {
    case 'proxy-too-large':
      return t('media.proxyTooBig');
    case 'connection-closed':
      return t('media.connectionClosed');
    case 'unauthorized':
      return t('media.signIn');
    case 'decks-unavailable':
      return t('media.decksUnavailable');
    case 'empty':
      return t('media.empty');
    case 'unsupported-format':
      return t('media.unsupported');
    case 'unreadable':
      return t('media.heicUnreadable');
    case 'cannot-play':
      return t('media.cannotPlay');
    case 'not-connected':
      return t('media.needsServer');
    default:
      return t('media.failed', { message: code });
  }
}

const routeOf = (kind: MediaKind) =>
  kind === 'image' ? 'images' : kind === 'video' ? 'videos' : 'decks';

/** The server's answer to a video upload. */
interface StoredVideo {
  file: string;
  source: string;
  bytes: number;
}

export class MediaUploads {
  private uploads: Upload[] = [];
  private readonly listeners = new Set<() => void>();
  /** Uploads whose cancel was asked for while being sent. */
  private readonly cancelled = new Set<string>();
  private sending: string | null = null;

  constructor(private readonly deps: UploadDeps) {}

  /** Every upload in the order added, finished ones included until dismissed. */
  get list(): readonly Upload[] {
    return this.uploads;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Queues files for one target, in the order given. Files Worship Q cannot show are left
   * out and returned, for one message naming them all.
   */
  add(paths: readonly string[], target: UploadTarget): { added: Upload[]; refused: string[] } {
    const added: Upload[] = [];
    const refused: string[] = [];
    for (const path of paths) {
      const kind = mediaKindOf(path);
      if (!kind) {
        refused.push(baseName(path));
        continue;
      }
      const upload: Upload = {
        id: this.deps.newId(),
        path,
        name: baseName(path),
        kind,
        target,
        stage: { kind: 'waiting' },
      };
      this.uploads = [...this.uploads, upload];
      added.push(upload);
    }
    this.changed();
    this.pump();
    return { added, refused };
  }

  /** Sends a failed upload again from the start, to the same target. */
  retry(id: string): void {
    const upload = this.find(id);
    if (upload?.stage.kind !== 'failed') return;
    // Back to the end of the queue.
    this.uploads = [
      ...this.uploads.filter((u) => u.id !== id),
      { ...upload, stage: { kind: 'waiting' } },
    ];
    this.changed();
    this.pump();
  }

  /** Forgets a failed or finished upload. */
  dismiss(id: string): void {
    const upload = this.find(id);
    if (!upload || (upload.stage.kind !== 'failed' && upload.stage.kind !== 'done')) return;
    this.remove(id);
  }

  /** Stops an upload while waiting or being sent; not once the server is processing it. */
  async cancel(id: string): Promise<void> {
    const upload = this.find(id);
    if (!upload) return;
    if (upload.stage.kind === 'waiting') return this.remove(id);
    if (upload.stage.kind !== 'uploading') return;
    this.cancelled.add(id);
    await this.deps.cancel(id);
  }

  /** Whether an upload can still be cancelled. */
  static cancellable(upload: Upload): boolean {
    return upload.stage.kind === 'waiting' || upload.stage.kind === 'uploading';
  }

  private find(id: string): Upload | undefined {
    return this.uploads.find((upload) => upload.id === id);
  }

  private remove(id: string): void {
    this.uploads = this.uploads.filter((upload) => upload.id !== id);
    this.cancelled.delete(id);
    this.changed();
  }

  private set(id: string, stage: UploadStage): void {
    this.uploads = this.uploads.map((upload) => (upload.id === id ? { ...upload, stage } : upload));
    this.changed();
  }

  private retarget(id: string, target: UploadTarget): void {
    this.uploads = this.uploads.map((upload) =>
      upload.id === id ? { ...upload, target } : upload,
    );
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** Starts the next waiting upload, unless one is being sent. */
  private pump(): void {
    if (this.sending) return;
    const next = this.uploads.find((upload) => upload.stage.kind === 'waiting');
    if (!next) return;
    this.sending = next.id;
    void this.run(next.id);
  }

  /** Lets the next upload be sent: this one's last byte went, or it ended. */
  private release(id: string): void {
    if (this.sending !== id) return;
    this.sending = null;
    this.pump();
  }

  private async run(id: string): Promise<void> {
    const upload = this.find(id)!;
    let converted: string | null = null;
    let bytes: number | null = null;
    try {
      this.set(id, { kind: 'uploading', sent: 0, total: 0 });
      const credentials = this.deps.credentials();
      if (!credentials) throw new Error('not-connected');
      const offerProblemText = offerProblem(upload.kind, this.deps.offer());
      if (offerProblemText) throw new Refusal(offerProblemText);
      if (upload.target.kind === 'newVersion') await this.checkReplacement(upload);

      let source = upload.path;
      let name = upload.name;
      if (isHeic(upload.path)) {
        if (this.deps.platform !== 'macos') throw new Refusal(t('media.heicWindows'));
        // Checked before converting too, so a file that was moved fails plainly.
        await this.deps.fileSize(upload.path);
        converted = await this.deps.convertHeic(upload.path);
        if (this.cancelled.has(id)) throw new Cancelled();
        source = converted;
        name = `${titleStem(upload.name)}.jpg`;
      }
      bytes = await this.deps.fileSize(source);
      const problem = sizeProblem(upload.kind, bytes, this.deps.offer()!.limits);
      if (problem) throw new Refusal(problem);

      const probe = upload.kind === 'video' ? await this.probe(upload.path) : null;
      if (this.cancelled.has(id)) throw new Cancelled();

      let sentAll = false;
      const answer = await this.deps.upload(
        credentials,
        id,
        routeOf(upload.kind),
        source,
        name,
        (sent, total) => {
          const current = this.find(id)?.stage;
          if (current?.kind !== 'uploading') return;
          // Never backwards, never past the end.
          const done = Math.min(total, Math.max(sent, current.sent));
          this.set(id, { kind: 'uploading', sent: done, total });
          if (total > 0 && done >= total && !sentAll) {
            sentAll = true;
            // The server works on decks, PDFs and images while the next file is sent.
            if (upload.kind !== 'video') this.set(id, { kind: 'processing' });
            this.release(id);
          }
        },
      );
      if (upload.kind !== 'video') this.set(id, { kind: 'processing' });
      this.release(id);

      const fields =
        upload.kind === 'video'
          ? await this.videoFields(upload, answer, probe!)
          : await this.deckFields(credentials, answer);
      await this.finish(this.find(id)!, fields);
    } catch (error) {
      if (error instanceof Cancelled || this.cancelled.has(id) || isCode(error, 'cancelled')) {
        this.remove(id);
      } else if (isCode(error, 'unauthorized')) {
        // A revoked device: every upload waiting would fail the same way.
        const message = uploadMessage(error, upload.kind, upload.path);
        for (const other of this.uploads) {
          if (other.id === id || other.stage.kind === 'waiting') {
            this.set(other.id, { kind: 'failed', message });
          }
        }
      } else {
        const message =
          error instanceof Refusal
            ? error.message
            : uploadMessage(error, upload.kind, upload.path, bytes);
        this.set(id, { kind: 'failed', message });
      }
    } finally {
      // After a failure is recorded, so a revoked device fails the rest instead of sending.
      this.release(id);
      if (converted) await this.deps.removeConverted(converted).catch(() => undefined);
    }
  }

  private async probe(path: string) {
    try {
      const probe = await this.deps.probeVideo(path);
      if (!(probe.width > 0)) throw new Error('no picture');
      return probe;
    } catch {
      throw new Refusal(t('media.cannotPlay'));
    }
  }

  /** A new version must be of a kind the item can take (U26). */
  private async checkReplacement(upload: Upload): Promise<void> {
    if (upload.target.kind !== 'newVersion') return;
    const song = await this.deps.getSong(upload.target.songId);
    const current = song ? songMediaKind(song) : null;
    if (current && !replacementKinds(current).includes(upload.kind)) {
      throw new Refusal(t('media.videoOnly'));
    }
  }

  private async deckFields(
    credentials: { server: string; token: string },
    answer: string,
  ): Promise<Partial<SongFields>> {
    const deck = DeckSchema.parse(JSON.parse(answer));
    await this.deps.fetchDeckImages(credentials, deck);
    return { lyrics: deckLyrics(deck), deck, video: null };
  }

  private async videoFields(
    upload: Upload,
    answer: string,
    probe: { durationSeconds: number; width: number; height: number },
  ): Promise<Partial<SongFields>> {
    const stored = JSON.parse(answer) as StoredVideo;
    // Copied before the song exists, so it plays here without a download (U14).
    await this.deps.storeVideo(upload.path, stored.file);
    const video: Video = {
      file: stored.file,
      source: upload.name,
      width: Math.round(probe.width),
      height: Math.round(probe.height),
      durationSeconds: probe.durationSeconds,
      bytes: stored.bytes,
      autoplay: false,
    };
    return { lyrics: '', deck: null, video };
  }

  /** Makes or updates the song, and places it where the upload was aimed. */
  private async finish(upload: Upload, fields: Partial<SongFields>): Promise<void> {
    const { target } = upload;
    if (target.kind === 'newVersion') {
      const song = await this.deps.getSong(target.songId);
      // The item was deleted meanwhile: nothing is recreated; the files are left to the
      // server's retention sweep.
      if (!song || song.removedAt) {
        this.set(upload.id, { kind: 'done', songId: null });
        return;
      }
      // Autoplay belongs to the item, not the file (U23).
      if (fields.video && song.video)
        fields.video = { ...fields.video, autoplay: song.video.autoplay };
      const saved = await this.deps.saveSong(song.id, fields);
      this.set(upload.id, { kind: 'done', songId: saved.id });
      return;
    }
    const song = await this.deps.createSong({ title: titleFromFile(upload.name), ...fields });
    if (target.kind === 'library') {
      this.set(upload.id, { kind: 'done', songId: song.id });
      return;
    }
    if (!this.deps.canEdit(target.date)) {
      this.set(upload.id, {
        kind: 'done',
        songId: song.id,
        note: t('media.notAddedToRunSheet', { date: target.date }),
      });
      return;
    }
    const item = await this.deps.addSong(target.date, song.id, target.afterItemId);
    this.landed(upload, item.id);
    this.set(upload.id, { kind: 'done', songId: song.id });
  }

  /**
   * Later uploads aimed at the same place now follow the item just placed, so uploads land
   * in the order they were added, whichever finishes first.
   */
  private landed(upload: Upload, itemId: string): void {
    const { target } = upload;
    if (target.kind !== 'runSheet' || target.afterItemId === undefined) return;
    const index = this.uploads.findIndex((u) => u.id === upload.id);
    for (const later of this.uploads.slice(index + 1)) {
      const aim = later.target;
      if (
        aim.kind === 'runSheet' &&
        aim.date === target.date &&
        aim.afterItemId === target.afterItemId &&
        later.stage.kind !== 'done'
      ) {
        this.retarget(later.id, { ...aim, afterItemId: itemId });
      }
    }
  }
}

/** A failure with the message to show as it is. */
class Refusal extends Error {}

function isCode(error: unknown, code: string): boolean {
  return (error instanceof Error ? error.message : String(error)) === code;
}

function titleStem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
