/**
 * A workspace session on one operator device: the start rules, live commands, run-sheet
 * editing and live lyric edits, tied to the local database.
 *
 * The session holds no interface code. It is what the desktop app's screens call, and the
 * point at which later phases attach other devices.
 */
import { dateInTimeZone, nextMeetingDate, nextMeetingDateAfter } from '@worship-q/calendar';
import {
  applyCommand,
  createLiveState,
  DEFAULT_EXPIRY_MS,
  isKeptTooLong,
  isPresentingPreviousContent,
  relocatePresented,
  resolveStart,
  touch,
  type CommandInput,
  type PlayablePiece,
} from '@worship-q/live-state';
import { buildPieces, type Piece } from '@worship-q/lyrics';
import type {
  BackgroundAsset,
  Command,
  IsoDate,
  LiveState,
  OutputFrame,
  OutputProfile,
  PresentationSettings,
  RunSheet,
  RunSheetItem,
  Song,
  SongFields,
  Workspace,
} from '@worship-q/protocol';
import type { CopyMode, OutputProfilePatch, Store } from '@worship-q/store';

export interface SessionClock {
  now(): Date;
}

export interface SessionOptions {
  /** How long a live state survives with the app closed. */
  expiryMs?: number;
}

/** How the session began, following the start rules. */
export type StartKind =
  /** An unexpired live state was resumed. */
  | 'resumed'
  /** A new live state began from today's run sheet, with nothing presented. */
  | 'started'
  /** An unexpired, ended live state was found; the next meeting date is open for editing. */
  | 'ended'
  /** Nothing is live; the next meeting date is open for editing. */
  | 'idle';

export interface RunSheetEntry {
  item: RunSheetItem;
  /** The song, also when it has since been removed from the library. */
  song: Song;
  pieces: Piece[];
}

export interface RunSheetView {
  date: IsoDate;
  /** Null when nothing was ever planned for the date. */
  runSheet: RunSheet | null;
  entries: RunSheetEntry[];
}

export type CopyResult =
  | { status: 'copied'; count: number }
  /** The target already has items: the operator must pick Append or Replace. */
  | { status: 'choose' }
  | { status: 'nothing-to-copy' };

export class ReadOnlyDateError extends Error {
  constructor(readonly date: IsoDate) {
    super(`The run sheet for ${date} is not open for editing.`);
  }
}

export class Session {
  private live_: LiveState | null = null;
  private liveDate_: IsoDate | null = null;
  private openDate_: IsoDate;
  private version_ = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly expiryMs: number;

  private constructor(
    readonly store: Store,
    private readonly clock: SessionClock,
    private workspace_: Workspace,
    options: SessionOptions,
  ) {
    this.expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;
    this.openDate_ = this.today();
  }

  /**
   * Opens the local workspace, creating it on first run, and applies the start rules.
   * `timezone` is used only when the workspace is created.
   */
  static async open(
    store: Store,
    clock: SessionClock,
    timezone: string,
    options: SessionOptions = {},
  ): Promise<{ session: Session; start: StartKind }> {
    const workspace = await store.ensureWorkspace(timezone);
    const session = new Session(store, clock, workspace, options);
    const start = await session.start();
    return { session, start };
  }

  // ── State ────────────────────────────────────────────────────────────────

  get workspace(): Workspace {
    return this.workspace_;
  }

  /** The shared live state, or null when there is none. */
  get live(): LiveState | null {
    return this.live_;
  }

  get isLive(): boolean {
    return this.live_?.status === 'live';
  }

  /** Date of the live run sheet while live. */
  get liveDate(): IsoDate | null {
    return this.isLive ? this.liveDate_ : null;
  }

  /** The date whose run sheet is open for editing on this device, and the target of copies. */
  get openDate(): IsoDate {
    return this.openDate_;
  }

