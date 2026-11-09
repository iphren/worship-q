/**
 * This computer's copies of videos (media uploads plan, U8, U9). Every video in a run sheet
 * dated today or later is fetched ahead of time, one at a time, earliest run sheet first, so
 * a service never streams from the server. The live run sheet's videos count too, even once
 * its date has passed, so a run sheet kept live past its day still plays. A copy nothing
 * upcoming or live uses is deleted; the copy made by uploading a video is kept on the day it
 * was made. A pass runs after each pull and each run sheet edit.
 */
import type { IsoDate } from '@worship-q/protocol';

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
}

/** The operator's message for a failed fetch. */
function fetchMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return code === 'disk-full' ? 'Not enough space on this computer.' : code;
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

    const have = new Set(await this.deps.list());
    for (const file of have) {
      if (keep.has(file)) continue;
      await this.deps.remove(file).catch(() => undefined);
      have.delete(file);
    }
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
}
