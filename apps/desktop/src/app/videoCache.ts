/**
 * This computer's copies of videos (media uploads plan, U8, U9, U29, U30). Every video in a
 * run sheet dated today or later is fetched ahead of time, one at a time, earliest run sheet
 * first, so a service never streams from the server. The live run sheet's videos count too,
 * even once its date has passed, so a run sheet kept live past its day still plays. A pass
 * runs after each pull and each run sheet edit, and never deletes anything.
 *
 * Copies are removed once per launch, 30 minutes after the app opens (U29): those used only
 * by past run sheets, and those no song names. A copy the church server also keeps is
 * deleted silently; the others are local-only, the only copy there is, and are offered to
 * the operator first (U30). Without a church server every copy is local-only.
 */
import type { IsoDate } from '@worship-q/protocol';
import type { VideoUse } from '@worship-q/store';
import { t } from '@worship-q/i18n/desktop';

/** How long after the app opens copies are removed (U29). */
export const CLEANUP_AFTER_MS = 30 * 60 * 1000;
/** Local-only copies under this total are not offered; they wait until there is more (U30). */
export const CLEANUP_MIN_BYTES = 100 * 1024 * 1024;
/** A copy the operator kept is not offered again for this many days (U30). */
export const SNOOZE_DAYS = 30;

/** A local-only copy offered for removal (U30). */
export interface CleanupVideo {
  file: string;
  title: string;
  /** Where the copy is, in the app's folder; never the file it was added from. */
  path: string;
  bytes: number;
}

/** The banner's offer: local-only copies and what removing them all would free. */
export interface CleanupOffer {
  videos: CleanupVideo[];
  totalBytes: number;
}

/** What removing the operator's choice did. */
export interface CleanupResult {
  freedBytes: number;
  removed: number;
  /** Copies that could not be deleted, such as one open in a player on Windows. */
  failed: number;
  /** Copies kept because a run sheet came to need them while the window was open. */
  needed: number;
}

export type CopyStatus =
  | { kind: 'ready' }
  | { kind: 'waiting' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'failed'; message: string };

export interface VideoCacheDeps {
  /** Today in the workspace's time zone. */
  today(): IsoDate;
  /** The videos of run sheets dated `from` or later, earliest first. */
  wanted(from: IsoDate): Promise<{ file: string; date: IsoDate }[]>;
  /** The date of the run sheet that is live, if any. */
  liveDate(): IsoDate | null;
  /** The copies this computer has, complete ones only. */
  list(): Promise<string[]>;
  /** Fetches a copy; fails with the native core's code. False when not connected. */
  fetch(file: string, onProgress: (done: number, total: number) => void): Promise<void>;
  remove(file: string): Promise<void>;
  /** Whether the server can be asked now. */
  connected(): boolean;
  /** Where the day each upload's copy was made is kept, across restarts. */
  uploads: { get(): Record<string, IsoDate>; set(value: Record<string, IsoDate>): void };
  /** Every video file the workspace's songs name, and what uses it (U29). */
  uses(): Promise<VideoUse[]>;
  /** Milliseconds since the app opened, by the clock: timers slow down in a hidden window. */
  elapsed(): number;
  /**
   * Whether the church server keeps the file: null when it cannot be asked, or answers
   * anything but yes or no (U30). Only asked while connected to a church server.
   */
  serverHas(file: string): Promise<boolean | null>;
  /** Where a copy is and how large; null when it is gone. */
  copy(file: string): Promise<{ path: string; bytes: number } | null>;
  /** The day each copy the operator kept was kept, by file, across restarts (U30). */
  snoozes: { get(): Record<string, IsoDate>; set(value: Record<string, IsoDate>): void };
}

/** Days from `from` to `to`, both dates. */
function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Which copies U29 removes, of those this computer has: used only by run sheets dated before
 * today and not live, or named by no song in the library. A copy no run sheet uses yet, such
 * as one just added, is kept; so is one uploaded today.
 */