  /** Increases whenever anything the interface shows may have changed. */
  get version(): number {
    return this.version_;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Today in the workspace timezone. */
  today(): IsoDate {
    return dateInTimeZone(this.clock.now(), this.workspace_.timezone);
  }

  /** A date can be edited when it is the open date or the live date; others are read-only. */
  canEdit(date: IsoDate): boolean {
    return date === this.openDate_ || date === this.liveDate;
  }

  get presentingPreviousContent(): boolean {
    return this.live_ !== null && this.isLive && isPresentingPreviousContent(this.live_);
  }

  /** True once the live run sheet's date has passed; the operator is offered to end it. */
  get keptTooLong(): boolean {
    return (
      this.live_ !== null &&
      this.liveDate_ !== null &&
      isKeptTooLong(this.live_, this.liveDate_, this.today())
    );
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  private changed(): void {
    this.version_++;
    for (const listener of [...this.listeners]) listener();
  }

  /** Runs operations one at a time, in the order they were requested. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      try {
        return await operation();
      } finally {
        this.changed();
      }
    });
  }

  private async setLive(state: LiveState | null): Promise<void> {
    if (state === this.live_) return;
    this.live_ = state;
    if (state) {
      await this.store.saveLiveState(this.workspace_.id, state);
      this.liveDate_ = (await this.store.getRunSheet(state.runSheetId))?.date ?? null;
    } else {
      await this.store.clearLiveState(this.workspace_.id);
      this.liveDate_ = null;
    }
  }

  // ── Start, heartbeat ─────────────────────────────────────────────────────

  private async start(): Promise<StartKind> {
    const today = this.today();
    const days = this.workspace_.meetingDays;
    let saved = await this.store.loadLiveState(this.workspace_.id);
    if (saved && !(await this.store.getRunSheet(saved.runSheetId))) saved = null;
    const planned = await this.store.getPlannedRunSheet(this.workspace_.id, today);
    const decision = resolveStart({
      saved,
      now: this.nowIso(),
      todayRunSheetId: planned?.id ?? null,
      expiryMs: this.expiryMs,
    });

    switch (decision.kind) {
      case 'resume':
        await this.setLive(decision.state);
        this.openDate_ = this.liveDate_!;
        return 'resumed';
      case 'ended':
        await this.setLive(decision.state);
        this.openDate_ = nextMeetingDateAfter(this.liveDate_!, today, days);
        return 'ended';
      case 'start':
        await this.setLive(decision.state);
        this.openDate_ = today;
        return 'started';
      case 'none':
        await this.store.clearLiveState(this.workspace_.id);
        this.openDate_ = nextMeetingDate(today, days);
        return 'idle';
    }
  }

  /** Records that this operator device is still connected, which holds off expiry. */
  heartbeat(): Promise<void> {
    return this.enqueue(async () => {
      if (this.live_) await this.setLive(touch(this.live_, this.nowIso()));
    });
  }

  // ── Reading run sheets ───────────────────────────────────────────────────

  private async entries(runSheetId: string, linesPerPiece: number): Promise<RunSheetEntry[]> {
    const items = await this.store.listItems(runSheetId);
    const entries: RunSheetEntry[] = [];
    const songs = new Map<string, Song | null>();
    for (const item of items) {
      if (!songs.has(item.songId)) songs.set(item.songId, await this.store.getSong(item.songId));
      const song = songs.get(item.songId);
      if (!song) continue;
      entries.push({ item, song, pieces: buildPieces(song.lyrics, song.lineIds, linesPerPiece) });
    }
    return entries;
  }

  /** The plan for a date, with each song's pieces. */
  async viewDate(date: IsoDate): Promise<RunSheetView> {
    const runSheet = await this.store.getRunSheetByDate(this.workspace_.id, date);
    if (!runSheet) return { date, runSheet: null, entries: [] };
    const { linesPerPiece } = await this.store.getPresentationSettings(this.workspace_.id);
    return { date, runSheet, entries: await this.entries(runSheet.id, linesPerPiece) };
  }

  /** The live run sheet, or null when nothing is live. */
  async viewLive(): Promise<RunSheetView | null> {
    const date = this.liveDate;
    return date ? this.viewDate(date) : null;
  }

  private async sequence(): Promise<PlayablePiece[]> {
    if (!this.live_) return [];
    const { linesPerPiece } = await this.store.getPresentationSettings(this.workspace_.id);
    const entries = await this.entries(this.live_.runSheetId, linesPerPiece);
    return entries.flatMap((entry) =>
      entry.pieces.map((piece) => ({
        itemId: entry.item.id,
        songId: entry.song.id,
        pieceId: piece.id,
      })),
    );
  }

  // ── Live commands ────────────────────────────────────────────────────────

  private async apply(command: CommandInput): Promise<boolean> {
    if (!this.live_) return false;
    const outcome = applyCommand(this.live_, { ...command, id: this.store.newId() } as Command, {
      now: this.nowIso(),
      sequence: await this.sequence(),
    });
    if (outcome.result !== 'applied') return false;
    await this.setLive(outcome.state);
    return true;
  }

  /** Presents any piece of the live run sheet. */
  play(itemId: string, pieceId: string): Promise<boolean> {
    return this.mutate(() => this.apply({ type: 'playPiece', itemId, pieceId }));
  }

  next(): Promise<boolean> {
    return this.mutate(() => this.apply({ type: 'next' }));
  }

  previous(): Promise<boolean> {
    return this.mutate(() => this.apply({ type: 'previous' }));
  }

  setBlank(blank: boolean): Promise<boolean> {
    return this.mutate(() => this.apply({ type: blank ? 'blank' : 'unblank' }));
  }

  /**
   * Makes a date's run sheet the live one and opens it on this device. What is on screen
   * stays until another piece is played.
   */
  goLive(date: IsoDate): Promise<void> {
    return this.mutate(async () => {
      const sheet = await this.store.ensureRunSheet(this.workspace_.id, date);
      if (this.live_) await this.apply({ type: 'goLive', runSheetId: sheet.id });
      else await this.setLive(createLiveState(sheet.id, this.nowIso()));
      this.openDate_ = date;
    });
  }

  /**
   * Ends the presentation: the output is cleared and the next meeting date after the ended
   * one opens for editing. Returns that date.
   */
  endPresentation(): Promise<IsoDate> {
    return this.mutate(async () => {
      const endedDate = this.liveDate_;
      if (this.isLive && (await this.apply({ type: 'end' })) && endedDate) {
        this.openDate_ = nextMeetingDateAfter(endedDate, this.today(), this.workspace_.meetingDays);
      }
      return this.openDate_;
    });
  }

  // ── Calendar and run-sheet editing ───────────────────────────────────────

  /** Opens a date's run sheet for editing on this device. Nothing live changes. */
  editRunSheet(date: IsoDate): Promise<void> {
    return this.mutate(async () => {
      this.openDate_ = date;
    });
  }

  private async editable(date: IsoDate): Promise<RunSheet> {
    if (!this.canEdit(date)) throw new ReadOnlyDateError(date);
    return this.store.ensureRunSheet(this.workspace_.id, date);
  }

  private async editableItem(itemId: string): Promise<void> {
    const editable = [this.openDate_, this.liveDate].filter((date): date is IsoDate => !!date);
    for (const date of editable) {
      const sheet = await this.store.getRunSheetByDate(this.workspace_.id, date);
      if (sheet && (await this.store.listItems(sheet.id)).some((item) => item.id === itemId))
        return;
    }
    throw new ReadOnlyDateError(this.openDate_);
  }

  /** Adds a song to the end of a date's run sheet. Edits never change what is on screen. */
  addSong(date: IsoDate, songId: string): Promise<RunSheetItem> {
    return this.mutate(async () => {
      const sheet = await this.editable(date);
      return this.store.addItem(sheet.id, songId);
    });
  }

  moveItem(itemId: string, toIndex: number): Promise<void> {
    return this.mutate(async () => {
      await this.editableItem(itemId);
      await this.store.moveItem(itemId, toIndex);
    });
  }

  removeItem(itemId: string): Promise<void> {
    return this.mutate(async () => {
      await this.editableItem(itemId);
      await this.store.removeItem(itemId);
    });
  }

  /**
   * Copies the items of `sourceDate` into the open run sheet. Into an empty run sheet the
   * copy is immediate; into one with items a mode must be given, otherwise the result asks
   * for a choice.
   */
  copyFrom(sourceDate: IsoDate, mode?: CopyMode): Promise<CopyResult> {
    return this.mutate(async (): Promise<CopyResult> => {
      const source = await this.store.getRunSheetByDate(this.workspace_.id, sourceDate);
      if (!source || sourceDate === this.openDate_) return { status: 'nothing-to-copy' };
      if ((await this.store.listItems(source.id)).length === 0)
        return { status: 'nothing-to-copy' };
      const target = await this.store.ensureRunSheet(this.workspace_.id, this.openDate_);
      const occupied = (await this.store.listItems(target.id)).length > 0;
      if (occupied && !mode) return { status: 'choose' };
      const copies = await this.store.copyItems(source.id, target.id, mode ?? 'append');
      return { status: 'copied', count: copies.length };
    });
  }

  setMeetingDays(days: readonly number[]): Promise<void> {
    return this.mutate(async () => {
      this.workspace_ = await this.store.setMeetingDays(this.workspace_.id, days);
    });
  }

  // ── Songs ────────────────────────────────────────────────────────────────

  createSong(fields: Partial<SongFields>): Promise<Song> {
    return this.mutate(() => this.store.createSong(this.workspace_.id, fields));
  }

  /**
   * Saves an edit to a song. If the song is on screen, the output shows the edit and the
   * presented position follows the edited lyrics.
   */
  saveSong(id: string, fields: Partial<SongFields>): Promise<Song> {
    return this.mutate(async () => {
      const before = await this.store.getSong(id);
      const after = await this.store.updateSong(id, fields);
      if (before && this.live_?.presented?.songId === id) {
        const { linesPerPiece } = await this.store.getPresentationSettings(this.workspace_.id);
        await this.setLive(
          relocatePresented(
            this.live_,
            id,
            buildPieces(before.lyrics, before.lineIds, linesPerPiece),
            buildPieces(after.lyrics, after.lineIds, linesPerPiece),
            this.nowIso(),
          ),
        );
      }
      return after;
    });
  }

  /** Removes a song from the library. Run sheets keep their items; see `Store.removeSong`. */
  removeSong(id: string): Promise<void> {
    return this.mutate(() => this.store.removeSong(id));
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  /**
   * Changes presentation settings. When the number of lines per piece changes while a song
   * is on screen, the presentation moves to the piece holding the first line that was shown.
   */
  updatePresentationSettings(patch: Partial<PresentationSettings>): Promise<PresentationSettings> {
    return this.mutate(async () => {
      const before = await this.store.getPresentationSettings(this.workspace_.id);
      const after = await this.store.updatePresentationSettings(this.workspace_.id, patch);
      const presented = this.live_?.presented;
      if (this.live_ && presented && before.linesPerPiece !== after.linesPerPiece) {
        const song = await this.store.getSong(presented.songId);
        if (song) {
          await this.setLive(
            relocatePresented(
              this.live_,
              song.id,
              buildPieces(song.lyrics, song.lineIds, before.linesPerPiece),
              buildPieces(song.lyrics, song.lineIds, after.linesPerPiece),
              this.nowIso(),
            ),
          );
        }
      }
      return after;
    });
  }

  updateOutputProfile(patch: OutputProfilePatch): Promise<OutputProfile> {
    return this.mutate(() => this.store.updateOutputProfile(this.workspace_.id, patch));
  }

  addBackground(asset: Parameters<Store['addBackground']>[1]): Promise<BackgroundAsset> {
    return this.mutate(() => this.store.addBackground(this.workspace_.id, asset));
  }

  removeBackground(id: string): Promise<void> {
    return this.mutate(() => this.store.removeBackground(id));
  }

  // ── Output ───────────────────────────────────────────────────────────────

  /**
   * What the output should show right now. Lyrics and settings are read fresh, so a saved
   * edit or a changed setting reaches the screen without replaying the piece.
   */
  async frame(mediaUrl: (asset: BackgroundAsset) => string): Promise<OutputFrame> {
    const workspaceId = this.workspace_.id;
    const settings = await this.store.getPresentationSettings(workspaceId);
    const profile = await this.store.getOutputProfile(workspaceId);
    const asset = profile.backgroundAssetId
      ? (await this.store.listBackgrounds(workspaceId)).find(
          (b) => b.id === profile.backgroundAssetId,
        )
      : undefined;

    const frame: OutputFrame = {
      blank: this.isLive && this.live_!.blank,
      fontFamily: profile.fontFamily,
      scale: profile.scale,
      wrap: settings.wrapLongLines,
      background: {
        color: profile.backgroundColor,
        media: asset ? { kind: asset.kind, url: mediaUrl(asset) } : null,
      },
      song: null,
      pieceId: null,
    };

    const presented = this.isLive ? this.live_!.presented : null;
    const song = presented ? await this.store.getSong(presented.songId) : null;
    if (presented && song) {
      const pieces = buildPieces(song.lyrics, song.lineIds, settings.linesPerPiece);
      frame.song = {
        id: song.id,
        pieces: pieces.map((piece) => ({ id: piece.id, lines: piece.lines.map((l) => l.text) })),
      };
      frame.pieceId = pieces.some((piece) => piece.id === presented.pieceId)
        ? presented.pieceId
        : null;
    }
    return frame;
  }
}

export type { CopyMode };
