import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteConnection } from './connection';

/** A WebSocket the test drives: what the phone sent, and answers from the relay. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  asked(): string[] {
    return this.sent.filter((m) => m.type === 'thumbnail').map((m) => String(m.name));
  }
}

const name = (n: number) =>
  `deck-0f8fad5b-d9cb-469f-a165-70867728950e-${String(n).padStart(3, '0')}-t.jpg`;

beforeEach(() => {
  FakeSocket.all = [];
  const kept = new Map<string, string>([['wq.remote.name', 'Sam']]);
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { origin: 'https://public.worship-q.com', pathname: '/remote/' });
  vi.stubGlobal('history', { replaceState: () => undefined });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  });
  let urls = 0;
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => `blob:${++urls}` });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function connect() {
  const connection = new RemoteConnection({
    search: '?w=ws-1',
    hash: '#i=dev.secret',
  } as Location);
  connection.start();
  const socket = FakeSocket.all.at(-1)!;
  socket.open();
  socket.receive({ type: 'approved', grant: 'g.1' });
  return { connection, socket };
}

describe('the phone when the workspace is full (S3)', () => {
  it('says how many phones the public server allows', () => {
    const connection = new RemoteConnection({ search: '?w=ws-1', hash: '#i=d.s' } as Location);
    connection.start();
    const socket = FakeSocket.all.at(-1)!;
    socket.open();
    socket.receive({ type: 'unavailable', reason: 'full', limit: 2 });
    expect(connection.state).toEqual({ kind: 'full', limit: 2 });
    connection.stop();
  });
});

describe('thumbnails from the desktop (S7, S8)', () => {
  it('asks four at a time, and the next as each answer comes', async () => {
    const { connection, socket } = connect();
    const answers = [1, 2, 3, 4, 5, 6].map((n) => connection.thumbnail(name(n)));
    expect(socket.asked()).toEqual([name(1), name(2), name(3), name(4)]);
    socket.receive({ type: 'thumbnail', name: name(1), data: 'aGk=' });
    expect(socket.asked()).toHaveLength(5);
    expect(await answers[0]).toBe('blob:1');
    connection.stop();
  });

  it('asks once per name, and keeps the answer for the page’s life', async () => {
    const { connection, socket } = connect();
    const first = connection.thumbnail(name(1));
    const again = connection.thumbnail(name(1));
    expect(socket.asked()).toEqual([name(1)]);
    socket.receive({ type: 'thumbnail', name: name(1), data: 'aGk=' });
    expect(await first).toBe(await again);
    expect(await connection.thumbnail(name(1))).toBe('blob:1');
    expect(socket.asked()).toEqual([name(1)]);
    connection.stop();
  });

  it('gives null for a slide the desktop does not have', async () => {
    const { connection, socket } = connect();
    const answer = connection.thumbnail(name(1));
    socket.receive({ type: 'thumbnail', name: name(1), missing: true });
    expect(await answer).toBeNull();
    connection.stop();
  });

  it('asks again, after reconnecting, for what the lost connection took', () => {
    const { connection, socket } = connect();
    void connection.thumbnail(name(1));
    socket.receive({ type: 'approved', grant: 'g.1' });
    // The answer never came; being let in again asks once more.
    expect(socket.asked()).toEqual([name(1), name(1)]);
    connection.stop();
  });
});