export function removable(
  have: readonly string[],
  uses: readonly VideoUse[],
  today: IsoDate,
  liveDate: IsoDate | null,
  uploadedToday: ReadonlySet<string> = new Set(),
): string[] {
  const byFile = new Map(uses.map((use) => [use.file, use]));
  return have.filter((file) => {
    if (uploadedToday.has(file)) return false;
    const use = byFile.get(file);
    // (b) No song names it, or only removed ones do.
    if (!use || use.removed) return true;
    // Not on any run sheet yet: kept.
    if (use.dates.length === 0) return false;
    // (a) Only past run sheets use it, and none of them is live.
    return use.dates.every((date) => date < today && date !== liveDate);
  });
}

/** The operator's message for a failed fetch. */
function fetchMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return code === 'disk-full' ? t('media.diskFull') : code;
}

export class VideoCache {
  private status_ = new Map<string, CopyStatus>();
  private readonly listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: VideoCacheDeps) {}

  /** A video's state on this computer; undefined for one nothing upcoming uses. */
  status(file: string): CopyStatus | undefined {
    return this.status_.get(file);
  }

  get statuses(): ReadonlyMap<string, CopyStatus> {
    return this.status_;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Counts this computer's copy of an uploaded video as wanted today (U14). */
  uploaded(file: string): void {
    this.deps.uploads.set({ ...this.deps.uploads.get(), [file]: this.deps.today() });
    this.set(file, { kind: 'ready' });
  }

  /** Runs a pass now, or once more after the one running. */
  pass(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.once();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private set(file: string, status: CopyStatus | null): void {
    const next = new Map(this.status_);
    if (status) next.set(file, status);
    else next.delete(file);
    this.status_ = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * The videos to keep, in fetch order: a live run sheet dated before today first (its own
   * videos only, not those of run sheets between it and today), then today's and later.
   */
  private async wanted(today: IsoDate): Promise<{ file: string; date: IsoDate }[]> {
    const upcoming = await this.deps.wanted(today);
    const live = this.deps.liveDate();
    if (!live || live >= today) return upcoming;
    // Each video comes with its earliest date from `live` on, so the live run sheet's are
    // exactly those dated `live`.
    const past = (await this.deps.wanted(live)).filter((video) => video.date === live);
    const files = new Set(past.map((video) => video.file));
    return [...past, ...upcoming.filter((video) => !files.has(video.file))];
  }

  private async once(): Promise<void> {
    const today = this.deps.today();
    const wanted = await this.wanted(today);
    const wantedFiles = new Set(wanted.map((video) => video.file));
    // An upload's copy counts on the day it was made, and is forgotten after.
    const uploads = Object.fromEntries(
      Object.entries(this.deps.uploads.get()).filter(([, day]) => day === today),
    );
    this.deps.uploads.set(uploads);
    const keep = new Set([...wantedFiles, ...Object.keys(uploads)]);

    // Nothing is deleted here: copies are removed once per launch, by `cleanup` (U29).
    const have = new Set(await this.deps.list());
    for (const file of this.status_.keys()) {
      if (!keep.has(file)) this.set(file, null);
    }
    for (const file of keep) {
      if (have.has(file)) this.set(file, { kind: 'ready' });
      else if (this.status_.get(file)?.kind !== 'failed') this.set(file, { kind: 'waiting' });
    }

    if (!this.deps.connected()) return;
    // Earliest run sheet first; a failure waits for the next pass.
    for (const { file } of wanted) {
      if (have.has(file)) continue;
      this.set(file, { kind: 'downloading', done: 0, total: 0 });
      try {
        await this.deps.fetch(file, (done, total) =>
          this.set(file, { kind: 'downloading', done, total }),
        );
        this.set(file, { kind: 'ready' });
      } catch (error) {
        this.set(file, { kind: 'failed', message: fetchMessage(error) });
      }
    }
  }

  // ── Removing copies (U29, U30) ─────────────────────────────────────────

  private cleanupDone = false;
  private offer_: CleanupOffer | null = null;

  /** Local-only copies offered for removal, for the banner; null when there is no offer. */
  get offer(): CleanupOffer | null {
    return this.offer_;
  }

  /**
   * Removes copies once per launch, the first time it is called 30 minutes or more after the
   * app opened (U29). Called every minute, and after each pass. Copies the church server
   * keeps go silently; local-only ones are offered (U30). Nothing is removed or offered at
   * all when the church server cannot answer, since the two cannot then be told apart.
   */
  async tick(): Promise<void> {
    if (this.cleanupDone || this.deps.elapsed() < CLEANUP_AFTER_MS) return;
    this.cleanupDone = true;
    const candidates = await this.candidates();
    const silent: string[] = [];
    const local: string[] = [];
    if (this.deps.connected()) {
      for (const file of candidates) {
        const has = await this.deps.serverHas(file);
        if (has === null) return;
        (has ? silent : local).push(file);
      }
    } else {
      local.push(...candidates);
    }
    for (const file of silent) await this.deps.remove(file).catch(() => undefined);

    const today = this.deps.today();
    const snoozes = this.liveSnoozes(today);
    const videos: CleanupVideo[] = [];
    const titles = new Map((await this.deps.uses()).map((use) => [use.file, use.title]));
    for (const file of local) {
      if (snoozes[file]) continue;
      const copy = await this.deps.copy(file);
      if (copy) videos.push({ file, title: titles.get(file) ?? file, ...copy });
    }
    const totalBytes = videos.reduce((sum, video) => sum + video.bytes, 0);
    this.offer_ = totalBytes >= CLEANUP_MIN_BYTES ? { videos, totalBytes } : null;
    if (this.offer_ || silent.length > 0) this.notify();
  }

  /**
   * Removes the copies the operator ticked, checking each again first, and keeps the rest
   * for 30 days (U30). The offer ends.
   */
  async removeSelected(files: readonly string[]): Promise<CleanupResult> {
    const offer = this.offer_;
    const result: CleanupResult = { freedBytes: 0, removed: 0, failed: 0, needed: 0 };
    if (!offer) return result;
    const chosen = new Set(files);
    const still = new Set(await this.candidates());
    const kept: string[] = [];
    for (const video of offer.videos) {
      if (!chosen.has(video.file)) {
        kept.push(video.file);
        continue;
      }
      if (!still.has(video.file)) {
        result.needed++;
        continue;
      }
      try {
        await this.deps.remove(video.file);
        result.freedBytes += video.bytes;
        result.removed++;
      } catch {
        result.failed++;
      }
    }
    this.snooze(kept);
    this.offer_ = null;
    this.notify();
    return result;
  }

  /** Hides the banner, keeping every offered copy for 30 days (U30). */
  dismissOffer(): void {
    if (!this.offer_) return;
    this.snooze(this.offer_.videos.map((video) => video.file));
    this.offer_ = null;
    this.notify();
  }

  private async candidates(): Promise<string[]> {
    const today = this.deps.today();
    const uploadedToday = new Set(
      Object.entries(this.deps.uploads.get())
        .filter(([, day]) => day === today)
        .map(([file]) => file),
    );
    return removable(
      await this.deps.list(),
      await this.deps.uses(),
      today,
      this.deps.liveDate(),
      uploadedToday,
    );
  }

  /** The snoozes still running; ended ones are forgotten. */
  private liveSnoozes(today: IsoDate): Record<string, IsoDate> {
    const live = Object.fromEntries(
      Object.entries(this.deps.snoozes.get()).filter(
        ([, day]) => daysBetween(day, today) <= SNOOZE_DAYS,
      ),
    );
    this.deps.snoozes.set(live);
    return live;
  }

  private snooze(files: readonly string[]): void {
    if (files.length === 0) return;
    const today = this.deps.today();
    const next = { ...this.liveSnoozes(today) };
    for (const file of files) next[file] = today;
    this.deps.snoozes.set(next);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
