/**
 * Sends the recordings this computer made to the church server (service records R7, R8; task
 * M3.3). One request at a time, in order: a recording is opened, its chunks follow by
 * number, and it is completed once it has stopped and the server has every chunk. A failure
 * waits a growing while, from a second to a minute, and tries again from where it was; a
 * chunk is sent again only when the server did not take it. The server's expected number is
 * followed; a recording the server refuses for good is dropped.
 */
import type { QueuedRecording, RecordQueue } from '@worship-q/audio';
import type { RecordingComplete, RecordingOpen } from '@worship-q/protocol';

/** The first wait after a failure, doubled each time up to the last. */
export const UPLOAD_RETRY_MS = [1000, 2000, 5000, 15_000, 30_000, 60_000];

/** What the server answered. `retry` covers no answer at all. */
export type UploadAnswer =
  | { kind: 'ok'; next?: number }
  | { kind: 'gap'; expected: number }
  | { kind: 'refused' }
  | { kind: 'retry' };

export interface RecordingApi {
  open(body: RecordingOpen): Promise<UploadAnswer>;
  chunk(id: string, seq: number, bytes: Uint8Array): Promise<UploadAnswer>;
  complete(id: string, body: RecordingComplete): Promise<UploadAnswer>;
}

export interface RecordingUploaderDeps {
  queue: RecordQueue;
  api: RecordingApi;
  /** Connected to a server that takes recordings. */
  reachable: () => boolean;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Something was sent or dropped: the amount waiting changed. */
  onChange?: () => void;
}

export class RecordingUploader {
  private running = false;
  private again = false;
  private failures = 0;
  private timer: unknown = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly later: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly deps: RecordingUploaderDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.later = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.clearTimeout ?? ((handle) => clearTimeout(handle as number));
  }

  /** Something may be ready to send: a chunk was queued, or the server came back. */
  kick(): void {
    if (this.stopped || this.timer !== null) return;
    if (this.running) {
      this.again = true;
      return;
    }
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }

  /** Sends what it can; resolves when nothing more can go now. */
  async run(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      do {
        this.again = false;
        if (!this.deps.reachable()) return;
        const outcome = await this.pass();
        if (outcome === 'failed') {
          this.retryLater();
          return;
        }
        this.failures = 0;
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
    }
  }

  private retryLater(): void {
    const wait = UPLOAD_RETRY_MS[Math.min(this.failures, UPLOAD_RETRY_MS.length - 1)]!;
    this.failures++;
    this.timer = this.later(() => {
      this.timer = null;
      void this.run();
    }, wait);
  }

  /** One pass over every recording waiting, oldest first. */
  private async pass(): Promise<'done' | 'failed'> {
    for (const recording of await this.deps.queue.list()) {
      const outcome = await this.send(recording);
      if (outcome === 'failed') return 'failed';
    }
    return 'done';
  }

  private async send(recording: QueuedRecording): Promise<'done' | 'failed'> {
    const { queue, api } = this.deps;
    if (!recording.opened) {
      const answer = await api.open({
        id: recording.id,
        startedAt: recording.startedAt,
        container: recording.container,
        mimeType: recording.mimeType,
        inputName: recording.inputName,
        sentAt: new Date(this.now()).toISOString(),
      });
      if (answer.kind === 'refused') return this.drop(recording.id);
      if (answer.kind !== 'ok') return 'failed';
      await queue.markOpened(recording.id);
    }
    for (;;) {
      const chunk = await queue.next(recording.id);
      if (!chunk) break;
      const answer = await api.chunk(recording.id, chunk.seq, chunk.bytes);
      if (answer.kind === 'refused') return this.drop(recording.id);
      if (answer.kind === 'retry') return 'failed';
      const next = answer.kind === 'gap' ? answer.expected : (answer.next ?? chunk.seq + 1);
      await queue.acknowledge(recording.id, next);
      this.deps.onChange?.();
    }
    const now = (await queue.list()).find((r) => r.id === recording.id);
    if (!now || now.endedAt === null || now.sent < now.chunks) return 'done';
    const answer = await api.complete(recording.id, {
      endedAt: now.endedAt,
      ...(now.cutShort ? { cutShort: true } : {}),
    });
    if (answer.kind === 'retry' || answer.kind === 'gap') return 'failed';
    await queue.remove(recording.id);
    this.deps.onChange?.();
    return 'done';
  }

  private async drop(id: string): Promise<'done'> {
    await this.deps.queue.remove(id);
    this.deps.onChange?.();
    return 'done';
  }
}

/** Reads an answer to a recording request. */
export async function uploadAnswer(response: Response): Promise<UploadAnswer> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    expected?: number;
    next?: number;
  };
  if (response.ok)
    return { kind: 'ok', ...(typeof body.next === 'number' ? { next: body.next } : {}) };
  if (response.status === 409 && body.error === 'gap' && typeof body.expected === 'number') {
    return { kind: 'gap', expected: body.expected };
  }
  // Refused for good: the church turned recording off, the recording is another device's or
  // already complete, or this device is not known. Anything else is tried again.
  if (
    response.status === 401 ||
    response.status === 404 ||
    (response.status === 403 && body.error !== undefined) ||
    (response.status === 409 && (body.error === 'completed' || body.error === 'conflict'))
  ) {
    return { kind: 'refused' };
  }
  return { kind: 'retry' };
}
