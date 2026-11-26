import { invitationLink, routerView } from '@worship-q/protocol';
import { RemoteConnection } from '@worship-q/phone';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserLink } from './browser';

/** A browser WebSocket the test drives. */
class FakeWebSocket {
  static OPEN = 1;
  static all: FakeWebSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

let kept: Map<string, string>;
const replaceState = vi.fn();

beforeEach(() => {
  FakeWebSocket.all = [];
  kept = new Map([['wq.remote.name', 'Sam']]);
  replaceState.mockClear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('history', { replaceState });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function page(href: string): Location {
  const url = new URL(href);
  return {
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  } as Location;
}

describe('the phone page', () => {
  it('connects to the relay at its own origin and keeps the grant in browser storage', () => {
    const connection = new RemoteConnection(
      browserLink(page('https://church.example.org/remote/?w=ws-1#i=d.s')),
    );
    connection.start();
    const socket = FakeWebSocket.all.at(-1)!;
    expect(socket.url).toBe('wss://church.example.org/api/v1/remote');
    socket.open();
    expect(socket.sent[0]).toMatchObject({ type: 'hello', workspace: 'ws-1', invite: 'd.s' });
    socket.receive({ type: 'approved', grant: 'g.1' });
    expect(kept.get('wq.remote.grant.ws-1')).toBe('g.1');
    // Reloading the page uses the grant, not the used invitation.
    expect(replaceState).toHaveBeenCalledWith(null, '', '/remote/?w=ws-1');
    expect(connection.fileUrl('a b.jpg')).toBe('/api/v1/remote/files/ws-1/a%20b.jpg');
    connection.stop();
  });
});

describe('opened from the link router (native apps M1)', () => {
  it('reads the workspace, the invitation and the venue network from Continue', () => {
    const link = invitationLink({
      server: 'church.example.org',
      workspace: 'ws 1',
      invite: 'dev-1.secret',
      lan: { fingerprint: 'AB:CD', addresses: ['10.0.0.2', '10.0.0.3'], port: 47311 },
    });
    const view = routerView(new URL(link).hash);
    if (view.kind !== 'continue') throw new Error(`router page shows ${view.kind}`);
    const continued = new URL(view.href);
    expect(continued.origin + continued.pathname).toBe('https://church.example.org/remote/');

    const connection = new RemoteConnection(browserLink(page(view.href)));
    expect(connection.workspace).toBe('ws 1');
    expect(connection.lan).toEqual({
      fingerprint: 'AB:CD',
      addresses: ['10.0.0.2', '10.0.0.3'],
      port: 47311,
    });
    connection.start();
    const socket = FakeWebSocket.all.at(-1)!;
    socket.open();
    expect(socket.sent[0]).toMatchObject({
      type: 'hello',
      workspace: 'ws 1',
      invite: 'dev-1.secret',
    });
    connection.stop();
  });
});
