/**
 * A workspace session on one operator device: the start rules, live commands, run-sheet
 * editing and live lyric edits, tied to the local database.
 *
 * The session holds no interface code. It is what the desktop app's screens call, and the
 * point at which later phases attach other devices.
 */
import { dateInTimeZone, nextMeetingDate } from '@worship-q/calendar';
import {
  applyCommand,
  createLiveState,
  DEFAULT_EXPIRY_MS,
  isExpired,
  isKeptTooLong,
  isPresentingPreviousContent,
  relocatePresented,
  resolveStart,
  touch,
  type CommandInput,
  type CommandResult,
  type PlayablePiece,
  type SnapshotBody,
} from '@worship-q/live-state';
import { buildPieces, type Piece } from '@worship-q/lyrics';
import type {
  BackgroundAsset,
  Command,
  CommandOrigin,
  ConnectedDevice,
  DeviceRole,
  IsoDate,
  LiveSnapshot,
  LiveState,
  OperatorCommand,
  OutputFrame,
  OutputKind,
  OutputProfile,
  PresentationSettings,
  RemoteEditCommand,
  RemoteNavigationCommand,
  RunSheet,
  RunSheetItem,
  SnapshotItem,
  SnapshotPiece,
  SnapshotPresented,
  Song,
  SongFields,
  Workspace,
} from '@worship-q/protocol';
import type { AppliedChanges, CopyMode, OutputProfilePatch, Store } from '@worship-q/store';

export interface SessionClock {
  now(): Date;
}

export interface SessionOptions {
  /** How long a live state survives with the app closed. */
  expiryMs?: number;
  /**
   * A viewer (spec §7, decision D16) never starts, keeps alive or coordinates a live state:
   * it only shows the one it is sent. Defaults to an operator device.
   */
  role?: DeviceRole;
}

/**
 * Where a follower's live commands go: to the coordinator, which applies them and sends a
 * snapshot back (plan M1). The session never edits the live state itself while following.
 */
export interface LiveRelay {
  send(command: OperatorCommand): void;
}

/** What applying another device's command came to, with the run-sheet change for notices. */
export interface OperatorCommandOutcome {
  result: CommandResult;
  change?: RunSheetChange;
}

/** How the session began, following the start rules. */
export type StartKind =
  /** An unexpired live state was resumed. */
  | 'resumed'
  /**
   * A new live state began with nothing presented: from today's run sheet, else from the
   * current or next meeting day.
   */
  | 'started';

/** Identifier of a website's one piece, which shows its address as its text. */
export const WEBSITE_PIECE_ID = 'website';

/**
 * A song's pieces: its lyrics in groups of lines, one per image of an imported deck, or a
 * single one for a website. A deck's pieces count each slide as a block, so the clicks of one
 * slide read as a group.
 */
export function songPieces(
  song: Pick<Song, 'lyrics' | 'lineIds' | 'deck' | 'website'>,
  linesPerPiece: number,
): Piece[] {
  if (song.website) {
    const { url } = song.website;
    return [
      {
        id: WEBSITE_PIECE_ID,
        blockIndex: 0,
        indexInBlock: 0,
        lines: [{ id: `${WEBSITE_PIECE_ID}:0`, text: url }],
      },
    ];
  }
  if (!song.deck) return buildPieces(song.lyrics, song.lineIds, linesPerPiece);
  let blockIndex = -1;
  let lastSlide: number | null = null;
  let indexInBlock = 0;
  return song.deck.pages.map((page) => {
    if (page.slide !== lastSlide) {
      blockIndex++;
      indexInBlock = 0;
      lastSlide = page.slide;
    }
    return {
      id: page.image,
      blockIndex,
      indexInBlock: indexInBlock++,
      lines: page.text.map((text, i) => ({ id: `${page.image}:${i}`, text })),
      image: page.image,
    };
  });
}

/** How a song is presented: as lyrics, as imported slides or as a web page. */
export function songKind(song: Pick<Song, 'deck' | 'website'>): SnapshotItem['kind'] {
  return song.website ? 'website' : song.deck ? 'deck' : 'lyrics';
}

/** A song's pieces as the snapshot and the phones' view carry them (plan M1.6). */
export function snapshotPieces(song: Song, pieces: readonly Piece[]): SnapshotPiece[] {
  return pieces.map((piece) => ({
    id: piece.id,
    lines:
      piece.lines.length > 0 || !piece.image
        ? piece.lines.map((line) => line.text)
        : // An imported slide without text, such as a photo, is named by its place.
          [
            `Slide ${piece.blockIndex + 1}` +
              (piece.indexInBlock > 0 ? ` · ${piece.indexInBlock + 1}` : ''),
          ],
    block: piece.blockIndex,
    ...(piece.image ? { image: piece.image } : {}),
    ...(piece.image && piece.lines.length === 0 ? { textless: true } : {}),
    ...(song.deck?.pages.find((page) => page.image === piece.image)?.thumbnail
      ? { thumbnail: song.deck.pages.find((page) => page.image === piece.image)!.thumbnail }
      : {}),
  }));
}

