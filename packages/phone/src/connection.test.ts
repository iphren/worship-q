import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteConnection, type PhoneLink, type PhoneSocket } from './connection';

/** A connection the test drives: what the phone sent, and answers from the relay. */
class FakeSocket implements PhoneSocket {
  static all: FakeSocket[] = [];
  open = false;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: PhoneSocket['onclose'] = null;
  constructor(readonly via: 'lan' | 'relay') {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.open = false;
  }
  opened() {
    this.open = true;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.(JSON.stringify(message));
  }
  asked(): string[] {
    return this.sent.filter((m) => m.type === 'thumbnail').map((m) => String(m.name));
  }
}

/** A phone named Sam, invited to `ws-1`, keeping its grant in memory. */
function fakeLink(changes: Partial<PhoneLink> = {}): PhoneLink & { grant: string | null } {
  const link: PhoneLink & { grant: string | null } = {
    grant: null,
    workspace: 'ws-1',
    invite: 'dev.secret',
    lan: null,
    connect: () => new FakeSocket('relay'),
    store: {
      name: () => 'Sam',
      setName: () => undefined,
      grant: () => link.grant,
      setGrant: (grant) => void (link.grant = grant),
    },
    fileUrl: (name: string) => `/files/${name}`,
    ...changes,
  };
  return link;
}

const name = (n: number) =>
  `deck-0f8fad5b-d9cb-469f-a165-70867728950e-${String(n).padStart(3, '0')}-t.jpg`;

beforeEach(() => {
  FakeSocket.all = [];
  let urls = 0;
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => `blob:${++urls}` });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function connect(changes: Partial<PhoneLink> = {}) {
  const connection = new RemoteConnection(fakeLink(changes));
  connection.start();
  const socket = FakeSocket.all.at(-1)!;
  socket.opened();
  socket.receive({ type: 'approved', grant: 'g.1' });
  return { connection, socket };
}

describe('the phone when the workspace is full (S3)', () => {
  it('says how many phones the public server allows', () => {
    const connection = new RemoteConnection(fakeLink());
    connection.start();
    const socket = FakeSocket.all.at(-1)!;
    socket.opened();
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

  it('loads a slide the desktop does not have from the server (native apps M2.8)', async () => {
    const { connection, socket } = connect();
    const answer = connection.thumbnail(name(1));
    socket.receive({ type: 'thumbnail', name: name(1), missing: true });
    expect(await answer).toBe(`/files/${name(1)}`);
    connection.stop();
  });

  it('gives null when neither the desktop nor a server has it', async () => {
    const { connection, socket } = connect({ fileUrl: () => null });
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

describe('what the link decides (native apps M2.5)', () => {
  it('keeps the grant where the link keeps it, and says the invitation was used', () => {
    const inviteUsed = vi.fn();
    const link = fakeLink({ inviteUsed });
    const connection = new RemoteConnection(link);
    connection.start();
    const socket = FakeSocket.all.at(-1)!;
    socket.opened();
    expect(socket.sent[0]).toMatchObject({
      type: 'hello',
      workspace: 'ws-1',
      invite: 'dev.secret',
    });
    socket.receive({ type: 'approved', grant: 'g.1' });
    expect(link.grant).toBe('g.1');
    expect(inviteUsed).toHaveBeenCalledOnce();
    connection.stop();
  });

  it('comes back with the grant, not the used invitation', () => {
    const link = fakeLink();
    const first = new RemoteConnection(link);
    first.start();
    FakeSocket.all.at(-1)!.opened();
    FakeSocket.all.at(-1)!.receive({ type: 'approved', grant: 'g.1' });
    first.stop();
    const again = new RemoteConnection({ ...link, invite: null });
    again.start();
    const socket = FakeSocket.all.at(-1)!;
    socket.opened();
    expect(socket.sent[0]).toMatchObject({ grant: 'g.1' });
    expect(socket.sent[0]).not.toHaveProperty('invite');
    again.stop();
  });

  it('forgets a revoked grant', () => {
    const link = fakeLink();
    link.grant = 'g.1';
    const connection = new RemoteConnection({ ...link, invite: null });
    connection.start();
    const socket = FakeSocket.all.at(-1)!;
    socket.opened();
    socket.receive({ type: 'denied', reason: 'revoked' });
    expect(link.grant).toBeNull();
    expect(connection.state).toEqual({ kind: 'denied', reason: 'revoked' });
    connection.stop();
  });

  it('says whether it reached the coordinator on the venue network', () => {
    const connection = new RemoteConnection(fakeLink({ connect: () => new FakeSocket('lan') }));
    expect(connection.via).toBe('relay');
    connection.start();
    FakeSocket.all.at(-1)!.opened();
    expect(connection.via).toBe('lan');
    connection.stop();
  });

  it('loads server files at the address the link gives', () => {
    expect(new RemoteConnection(fakeLink()).fileUrl('a.jpg')).toBe('/files/a.jpg');
  });
});
