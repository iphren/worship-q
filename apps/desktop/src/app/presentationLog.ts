/**
 * The presentation log on the coordinator (service records R12, R15, R17, R18; task M4.3).
 * Each snapshot the coordinator publishes is turned into log events with `logEvents`; an
 * entry opens with the revision of the song then on screen and the background in use, and is
 * kept in the local outbox until the church server has it. Entries are sent in batches: a
 * second after a change, and every half minute while any wait. Only the coordinator writes:
 * `LiveLink` calls `observe` from the snapshots it publishes, and `observe(null)` when it
 * stops coordinating, which closes the open entry.
 */
import { logEvents, showingOf, type RevisedShowing } from '@worship-q/live-state';
import {
  LOG_BATCH_MAX,
  type LiveSnapshot,
  type LogBackground,
  type LogBatch,
  type LogEntry,
} from '@worship-q/protocol';
import type { Store } from '@worship-q/store';

/** A change is sent this long after it, so a quick run of changes goes together. */
export const LOG_SEND_DELAY_MS = 1000;
/** While entries wait, they are tried again this often. */
export const LOG_RETRY_MS = 30_000;

export interface PresentationLoggerDeps {
  store: Pick<
    Store,
    | 'getSong'
    | 'listSongRevisions'
    | 'getSongBackground'
    | 'getOutputProfile'
    | 'getRunSheet'
    | 'putLogEntry'
    | 'pendingLogEntries'
    | 'logEntriesSent'
    | 'dropOldLogEntries'
  >;
  /** Sends a batch to the church server; rejects when it did not arrive. */
  send: (batch: LogBatch) => Promise<void>;
  /** The church server takes log entries (its `info.records.log`); nothing is sent otherwise. */
  offered: () => boolean;
  now?: () => number;
  newId?: () => string;
}

interface Open {
  showing: RevisedShowing;
  entry: LogEntry;
}

export class PresentationLogger {
  private open: Open | null = null;
  /** Observations are applied one at a time, in the order the snapshots were published. */
  private queue: Promise<void> = Promise.resolve();
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private sending = false;
  private stopped = false;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: PresentationLoggerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.retryTimer = setInterval(() => void this.flush(), LOG_RETRY_MS);
    void deps.store.dropOldLogEntries().catch(() => undefined);
  }

  /** A snapshot this computer published as coordinator; null when it stops coordinating. */
  observe(snapshot: LiveSnapshot | null): Promise<void> {
    if (this.stopped) return this.queue;
    const at = new Date(this.now()).toISOString();
    this.queue = this.queue
      .then(() => this.apply(snapshot, at))
      .catch((error: unknown) => console.warn('Presentation log', error));
    return this.queue;
  }

  private async apply(snapshot: LiveSnapshot | null, at: string): Promise<void> {
    const showing = showingOf(snapshot);
    const song = showing ? await this.deps.store.getSong(showing.songId) : null;
    const version = song?.versions ? (song.useChurchVersion ? 'church' : 'own') : null;
    const revision =
      song === null
        ? null
        : version === 'church'
          ? song.versions!.church.revision
          : (song.versions?.own.revision ?? song.revision);
    const next: RevisedShowing | null = showing ? { ...showing, revision } : null;
    const events = logEvents(this.open?.showing ?? null, next);
    if (events.close && this.open) {
      await this.deps.store.putLogEntry({ ...this.open.entry, endedAt: at });
      this.open = null;
    }
    if (events.open && snapshot) {
      const shown = events.open;
      let revisionId: string | null = null;
      if (song && version !== 'church') {
        const revisions = await this.deps.store.listSongRevisions(song.id);
        revisionId = revisions.find((r) => r.revision === shown.revision)?.id ?? null;
      }
      const date =
        shown.date ?? (await this.deps.store.getRunSheet(shown.runSheetId))?.date ?? snapshot.date;
      const entry: LogEntry = {
        id: this.newId(),
        runSheetId: shown.runSheetId,
        date,
        itemId: shown.itemId,
        previous: shown.previous,
        songId: shown.songId,
        revision: shown.revision ?? 1,
        revisionId,
        version,
        part: shown.part,
        background: song ? await this.background(song) : null,
        startedAt: at,
        endedAt: null,
      };
      await this.deps.store.putLogEntry(entry);
      this.open = { showing: shown, entry };
    }
    if (events.close || events.open) this.scheduleSend();
  }

  /** The background in use: the song's own, or else the slideshow's (R15). */
  private async background(
    song: NonNullable<Awaited<ReturnType<Store['getSong']>>>,
  ): Promise<LogBackground> {
    const own = await this.deps.store.getSongBackground(song);
    if (own) return { color: own.color, assetId: own.assetId };
    const profile = await this.deps.store.getOutputProfile(song.workspaceId, 'slideshow');
    return { color: profile.backgroundColor, assetId: profile.backgroundAssetId };
  }

  private scheduleSend(): void {
    if (this.sendTimer || this.stopped) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      void this.flush();
    }, LOG_SEND_DELAY_MS);
  }

  /** Sends what waits, in batches, until nothing waits or a batch fails. */
  async flush(): Promise<void> {
    if (this.sending || !this.deps.offered()) return;
    this.sending = true;
    try {
      for (;;) {
        const pending = await this.deps.store.pendingLogEntries(LOG_BATCH_MAX);
        if (pending.length === 0) return;
        await this.deps.send({
          sentAt: new Date(this.now()).toISOString(),
          entries: pending.map((p) => p.entry),
        });
        await this.deps.store.logEntriesSent(pending);
        if (pending.length < LOG_BATCH_MAX) return;
      }
    } catch {
      // Tried again on the next tick; the entries wait meanwhile.
    } finally {
      this.sending = false;
    }
  }

  /** Closes the open entry, as when the app quits, and stops the timers. */
  async stop(): Promise<void> {
    await this.observe(null);
    this.dispose();
  }

  /** Stops at once, writing nothing more. */
  dispose(): void {
    this.stopped = true;
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.sendTimer = null;
    this.retryTimer = null;
  }
}
