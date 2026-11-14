/**
 * Chunks of live audio recordings waiting to reach the church server (service records R7;
 * task M3.2). They survive a restart of the app: the queue keeps them in the webview's
 * IndexedDB. Up to a limit, 500 MB by default (about 17 hours at 64 kbps); past it the oldest
 * recording still waiting is dropped whole, never a chunk from the middle of one.
 *
 * The logic is here over a small storage interface, so it runs on a memory store in tests;
 * `indexedDbRecordStorage` is the webview's.
 */
import type { RecordingContainer } from '@worship-q/protocol';

export const RECORD_QUEUE_LIMIT_BYTES = 500 * 1024 * 1024;

/** A recording as the queue keeps it, until the server has all of it. */
export interface QueuedRecording {
  id: string;
  startedAt: string;
  container: RecordingContainer;
  mimeType: string;
  inputName: string;
  /** When recording stopped; null while it goes on. */
  endedAt: string | null;
  /** Chunks recorded so far; the next one is numbered this. */
  chunks: number;
  /** The first chunk the server does not have yet. */
  sent: number;
  /** Bytes of the chunks not yet sent. */
  bytes: number;
  /** The server has opened it. */
  opened: boolean;
  /** Some of it can never reach the server. */
  cutShort: boolean;
  /** Order of creation, so the oldest goes first. */
  order: number;
  /** When the last chunk was queued; absent on a recording queued before it was kept. */
  lastChunkAt?: string | null;
}

export interface RecordStorage {
  recordings(): Promise<QueuedRecording[]>;
  putRecording(recording: QueuedRecording): Promise<void>;
  /** Removes a recording and every chunk of it. */
  deleteRecording(id: string): Promise<void>;
  putChunk(id: string, seq: number, bytes: Uint8Array): Promise<void>;
  getChunk(id: string, seq: number): Promise<Uint8Array | null>;
  deleteChunks(id: string, below: number): Promise<void>;
}

export class RecordQueue {
  private readonly cache = new Map<string, QueuedRecording>();
  private loaded: Promise<void> | null = null;
  /** Writes run one at a time, in order. */
  private chain: Promise<unknown> = Promise.resolve();
  private order = 0;
  /** Recordings dropped for the limit since the app started. */
  dropped = 0;