/** A run-sheet entry made from a snapshot, for a follower whose content is behind. */
function entryFromSnapshot(
  item: SnapshotItem,
  runSheetId: string,
  position: number,
  now: string,
): RunSheetEntry {
  const lines = item.pieces.flatMap((piece) => piece.lines);
  const song: Song = {
    id: item.songId,
    workspaceId: '',
    title: item.title,
    lyrics: lines.join('\n'),
    author: '',
    copyright: '',
    ccli: null,
    year: null,
    background: null,
    deck:
      item.kind === 'deck'
        ? {
            source: '',
            width: 16,
            height: 9,
            pages: item.pieces.map((piece, index) => ({
              image: piece.image ?? piece.id,
              ...(piece.thumbnail ? { thumbnail: piece.thumbnail } : {}),
              slide: (piece.block ?? index) + 1,
              step: 0,
              text: piece.lines,
            })),
          }
        : null,
    website: item.kind === 'website' ? { url: item.pieces[0]?.lines[0] ?? 'https://' } : null,
    lineIds: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
    removedAt: item.removed ? now : null,
  };
  const counts = new Map<number, number>();
  const pieces: Piece[] = item.pieces.map((piece) => {
    const blockIndex = piece.block ?? 0;
    const indexInBlock = counts.get(blockIndex) ?? 0;
    counts.set(blockIndex, indexInBlock + 1);
    return {
      id: piece.id,
      blockIndex,
      indexInBlock,
      lines: piece.lines.map((text, i) => ({ id: `${piece.id}:${i}`, text })),
      ...(piece.image ? { image: piece.image } : {}),
    };
  });
  return {
    item: {
      id: item.itemId,
      runSheetId,
      songId: item.songId,
      position,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
    song,
    pieces,
  };
}

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

/** A run-sheet edit made by a remote controller, with what is needed to undo it. */
export type RunSheetChange =
  | { kind: 'added'; item: RunSheetItem; title: string }
  | { kind: 'removed'; item: RunSheetItem; title: string }
  | { kind: 'moved'; item: RunSheetItem; title: string; fromIndex: number; toIndex: number };

/** How many remote edit identifiers are remembered, so a repeated one is applied once. */
const REMOTE_EDIT_MEMORY = 100;

export class ReadOnlyDateError extends Error {
  constructor(readonly date: IsoDate) {
    super(`The run sheet for ${date} is not open for editing.`);
  }
}

export class Session {
  private live_: LiveState | null = null;
  private liveDate_: IsoDate | null = null;
  /** A date the operator chose to edit instead of the default one. */
  private chosenDate_: IsoDate | null = null;
  /** The item the operator moved to without presenting it, on this device only. */
  private browsedItemId_: string | null = null;
  /** The day the interface was last told about, to notice the date changing. */
  private day_: IsoDate;
  private version_ = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly expiryMs: number;
  private readonly remoteEditIds: string[] = [];
  readonly role: DeviceRole;
  /** How this session began; null until the start rules have run. */
  private startKind_: StartKind | null = null;
  /** Set while another device coordinates the live state; commands go through it. */
  private relay_: LiveRelay | null = null;
  /** The coordinator's last snapshot while following, for rendering content not here yet. */
  private snapshot_: LiveSnapshot | null = null;

  private constructor(
    readonly store: Store,
    private readonly clock: SessionClock,
    private workspace_: Workspace,
    options: SessionOptions,
  ) {
    this.expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;
    this.role = options.role ?? 'operator';
    this.day_ = this.today();
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
    session.startKind_ = start;
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

  /** Whether an earlier live state was resumed when the app opened, or a new one started. */
  get startKind(): StartKind | null {
    return this.startKind_;
  }

  /** True while another device holds the live state and this one follows it. */
  get following(): boolean {
    return this.relay_ !== null;
  }

  /** A viewer only shows the presentation (decision D16). */
  get isViewer(): boolean {
    return this.role === 'viewer';
  }

  /** The coordinator's last snapshot while following, else null. */
  get snapshot(): LiveSnapshot | null {
    return this.snapshot_;
  }

  /** Date of the live run sheet while live. */
  get liveDate(): IsoDate | null {
    return this.isLive ? this.liveDate_ : null;
  }

  /**
   * The date whose run sheet is open for editing on this device, and the target of copies:
   * the date the operator chose to edit, else the live date, else the current or next
   * meeting day. The last is worked out afresh each time, so it moves on with the calendar.
   */
  get openDate(): IsoDate {
    return (
      this.chosenDate_ ??
      this.liveDate ??
      nextMeetingDate(this.today(), this.workspace_.meetingDays)
    );
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
    return date === this.openDate || date === this.liveDate;
  }

  /**
   * The run sheet item the operator moved to with `browseItem`, until another slide is
   * presented. The slide keys act on it instead of the presented item.
   */
  get browsedItemId(): string | null {
    return this.browsedItemId_;
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
    if (state?.presented !== this.live_?.presented) this.browsedItemId_ = null;
    this.live_ = state;
    if (state) {
      await this.store.saveLiveState(this.workspace_.id, state);
      this.liveDate_ =
        (await this.store.getRunSheet(state.runSheetId))?.date ?? this.snapshot_?.date ?? null;
    } else {
      await this.store.clearLiveState(this.workspace_.id);
      this.liveDate_ = null;
    }
  }

  // ── Start, heartbeat ─────────────────────────────────────────────────────

  private async start(): Promise<StartKind> {
    const today = this.today();
    let saved = await this.store.loadLiveState(this.workspace_.id);
    if (this.isViewer) {
      // A viewer shows what it last followed until that expires, and starts nothing itself.
      if (saved && !isExpired(saved, this.nowIso(), this.expiryMs)) {
        this.live_ = saved;
        this.liveDate_ = (await this.store.getRunSheet(saved.runSheetId))?.date ?? null;
        return 'resumed';
      }
      if (saved) await this.store.clearLiveState(this.workspace_.id);
      return 'started';
    }
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
        return 'resumed';
      case 'start':
        await this.setLive(decision.state);
        return 'started';
      // The app never opens with nothing live, also when the presentation was ended earlier.
      case 'ended':
      case 'none': {
        const date = nextMeetingDate(today, this.workspace_.meetingDays);
        const sheet = await this.store.ensureRunSheet(this.workspace_.id, date);
        await this.setLive(createLiveState(sheet.id, this.nowIso()));
        return 'started';
      }
    }
  }

  /**
   * Records that this operator device is still connected, which holds off expiry, and tells
   * the interface when the date has changed since it last looked.
   */
  heartbeat(): Promise<void> {
    return this.enqueue(async () => {
      if (this.live_ && this.isViewer) {
        // A viewer never keeps a live state alive (spec §7 rule 3); it lets go once expired.
        if (isExpired(this.live_, this.nowIso(), this.expiryMs)) {
          this.live_ = null;
          this.liveDate_ = null;
          this.snapshot_ = null;
          await this.store.clearLiveState(this.workspace_.id);
          this.changed();
        }
      } else if (this.live_) {
        // Every operator device keeps the live state alive, also a follower whose
        // coordinator has gone; the coordinator's snapshots carry its own stamp meanwhile.
        await this.setLive(touch(this.live_, this.nowIso()));
      }
      const today = this.today();
      if (today !== this.day_) {
        this.day_ = today;
        this.changed();
      }
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
      entries.push({ item, song, pieces: songPieces(song, linesPerPiece) });
    }
    return entries;
  }

  /** The plan for a date, with each song's pieces. */
  async viewDate(date: IsoDate): Promise<RunSheetView> {
    const snapshot = this.snapshot_;
    if (snapshot && this.live_ && date === this.liveDate_ && this.isLive) {
      // A coordinator that took the snapshot over keeps its items only until its own copy of
      // the run sheet has arrived by content synchronization.
      if (this.relay_ || !(await this.hasLocalItems(this.live_.runSheetId))) {
        return this.viewSnapshot(snapshot, date);
      }
      this.snapshot_ = null;
    }
    const runSheet = await this.store.getRunSheetByDate(this.workspace_.id, date);
    if (!runSheet) return { date, runSheet: null, entries: [] };
    const { linesPerPiece } = await this.store.getPresentationSettings(this.workspace_.id);
    return { date, runSheet, entries: await this.entries(runSheet.id, linesPerPiece) };
  }

  private async hasLocalItems(runSheetId: string): Promise<boolean> {
    return (await this.store.listItems(runSheetId)).length > 0;
  }

  /**
   * The live run sheet as the coordinator's snapshot has it, which is authoritative for what
   * is live. Songs this device already holds are read from here, so their edits show; the
   * rest are made from the snapshot until content synchronization brings them.
   */
  private async viewSnapshot(snapshot: LiveSnapshot, date: IsoDate): Promise<RunSheetView> {
    const runSheet =
      (await this.store.getRunSheet(snapshot.state.runSheetId)) ??
      (await this.store.getRunSheetByDate(this.workspace_.id, date));
    const { linesPerPiece } = await this.store.getPresentationSettings(this.workspace_.id);
    const now = this.nowIso();
    const entries: RunSheetEntry[] = [];
    for (const [position, item] of snapshot.items.entries()) {
      const entry = entryFromSnapshot(item, snapshot.state.runSheetId, position, now);
      const song = await this.store.getSong(item.songId);
      if (song && song.removedAt === null) {
        entry.song = song;
        const pieces = songPieces(song, linesPerPiece);
        // The local copy is used only while it has the same pieces as the live one.
        if (pieces.map((p) => p.id).join(' ') === entry.pieces.map((p) => p.id).join(' '))
          entry.pieces = pieces;
      }
      entries.push(entry);
    }
    return { date, runSheet, entries };
  }

  /** The live run sheet, or null when nothing is live. */
  async viewLive(): Promise<RunSheetView | null> {
    const date = this.liveDate;
    return date ? this.viewDate(date) : null;
  }

  private async sequence(): Promise<PlayablePiece[]> {
    if (!this.live_) return [];
    const { linesPerPiece } = await this.store.getPresentationSettings(this.workspace_.id);
    const entries =
      this.snapshot_ && this.liveDate_ && this.isLive
        ? (await this.viewDate(this.liveDate_)).entries
        : await this.entries(this.live_.runSheetId, linesPerPiece);
    return entries.flatMap((entry) =>
      entry.pieces.map((piece) => ({
        itemId: entry.item.id,
        songId: entry.song.id,
        pieceId: piece.id,
      })),
    );
  }

  // ── Live commands ────────────────────────────────────────────────────────

  private async apply(command: CommandInput, id = this.store.newId()): Promise<boolean> {
    return (await this.applyWithResult(command, id)) === 'applied';
  }

  private async applyWithResult(command: CommandInput, id: string): Promise<CommandResult> {
    if (this.relay_) {
      // The coordinator applies it and sends the result back as a snapshot.
      if (command.type === 'goLive') return 'rejected';
      this.relay_.send(command as OperatorCommand);
      return 'applied';
    }
    if (!this.live_ || this.isViewer) return 'rejected';
    const outcome = applyCommand(this.live_, { ...command, id } as Command, {
      now: this.nowIso(),
      sequence: await this.sequence(),
    });
    if (outcome.result !== 'applied') return outcome.result;
    await this.setLive(outcome.state);
    return 'applied';
  }

  /** Presents any piece of the live run sheet. */
  play(itemId: string, pieceId: string): Promise<boolean> {
    return this.mutate(() => this.apply({ type: 'playPiece', itemId, pieceId }));
  }

  /**
   * The next slide of the run sheet. After moving to another item it presents that item's
   * first slide instead.
   */
  next(): Promise<boolean> {
    return this.mutate(async () => (await this.playBrowsed(1)) ?? this.apply({ type: 'next' }));
  }

  /**
   * Shows the lyrics again while blank, otherwise the same as `next`. After moving to
   * another item it presents that item's first slide instead.
   */
  unblankOrNext(): Promise<boolean> {
    return this.mutate(
      async () =>
        (await this.playBrowsed(1)) ?? this.apply({ type: this.live_?.blank ? 'unblank' : 'next' }),
    );
  }

  previous(): Promise<boolean> {
    return this.mutate(() => this.apply({ type: 'previous' }));
  }

  /**
   * Steps to another slide of the presented item, never leaving it. After moving to another
   * item it presents that item's first slide, or its last when stepping back.
   */
  stepInItem(by: 1 | -1): Promise<boolean> {
    return this.mutate(
      async () =>
        (await this.playBrowsed(by)) ??
        this.apply({ type: by === 1 ? 'nextInItem' : 'previousInItem' }),
    );
  }

  /**
   * Presents the first or the last slide of the browsed item when it is not the presented
   * one; null when there is no such item, so the caller acts on the presented item.
   */
  private async playBrowsed(by: 1 | -1): Promise<boolean | null> {
    const browsed = this.browsedItemId_;
    const presented = this.live_?.presented;
    if (!this.live_ || !browsed) return null;
    if (presented?.runSheetId === this.live_.runSheetId && presented.itemId === browsed) {
      return null;
    }
    const pieces = (await this.sequence()).filter((entry) => entry.itemId === browsed);
    const piece = by === 1 ? pieces[0] : pieces[pieces.length - 1];
    if (!piece) return null;
    return this.apply({ type: 'playPiece', itemId: piece.itemId, pieceId: piece.pieceId });
  }

  /**
   * The item the slide keys act on: the browsed one, else the presented one, else the first
   * item when nothing is presented from this run sheet.
   */
  private keyedItemId(sequence: readonly PlayablePiece[]): string | undefined {
    const browsed = this.browsedItemId_;
    if (browsed && sequence.some((entry) => entry.itemId === browsed)) return browsed;
    const presented = this.live_?.presented;
    return presented && presented.runSheetId === this.live_?.runSheetId
      ? presented.itemId
      : sequence[0]?.itemId;
  }

  /**
   * Presents a slide of the keyed item by its position, counted from zero. False when there
   * is no such slide.
   */
  playSlide(slide: number): Promise<boolean> {
    return this.mutate(async () => {
      if (!this.live_) return false;
      const sequence = await this.sequence();
      const itemId = this.keyedItemId(sequence);
      const piece = sequence.filter((entry) => entry.itemId === itemId)[slide];
      if (!piece) return false;
      return this.apply({ type: 'playPiece', itemId: piece.itemId, pieceId: piece.pieceId });
    });
  }

  /**
   * Moves the slide keys to the next or the previous run sheet item with slides, leaving the
   * screen as it is. False at either end of the run sheet.
   */
  browseItem(by: 1 | -1): Promise<boolean> {
    return this.mutate(async () => {
      if (!this.live_) return false;
      const sequence = await this.sequence();
      const items = [...new Set(sequence.map((entry) => entry.itemId))];
      const current = items.indexOf(this.keyedItemId(sequence) ?? '');
      const target = items[current < 0 ? (by === 1 ? 0 : -1) : current + by];
      if (!target) return false;
      this.browsedItemId_ = target;
      return true;
    });
  }

  /** Moves the slide keys to a run sheet item, leaving the screen as it is. */
  browseTo(itemId: string): Promise<boolean> {
    return this.mutate(async () => {
      if (!this.live_) return false;
      if (!(await this.sequence()).some((entry) => entry.itemId === itemId)) return false;
      this.browsedItemId_ = itemId;
      return true;
    });
  }

  /**
   * A navigation command from a remote controller. Its identifier comes with it, so a
   * command sent again after a reconnection is applied once. Edits go to `remoteEdit`.
   */
  remoteCommand(id: string, command: RemoteNavigationCommand): Promise<boolean> {
    return this.mutate(() => this.apply(command, id));
  }

  /**
   * A run-sheet edit from a remote controller, made to the live run sheet only. Null when it
   * cannot be applied, or when the same identifier was applied before. Like the operator's
   * edits, it never changes what is on screen.
   */
  remoteEdit(id: string, command: RemoteEditCommand): Promise<RunSheetChange | null> {
    return this.mutate(async () => {
      if (!this.isLive || !this.live_ || this.remoteEditIds.includes(id)) return null;
      const runSheetId = this.live_.runSheetId;
      const items = await this.store.listItems(runSheetId);
      const index = (itemId: string) => items.findIndex((item) => item.id === itemId);
      const titleOf = async (songId: string) => (await this.store.getSong(songId))?.title ?? '';
      let change: RunSheetChange;

      if (command.type === 'addItem') {
        const song = await this.store.getSong(command.songId);
        if (!song || song.workspaceId !== this.workspace_.id || song.removedAt) return null;
        const after = command.afterItemId;
        const at =
          after === undefined || (after !== null && index(after) < 0)
            ? items.length
            : after === null
              ? 0
              : index(after) + 1;
        const item = await this.store.addItem(runSheetId, song.id, at);
        change = { kind: 'added', item, title: song.title };
      } else if (command.type === 'removeItem') {
        const item = items[index(command.itemId)];
        if (!item) return null;
        await this.store.removeItem(item.id);
        change = { kind: 'removed', item, title: await titleOf(item.songId) };
      } else {
        const from = index(command.itemId);
        const item = items[from];
        if (!item || command.afterItemId === item.id) return null;
        // Positions counted without the moved item, as the store's move counts them.
        const others = items.filter((other) => other.id !== item.id);
        const after = command.afterItemId;
        const afterIndex = after === null ? -1 : others.findIndex((other) => other.id === after);
        if (after !== null && afterIndex < 0) return null;
        if (afterIndex + 1 === from) return null;
        const to = afterIndex + 1;
        await this.store.moveItem(item.id, to);
        change = {
          kind: 'moved',
          item,
          title: await titleOf(item.songId),
          fromIndex: from,
          toIndex: to,
        };
      }

      this.remoteEditIds.push(id);
      if (this.remoteEditIds.length > REMOTE_EDIT_MEMORY) this.remoteEditIds.shift();
      return change;
    });
  }

  /** Undoes a remote controller's edit, while its run sheet is still the live one. */
  undoRemoteEdit(change: RunSheetChange): Promise<boolean> {
    return this.mutate(async () => {
      const { item } = change;
      if (!this.isLive || this.live_?.runSheetId !== item.runSheetId) return false;
      const items = await this.store.listItems(item.runSheetId);
      const present = items.some((other) => other.id === item.id);
      switch (change.kind) {
        case 'added':
          if (!present) return false;
          await this.store.removeItem(item.id);
          return true;
        case 'removed':
          return this.store.restoreItem(item);
        case 'moved':
          if (!present) return false;
          await this.store.moveItem(item.id, change.fromIndex);
          return true;
      }
    });
  }

  setBlank(blank: boolean): Promise<boolean> {
    return this.mutate(() => this.apply({ type: blank ? 'blank' : 'unblank' }));
  }

  /** Takes whatever is presented off the screen, staying live with the same run sheet. */
  clear(): Promise<boolean> {
    return this.mutate(() => this.apply({ type: 'clear' }));
  }

  /**
   * Makes a date's run sheet the live one and opens it on this device. What is on screen
   * stays until another piece is played.
   */
  goLive(date: IsoDate): Promise<void> {
    return this.mutate(async () => {
      if (this.relay_) {
        // The coordinator finds or makes the run sheet for the date on its side.
        this.relay_.send({ type: 'goLive', date });
        this.chosenDate_ = null;
        return;
      }
      await this.makeLive(await this.store.ensureRunSheet(this.workspace_.id, date));
    });
  }

  private async makeLive(sheet: RunSheet): Promise<void> {
    if (this.relay_) this.relay_.send({ type: 'goLive', date: sheet.date });
    else if (this.isViewer) return;
    else if (this.live_) await this.apply({ type: 'goLive', runSheetId: sheet.id });
    else await this.setLive(createLiveState(sheet.id, this.nowIso()));
    this.chosenDate_ = null;
  }

  /** With nothing live, the run sheet being edited becomes the live one. */
  private async liveWhenEdited(sheet: RunSheet): Promise<void> {
    if (!this.isLive) await this.makeLive(sheet);
  }

  /**
   * Ends the presentation: the output is cleared and the current or next meeting day opens
   * for editing. Returns that date.
   */
  endPresentation(): Promise<IsoDate> {
    return this.mutate(async () => {
      if (this.isLive && (await this.apply({ type: 'end' }))) this.chosenDate_ = null;
      return this.openDate;
    });
  }

  // ── Calendar and run-sheet editing ───────────────────────────────────────

  /**
   * Opens a date's run sheet for editing on this device. Nothing live changes, unless
   * nothing is live: then the date goes live.
   */
  editRunSheet(date: IsoDate): Promise<void> {
    return this.mutate(async () => {
      if (this.isLive) this.chosenDate_ = date;
      else await this.makeLive(await this.store.ensureRunSheet(this.workspace_.id, date));
    });
  }

  private async editable(date: IsoDate): Promise<RunSheet> {
    if (!this.canEdit(date)) throw new ReadOnlyDateError(date);
    return this.store.ensureRunSheet(this.workspace_.id, date);
  }

  private async editableItem(itemId: string): Promise<RunSheet> {
    const editable = [this.openDate, this.liveDate].filter((date): date is IsoDate => !!date);
    for (const date of editable) {
      const sheet = await this.store.getRunSheetByDate(this.workspace_.id, date);
      if (sheet && (await this.store.listItems(sheet.id)).some((item) => item.id === itemId))
        return sheet;
    }
    throw new ReadOnlyDateError(this.openDate);
  }

  /**
   * Adds a song to the end of a date's run sheet. Edits never change what is on screen; with
   * nothing live, an edit makes its run sheet the live one.
   */
  addSong(date: IsoDate, songId: string): Promise<RunSheetItem> {
    return this.mutate(async () => {
      const sheet = await this.editable(date);
      if (this.relay_ && date === this.liveDate) {
        // A live run-sheet edit from a follower goes to the coordinator (decision D24).
        this.relay_.send({ type: 'addItem', songId });
        const now = this.nowIso();
        return {
          id: this.store.newId(),
          runSheetId: sheet.id,
          songId,
          position: this.snapshot_?.items.length ?? 0,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
      }
      await this.liveWhenEdited(sheet);
      return this.store.addItem(sheet.id, songId);
    });
  }

  moveItem(itemId: string, toIndex: number): Promise<void> {
    return this.mutate(async () => {
      const liveItems = this.liveSnapshotItems(itemId);
      if (this.relay_ && liveItems) {
        const others = liveItems.filter((item) => item.itemId !== itemId);
        const after = toIndex <= 0 ? null : (others[toIndex - 1]?.itemId ?? null);
        this.relay_.send({ type: 'moveItem', itemId, afterItemId: after });
        return;
      }
      await this.liveWhenEdited(await this.editableItem(itemId));
      await this.store.moveItem(itemId, toIndex);
    });
  }

  removeItem(itemId: string): Promise<void> {
    return this.mutate(async () => {
      if (this.relay_ && this.liveSnapshotItems(itemId)) {
        this.relay_.send({ type: 'removeItem', itemId });
        return;
      }
      await this.liveWhenEdited(await this.editableItem(itemId));
      await this.store.removeItem(itemId);
    });
  }

  /** The live run sheet's items when `itemId` is one of them and this device follows. */
  private liveSnapshotItems(itemId: string): SnapshotItem[] | null {
    const items = this.snapshot_?.items ?? null;
    return items?.some((item) => item.itemId === itemId) ? items : null;
  }

  /**
   * Copies the items of `sourceDate` into the open run sheet. Into an empty run sheet the
   * copy is immediate; into one with items a mode must be given, otherwise the result asks
   * for a choice.
   */
  copyFrom(sourceDate: IsoDate, mode?: CopyMode): Promise<CopyResult> {
    return this.mutate(async (): Promise<CopyResult> => {
      const source = await this.store.getRunSheetByDate(this.workspace_.id, sourceDate);
      if (!source || sourceDate === this.openDate) return { status: 'nothing-to-copy' };
      if ((await this.store.listItems(source.id)).length === 0)
        return { status: 'nothing-to-copy' };
      const target = await this.store.ensureRunSheet(this.workspace_.id, this.openDate);
      if (this.relay_ && this.openDate === this.liveDate) {
        // Into the live run sheet from a follower: as single edits through the coordinator.
        const items = this.snapshot_?.items ?? [];
        if (items.length > 0 && !mode) return { status: 'choose' };
        if (mode === 'replace') {
          for (const item of items) this.relay_.send({ type: 'removeItem', itemId: item.itemId });
        }
        const copied = await this.store.listItems(source.id);
        for (const item of copied) this.relay_.send({ type: 'addItem', songId: item.songId });
        return { status: 'copied', count: copied.length };
      }
      const occupied = (await this.store.listItems(target.id)).length > 0;
      if (occupied && !mode) return { status: 'choose' };
      await this.liveWhenEdited(target);
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
            songPieces(before, linesPerPiece),
            songPieces(after, linesPerPiece),
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
  /** A null value goes back to the church default. */
  updatePresentationSettings(patch: {
    [K in keyof PresentationSettings]?: PresentationSettings[K] | null;
  }): Promise<PresentationSettings> {
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
              songPieces(song, before.linesPerPiece),
              songPieces(song, after.linesPerPiece),
              this.nowIso(),
            ),
          );
        }
      }
      return after;
    });
  }

  updateOutputProfile(
    patch: OutputProfilePatch,
    kind: OutputKind = 'slideshow',
  ): Promise<OutputProfile> {
    return this.mutate(() => this.store.updateOutputProfile(this.workspace_.id, patch, kind));
  }

  /** The font an output uses: its own choice, else the church default, else the system's. */
  async fontFamily(kind: OutputKind): Promise<string | null> {
    const profile = await this.store.getOutputProfile(this.workspace_.id, kind);
    if (profile.fontFamily) return profile.fontFamily;
    const church = await this.store.getChurchSettings();
    return (kind === 'slideshow' ? church.slideshowFontFamily : church.subtitleFontFamily) ?? null;
  }

  // ── Shared live state (plan M1, M2) ──────────────────────────────────────

  /**
   * Follows another device's live state: commands go to it through `relay`, and snapshots
   * come back through `applySnapshot`. Null makes this device hold the live state itself
   * again; what it last followed stays as its starting point.
   */
  follow(relay: LiveRelay | null): void {
    if (relay === this.relay_) return;
    this.relay_ = relay;
    if (!relay) this.snapshot_ = null;
    this.changed();
  }

  /** Takes the coordinator's snapshot as the live state. */
  applySnapshot(snapshot: LiveSnapshot): Promise<void> {
    return this.mutate(async () => {
      const before = this.live_;
      this.snapshot_ = snapshot;
      if (before?.presented !== snapshot.state.presented) {
        const same =
          before?.presented &&
          before.presented.itemId === snapshot.state.presented?.itemId &&
          before.presented.pieceId === snapshot.state.presented.pieceId;
        if (!same) this.browsedItemId_ = null;
      }
      this.live_ = snapshot.state;
      this.liveDate_ = snapshot.date;
      // The synchronized copy, from which this device can carry on (decision D18).
      await this.store.saveLiveState(this.workspace_.id, snapshot.state);
    });
  }

  /**
   * Takes a snapshot as this device's own live state, to carry on from it as coordinator
   * (decisions D14, D18): after a handover, a recovery, or the start rules across devices.
   * The run sheet is matched by date when the snapshot's identifier is not known here yet.
   */
  adoptSnapshot(snapshot: LiveSnapshot): Promise<void> {
    return this.mutate(async () => {
      let state = snapshot.state;
      if (!(await this.store.getRunSheet(state.runSheetId))) {
        const local = await this.store.ensureRunSheet(this.workspace_.id, snapshot.date);
        const presented =
          state.presented && state.presented.runSheetId === state.runSheetId
            ? { ...state.presented, runSheetId: local.id }
            : state.presented;
        state = { ...state, runSheetId: local.id, presented };
      }
      // Its items and presented content stand in until this device's own copy arrives.
      this.snapshot_ = { ...snapshot, state };
      this.relay_ = null;
      this.browsedItemId_ = null;
      this.live_ = state;
      this.liveDate_ = snapshot.date;
      await this.store.saveLiveState(this.workspace_.id, state);
    });
  }

  /** The live run sheet's items as the snapshot and the phones' view carry them. */
  async snapshotItems(): Promise<SnapshotItem[]> {
    const view = await this.viewLive();
    return (view?.entries ?? []).map((entry) => ({
      itemId: entry.item.id,
      songId: entry.song.id,
      title: entry.song.title,
      removed: entry.song.removedAt !== null,
      kind: songKind(entry.song),
      pieces: snapshotPieces(entry.song, entry.pieces),
    }));
  }

  /** What is on screen, carried for followers whose content is behind. */
  private async snapshotPresented(): Promise<SnapshotPresented | null> {
    const presented = this.isLive ? this.live_?.presented : null;
    if (!presented) return null;
    const song = await this.store.getSong(presented.songId);
    if (!song) {
      // Following, with a song this device does not have yet: pass on what the coordinator sent.
      const kept = this.snapshot_?.presented;
      return kept && kept.itemId === presented.itemId && kept.pieceId === presented.pieceId
        ? kept
        : null;
    }
    const { linesPerPiece } = await this.store.getPresentationSettings(this.workspace_.id);
    const pieces = songPieces(song, linesPerPiece);
    return {
      itemId: presented.itemId,
      pieceId: presented.pieceId,
      songId: song.id,
      title: song.title,
      kind: songKind(song),
      pieces: snapshotPieces(song, pieces),
      background: song.background,
      websiteUrl: song.website?.url ?? null,
      previous: this.presentingPreviousContent,
    };
  }

  /**
   * The live state for followers, without a revision (plan M1.6). Null when nothing is live
   * here, which only a viewer or a follower can have.
   */
  async buildSnapshot(
    coordinatorId: string,
    devices: ConnectedDevice[] = [],
  ): Promise<SnapshotBody | null> {
    const live = this.live_;
    const date = this.liveDate_;
    if (!live || !date) return null;
    return {
      coordinatorId,
      state: live,
      date,
      items: live.status === 'live' ? await this.snapshotItems() : [],
      presented: await this.snapshotPresented(),
      devices,
    };
  }

  /**
   * A command from another operator device or a phone, applied here as the coordinator
   * (decisions D24, D25). Its identifier comes with it, so one sent again after a
   * reconnection is applied once. Run-sheet edits report the change for the notice.
   */
  applyOperatorCommand(
    id: string,
    command: OperatorCommand,
    _origin: CommandOrigin,
  ): Promise<OperatorCommandOutcome> {
    if (this.relay_ || this.isViewer) return Promise.resolve({ result: 'rejected' });
    switch (command.type) {
      case 'addItem':
      case 'removeItem':
      case 'moveItem':
        return this.remoteEdit(id, command).then((change) =>
          change ? { result: 'applied', change } : { result: 'rejected' },
        );
      case 'goLive':
        return this.mutate(async () => {
          if (this.live_?.appliedCommandIds.includes(id)) return { result: 'duplicate' };
          const sheet = await this.store.ensureRunSheet(this.workspace_.id, command.date);
          if (!this.live_) {
            await this.setLive(createLiveState(sheet.id, this.nowIso()));
            return { result: 'applied' };
          }
          return {
            result: await this.applyWithResult({ type: 'goLive', runSheetId: sheet.id }, id),
          };
        });
      default:
        return this.mutate(async () => ({ result: await this.applyWithResult(command, id) }));
    }
  }

  // ── Changes from other devices ───────────────────────────────────────────

  /**
   * Runs a change made outside this session, such as content received from the church
   * instance, in turn with the session's own operations. Afterwards the workspace and the
   * live state are read again; when the presented song's lyrics changed, the presentation
   * follows them as it does for a local edit.
   */
  external<T>(change: () => Promise<T>): Promise<T> {
    return this.mutate(async () => {
      const presentedId = this.live_?.presented?.songId;
      const before = presentedId ? await this.store.getSong(presentedId) : null;
      const linesBefore = (await this.store.getPresentationSettings(this.workspace_.id))
        .linesPerPiece;
      const result = await change();

      this.workspace_ = (await this.store.getWorkspace()) ?? this.workspace_;
      const saved = await this.store.loadLiveState(this.workspace_.id);
      let live = saved && this.live_ ? { ...this.live_, ...pickIds(saved) } : (saved ?? this.live_);
      const after = before ? await this.store.getSong(before.id) : null;
      const linesAfter = (await this.store.getPresentationSettings(this.workspace_.id))
        .linesPerPiece;
      if (live && before && after) {
        live = relocatePresented(
          live,
          before.id,
          songPieces(before, linesBefore),
          songPieces(after, linesAfter),
          this.nowIso(),
        );
      }
      if (this.snapshot_) {
        // The coordinator's state stands while following; only lyrics edits are followed.
        if (live && live !== this.live_) {
          this.live_ = live;
          await this.store.saveLiveState(this.workspace_.id, live);
        }
        return result;
      }
      if (live && !(await this.store.getRunSheet(live.runSheetId))) live = null;
      if (live !== this.live_ || live) await this.setLive(live);
      return result;
    });
  }

  /** Applies content received from the church instance. */
  applyRemote(apply: () => Promise<AppliedChanges>): Promise<AppliedChanges> {
    return this.external(apply);
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
  async frame(
    mediaUrl: (fileName: string) => string,
    kind: OutputKind = 'slideshow',
  ): Promise<OutputFrame> {
    const workspaceId = this.workspace_.id;
    const settings = await this.store.getPresentationSettings(workspaceId);
    const profile = await this.store.getOutputProfile(workspaceId, kind);
    const fontFamily = await this.fontFamily(kind);
    const presented = this.isLive ? this.live_!.presented : null;
    let song = presented ? await this.store.getSong(presented.songId) : null;
    // While following, a presented song not synchronized here yet is drawn from the snapshot:
    // its text on the default background, until content synchronization brings the rest.
    const carried = this.snapshot_?.presented;
    let carriedPieces: SnapshotPiece[] | null = null;
    if (presented && !song && carried && carried.itemId === presented.itemId) {
      song = entryFromSnapshot(
        {
          itemId: carried.itemId,
          songId: carried.songId,
          title: carried.title,
          removed: false,
          kind: carried.kind,
          pieces: carried.pieces,
        },
        presented.runSheetId,
        0,
        this.nowIso(),
      ).song;
      song.background = carried.background;
      carriedPieces = carried.pieces;
    }
    // The presented song's own background, if it has one, replaces the slideshow's. Slides
    // are shown whole, on black where their shape differs from the screen's, and a website
    // is on black while it loads.
    const background =
      song?.deck || song?.website
        ? { color: '#000000', assetId: null }
        : (song?.background ?? {
            color: profile.backgroundColor,
            assetId: profile.backgroundAssetId,
          });
    const asset = background.assetId
      ? (await this.store.listBackgrounds(workspaceId)).find((b) => b.id === background.assetId)
      : undefined;

    const frame: OutputFrame = {
      layout: kind,
      blank: this.isLive && this.live_!.blank,
      fontFamily,
      scale: profile.scale,
      // Subtitles keep source-line boundaries and are never wrapped.
      wrap: kind === 'slideshow' && settings.wrapLongLines,
      hideCursor: profile.hideCursor,
      background: {
        color: background.color,
        media: asset ? { kind: asset.kind, url: mediaUrl(asset.fileName) } : null,
      },
      song: null,
      pieceId: null,
      picture: null,
      website: null,
    };

    if (presented && song?.website) {
      // The page is shown by the slideshow window only; a subtitle overlay shows nothing.
      if (presented.pieceId === WEBSITE_PIECE_ID) {
        if (kind === 'slideshow' && !frame.blank) frame.website = { url: song.website.url };
        frame.pieceId = WEBSITE_PIECE_ID;
      }
    } else if (presented && song?.deck) {
      // A subtitle overlay has no lyrics to show for slides.
      const page = song.deck.pages.find((p) => p.image === presented.pieceId);
      if (page && kind === 'slideshow' && !frame.blank)
        frame.picture = { url: mediaUrl(page.image) };
      frame.pieceId = page ? page.image : null;
    } else if (presented && song) {
      const pieces = carriedPieces
        ? carriedPieces.map((piece) => ({ id: piece.id, lines: piece.lines }))
        : songPieces(song, settings.linesPerPiece).map((piece) => ({
            id: piece.id,
            lines: piece.lines.map((l) => l.text),
          }));
      frame.song = { id: song.id, pieces };
      frame.pieceId = pieces.some((piece) => piece.id === presented.pieceId)
        ? presented.pieceId
        : null;
    }
    return frame;
  }
}

export type { CopyMode };

/** The parts of a saved live state that refer to run sheets, after they were remapped. */
function pickIds(saved: LiveState): Pick<LiveState, 'runSheetId' | 'presented'> {
  return { runSheetId: saved.runSheetId, presented: saved.presented };
}
