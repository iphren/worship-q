import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appSocket, type Candidate, type Ways } from './appSocket';

class FakeCandidate implements Candidate {
  sent: string[] = [];
  closed = false;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((reason?: string) => void) | null = null;
  constructor(
    readonly via: 'lan' | 'relay',
    readonly where: string,
  ) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

/** Ways whose attempts the test settles by hand. */
function fakeWays() {
  const pending = new Map<string, { ok(): FakeCandidate; fail(): void }>();
  const browses: { resolve(found: Awaited<ReturnType<Ways['browse']>>): void }[] = [];
  const attempt = (via: 'lan' | 'relay', where: string) =>
    new Promise<Candidate>((resolve, reject) => {
      pending.set(where, {
        ok: () => {
          const candidate = new FakeCandidate(via, where);
          resolve(candidate);
          return candidate;
        },
        fail: () => reject(new Error('unreachable')),
      });
    });
  const ways: Ways = {
    relay: (url) => attempt('relay', url),
    lan: (address, port, fingerprint) => attempt('lan', `${address}:${port}:${fingerprint}`),
    browse: () => new Promise((resolve) => browses.push({ resolve })),
  };
  return { ways, pending, browses };
}

const DESK = {
  deviceId: 'd1',
  name: 'Main',
  fingerprint: 'AB:CD',
  addresses: ['10.0.0.2'],
  port: 47311,
};
const RELAY = 'wss://church.example.org/api/v1/remote';
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function open(trusted = [DESK], relayUrl: string | null = RELAY) {
  const fake = fakeWays();
  const socket = appSocket({ relayUrl, workspace: 'ws-1', trusted }, fake.ways);
  const events: string[] = [];
  socket.onopen = () => events.push(`open ${socket.via}`);
  socket.onclose = (info) => events.push(`close ${info.reason ?? ''}`);
  socket.onmessage = (data) => events.push(`message ${data}`);
  return { ...fake, socket, events };
}

describe('the app’s connection (native apps M2.7)', () => {
  it('uses the venue network when it answers, and closes the relay', async () => {
    const { pending, socket, events } = open();
    const relay = pending.get(RELAY)!.ok();
    await flush();
    pending.get('10.0.0.2:47311:AB:CD')!.ok();
    await flush();
    expect(events).toEqual(['open lan']);
    expect(relay.closed).toBe(true);
    socket.send('hello');
    expect(socket.open).toBe(true);
  });

  it('says nothing on any connection until one is chosen', async () => {
    const { pending } = open();
    const relay = pending.get(RELAY)!.ok();
    await flush();
    const lan = pending.get('10.0.0.2:47311:AB:CD')!.ok();
    await flush();
    expect(relay.sent).toEqual([]);
    expect(lan.sent).toEqual([]);
  });

  it('waits a moment for the venue network once the relay is open, then uses the relay', async () => {
    const { pending, events, browses } = open();
    pending.get(RELAY)!.ok();
    await flush();
    expect(events).toEqual([]);
    browses[0]!.resolve([]);
    await vi.advanceTimersByTimeAsync(2499);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual(['open relay']);
  });

  it('uses the relay at once when the venue network has failed', async () => {
    const { pending, events, browses } = open();
    pending.get('10.0.0.2:47311:AB:CD')!.fail();
    browses[0]!.resolve([]);
    await flush();
    pending.get(RELAY)!.ok();
    await flush();
    expect(events).toEqual(['open relay']);
  });

  it('works with no internet: the relay fails and the venue network answers', async () => {
    const { pending, events } = open();
    pending.get(RELAY)!.fail();
    await flush();
    pending.get('10.0.0.2:47311:AB:CD')!.ok();
    await flush();
    expect(events).toEqual(['open lan']);
  });

  it('finds a trusted device at a new address with mDNS (the coordinator moved)', async () => {
    const { pending, events, browses } = open();
    pending.get('10.0.0.2:47311:AB:CD')!.fail();
    pending.get(RELAY)!.fail();
    browses[0]!.resolve([{ fingerprint: 'ab:cd', addresses: ['10.0.0.9'], port: 47311 }]);
    await flush();
    pending.get('10.0.0.9:47311:AB:CD')!.ok();
    await flush();
    expect(events).toEqual(['open lan']);
  });

  it('never connects to a device mDNS found that it does not trust (N30)', async () => {
    const { pending, events, browses } = open();
    pending.get('10.0.0.2:47311:AB:CD')!.fail();
    pending.get(RELAY)!.fail();
    browses[0]!.resolve([{ fingerprint: 'EE:FF', addresses: ['10.0.0.66'], port: 47311 }]);
    await flush();
    expect([...pending.keys()].some((key) => key.includes('10.0.0.66'))).toBe(false);
    expect(events).toEqual(['close unreachable']);
  });

  it('gives up for now when nothing answers, so the connection tries again later', async () => {
    const { pending, events, browses } = open();
    pending.get('10.0.0.2:47311:AB:CD')!.fail();
    pending.get(RELAY)!.fail();
    browses[0]!.resolve([]);
    await flush();
    expect(events).toEqual(['close unreachable']);
  });

  it('uses only the relay when it trusts no device yet', async () => {
    const { pending, events } = open([]);
    pending.get(RELAY)!.ok();
    await flush();
    expect(events).toEqual(['open relay']);
  });

  it('passes messages on and reports the chosen connection closing', async () => {
    const { pending, events } = open();
    pending.get(RELAY)!.fail();
    const lan = pending.get('10.0.0.2:47311:AB:CD')!.ok();
    await flush();
    lan.onmessage?.('{"type":"view"}');
    lan.onclose?.('gone');
    expect(events).toEqual(['open lan', 'message {"type":"view"}', 'close gone']);
  });

  it('closes everything when it is closed before choosing', async () => {
    const { pending, socket, events } = open();
    const relay = pending.get(RELAY)!.ok();
    await flush();
    socket.close();
    expect(relay.closed).toBe(true);
    const late = pending.get('10.0.0.2:47311:AB:CD')!.ok();
    await flush();
    expect(late.closed).toBe(true);
    expect(events).toEqual(['close ']);
  });
});