  constructor(
    private readonly storage: RecordStorage,
    private readonly limitBytes = RECORD_QUEUE_LIMIT_BYTES,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private load(): Promise<void> {
    this.loaded ??= this.storage.recordings().then(async (recordings) => {
      for (const recording of recordings) {
        // No recorder runs before the queue is loaded: a recording still open was cut off by
        // the app quitting or failing. It ends at its last chunk, so it can be completed.
        const open = recording.endedAt === null;
        const loaded = open
          ? { ...recording, endedAt: recording.lastChunkAt ?? recording.startedAt }
          : recording;
        this.cache.set(loaded.id, loaded);
        if (open) await this.storage.putRecording(loaded);
        this.order = Math.max(this.order, recording.order);
      }
    });
    return this.loaded;
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => this.load()).then(work);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async save(recording: QueuedRecording): Promise<void> {
    this.cache.set(recording.id, recording);
    await this.storage.putRecording(recording);
  }

  /** Every recording waiting, oldest first. */
  list(): Promise<QueuedRecording[]> {
    return this.run(async () => [...this.cache.values()].sort((a, b) => a.order - b.order));
  }

  /** Bytes waiting in all. */
  totalBytes(): Promise<number> {
    return this.run(async () =>
      [...this.cache.values()].reduce((total, recording) => total + recording.bytes, 0),
    );
  }

  create(
    recording: Pick<QueuedRecording, 'id' | 'startedAt' | 'container' | 'mimeType' | 'inputName'>,
  ): Promise<void> {
    return this.run(() =>
      this.save({
        ...recording,
        endedAt: null,
        chunks: 0,
        sent: 0,
        bytes: 0,
        opened: false,
        cutShort: false,
        order: ++this.order,
      }),
    );
  }

  /**
   * Adds the next chunk of a recording. Past the limit, the oldest other recording is dropped
   * whole, as many as it takes; the one being recorded is never dropped. Returns the ids
   * dropped.
   */
  append(id: string, bytes: Uint8Array): Promise<string[]> {
    return this.run(async () => {
      const recording = this.cache.get(id);
      if (!recording || bytes.length === 0) return [];
      await this.storage.putChunk(id, recording.chunks, bytes);
      await this.save({
        ...recording,
        chunks: recording.chunks + 1,
        lastChunkAt: this.now(),
        bytes: recording.bytes + bytes.length,
      });
      const dropped: string[] = [];
      const total = () => [...this.cache.values()].reduce((sum, r) => sum + r.bytes, 0);
      while (total() > this.limitBytes) {
        const oldest = [...this.cache.values()]
          .filter((r) => r.id !== id)
          .sort((a, b) => a.order - b.order)[0];
        if (!oldest) break;
        this.cache.delete(oldest.id);
        await this.storage.deleteRecording(oldest.id);
        dropped.push(oldest.id);
        this.dropped++;
      }
      return dropped;
    });
  }

  /** Recording stopped: no chunk follows. */
  finish(id: string, endedAt: string): Promise<void> {
    return this.run(async () => {
      const recording = this.cache.get(id);
      if (recording && recording.endedAt === null) await this.save({ ...recording, endedAt });
    });
  }

  /** The first chunk the server does not have, or null while there is none. */
  next(id: string): Promise<{ seq: number; bytes: Uint8Array } | null> {
    return this.run(async () => {
      const recording = this.cache.get(id);
      if (!recording || recording.sent >= recording.chunks) return null;
      const bytes = await this.storage.getChunk(id, recording.sent);
      return bytes ? { seq: recording.sent, bytes } : null;
    });
  }

  /**
   * The server expects chunk `next`: everything before it is stored there, and is dropped
   * here. A server that expects a chunk no longer held can never have it: the recording is
   * marked as cut short, and what is left of it is dropped. Returns whether it went on.
   */
  acknowledge(id: string, next: number): Promise<boolean> {
    return this.run(async () => {
      const recording = this.cache.get(id);
      if (!recording) return false;
      if (next < recording.sent && !(await this.storage.getChunk(id, next))) {
        await this.storage.deleteChunks(id, recording.chunks);
        await this.save({ ...recording, sent: recording.chunks, bytes: 0, cutShort: true });
        return false;
      }
      const sent = Math.min(next, recording.chunks);
      let bytes = recording.bytes;
      for (let seq = recording.sent; seq < sent; seq++) {
        bytes -= (await this.storage.getChunk(id, seq))?.length ?? 0;
      }
      await this.storage.deleteChunks(id, sent);
      await this.save({ ...recording, sent, bytes: Math.max(0, bytes) });
      return true;
    });
  }

  markOpened(id: string): Promise<void> {
    return this.run(async () => {
      const recording = this.cache.get(id);
      if (recording && !recording.opened) await this.save({ ...recording, opened: true });
    });
  }

  /** The server has all of it, or refused it for good. */
  remove(id: string): Promise<void> {
    return this.run(async () => {
      this.cache.delete(id);
      await this.storage.deleteRecording(id);
    });
  }
}

/** A storage in memory, for tests; a copy of each chunk is kept, as IndexedDB does. */
export function memoryRecordStorage(): RecordStorage & {
  chunkCount(): number;
} {
  const recordings = new Map<string, QueuedRecording>();
  const chunks = new Map<string, Uint8Array>();
  const key = (id: string, seq: number) => `${id}:${seq}`;
  return {
    recordings: async () => [...recordings.values()].map((r) => ({ ...r })),
    putRecording: async (recording) => void recordings.set(recording.id, { ...recording }),
    deleteRecording: async (id) => {
      recordings.delete(id);
      for (const k of [...chunks.keys()]) if (k.startsWith(`${id}:`)) chunks.delete(k);
    },
    putChunk: async (id, seq, bytes) => void chunks.set(key(id, seq), bytes.slice()),
    getChunk: async (id, seq) => chunks.get(key(id, seq))?.slice() ?? null,
    deleteChunks: async (id, below) => {
      for (const k of [...chunks.keys()]) {
        const [owner, seq] = k.split(':');
        if (owner === id && Number(seq) < below) chunks.delete(k);
      }
    },
    chunkCount: () => chunks.size,
  };
}

/**
 * The webview's IndexedDB: one store of recordings and one of chunks, keyed by recording and
 * number. It has no automated tests; the walkthrough covers it.
 */
export function indexedDbRecordStorage(name = 'worship-q-recordings'): RecordStorage {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('recordings', { keyPath: 'id' });
        database.createObjectStore('chunks');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const done = <T>(request: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const store = async (names: string[], mode: IDBTransactionMode) =>
    (await db()).transaction(names, mode);
  const range = (id: string, below: number) => IDBKeyRange.bound([id, 0], [id, below], false, true);
  return {
    async recordings() {
      const tx = await store(['recordings'], 'readonly');
      return done(tx.objectStore('recordings').getAll() as IDBRequest<QueuedRecording[]>);
    },
    async putRecording(recording) {
      const tx = await store(['recordings'], 'readwrite');
      await done(tx.objectStore('recordings').put(recording));
    },
    async deleteRecording(id) {
      const tx = await store(['recordings', 'chunks'], 'readwrite');
      await done(tx.objectStore('recordings').delete(id));
      await done(tx.objectStore('chunks').delete(range(id, Number.MAX_SAFE_INTEGER)));
    },
    async putChunk(id, seq, bytes) {
      const tx = await store(['chunks'], 'readwrite');
      await done(tx.objectStore('chunks').put(bytes, [id, seq]));
    },
    async getChunk(id, seq) {
      const tx = await store(['chunks'], 'readonly');
      const found = await done(tx.objectStore('chunks').get([id, seq]) as IDBRequest<unknown>);
      return found instanceof Uint8Array ? found : null;
    },
    async deleteChunks(id, below) {
      // An empty range cannot be made.
      if (below <= 0) return;
      const tx = await store(['chunks'], 'readwrite');
      await done(tx.objectStore('chunks').delete(range(id, below)));
    },
  };
}
