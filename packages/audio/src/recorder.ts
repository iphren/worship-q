/**
 * Recording the broadcast on the broadcasting computer (service records R4, R5, R7; task
 * M3.1). This decides when a recording opens and closes, and hands its chunks to the queue,
 * in order; `RecordingUploader` in the desktop app sends them on.
 *
 * One recording is one unbroken run of one capture track: it starts when the track is live,
 * and ends when the track ends or is replaced (the device unplugged, muted and taken again,
 * another input picked), the switch goes off, another computer takes over, or the app quits.
 * Nothing is recorded while there is no track (**Waiting for input**), nor while the church
 * server does not take recordings, nor where the webview cannot record.
 *
 * The recorder itself is behind a port, so the same logic runs on fakes in tests.
 */
import { recordingContainerOf, type RecordingContainer } from '@worship-q/protocol';
import type { CaptureTrack } from './input';
import type { RecordQueue } from './recordQueue';

/** The recorder's bit rate (R4): about 29 MB an hour. */
export const RECORDING_BITS_PER_SECOND = 64_000;
/** A chunk is handed over this often (R4). */
export const RECORDING_TIMESLICE_MS = 5000;

export interface RecorderEvents {
  /** A chunk, in order. */
  data(bytes: Uint8Array): void;
  /** The recorder stopped; no chunk follows. Called once. */
  stopped(): void;
}

export interface RecorderPort<T extends CaptureTrack> {
  /** The type this webview records in: WebM with Opus, else MP4 with AAC; null for neither. */
  type(): string | null;
  /** Starts recording the track; `stop` hands over the last chunk, then `stopped`. */
  start(track: T, type: string, events: RecorderEvents): { stop(): void };
}

/** Why nothing is being recorded while the broadcast is on; null while recording. */
export type RecorderIdle =
  /** The switch is off, or another computer took over. */
  | 'off'
  /** No input yet: **Waiting for input**. */
  | 'no-input'
  /** The church server does not take recordings, or is older than recordings. */
  | 'not-offered'
  /** This computer's webview can record neither WebM nor MP4. */
  | 'unsupported';

export interface RecorderStatus {
  recording: boolean;
  idle: RecorderIdle | null;
  /** Bytes recorded and not yet on the server. */
  waitingBytes: number;
  /** Recordings dropped because too much was waiting (R7). */
  dropped: number;
}

export interface RecorderSessionDeps<T extends CaptureTrack> {
  port: RecorderPort<T>;
  queue: RecordQueue;
  /** The church server takes recordings, as its info last said: offline too. */
  offered: () => boolean;
  inputName: () => string;
  newId: () => string;
  now: () => number;
  /** The status changed, or a chunk was queued. */
  onChange?: () => void;
}

interface Current<T> {
  id: string;
  track: T;
  handle: { stop(): void };
}

export class RecorderSession<T extends CaptureTrack> {
  private enabled = false;
  private track: T | null = null;
  private current: Current<T> | null = null;
  /** Queue writes of every recording, in the order they happened. */
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  constructor(private readonly deps: RecorderSessionDeps<T>) {}

  /** The capture track now: a new one ends the recording of the old. */
  setTrack(track: T | null): void {
    this.track = track;
    this.evaluate();
  }

  /** The switch is on here and nobody took over; off ends the recording. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.evaluate();
  }

  /** Whether the server takes recordings may have changed. */
  refresh(): void {
    this.evaluate();
  }

  /** The id of the recording going on now, which the uploader must not complete. */
  get recordingId(): string | null {
    return this.current?.id ?? null;
  }

  get status(): RecorderStatus {
    return {
      recording: this.current !== null,
      idle: this.current ? null : this.idle(),
      waitingBytes: this.waiting,
      dropped: this.deps.queue.dropped,
    };
  }

  /** Everything queued so far is in the queue. */
  settled(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  private idle(): RecorderIdle {
    if (!this.enabled) return 'off';
    if (!this.deps.offered()) return 'not-offered';
    if (!this.deps.port.type()) return 'unsupported';
    return 'no-input';
  }

  private evaluate(): void {
    const type = this.deps.port.type();
    const container = type ? recordingContainerOf(type) : null;
    const wanted = this.enabled && this.deps.offered() && this.track !== null && !!container;
    if (this.current && (!wanted || this.current.track !== this.track)) this.close();
    if (wanted && !this.current) this.open(this.track!, type!, container!);
    this.deps.onChange?.();
  }

  private queue(work: () => Promise<unknown>): void {
    this.chain = this.chain
      .then(work)
      .catch((error: unknown) => console.warn('Recording queue', error))
      .then(() => this.deps.queue.totalBytes())
      .then((bytes) => {
        this.waiting = bytes;
        this.deps.onChange?.();
      })
      .catch(() => undefined);
  }

  private open(track: T, type: string, container: RecordingContainer): void {
    const id = this.deps.newId();
    const startedAt = new Date(this.deps.now()).toISOString();
    const inputName = this.deps.inputName();
    this.queue(() =>
      this.deps.queue.create({ id, startedAt, container, mimeType: type, inputName }),
    );
    let stopped = false;
    const handle = this.deps.port.start(track, type, {
      data: (bytes) => {
        if (!stopped) this.queue(() => this.deps.queue.append(id, bytes));
      },
      stopped: () => {
        if (stopped) return;
        stopped = true;
        const endedAt = new Date(this.deps.now()).toISOString();
        this.queue(() => this.deps.queue.finish(id, endedAt));
      },
    });
    this.current = { id, track, handle };
  }

  private close(): void {
    const current = this.current;
    this.current = null;
    current?.handle.stop();
  }
}
