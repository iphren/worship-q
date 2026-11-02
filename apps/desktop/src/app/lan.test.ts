import { PROTOCOL_VERSION, type RelayToDesktop } from '@worship-q/protocol';
import { describe, expect, it, vi } from 'vitest';
import { native } from '../platform/native';
import { chooseCoordinator, LanTransport, type KnownPeer } from './lan';

/** The native core's LAN side, with what it found and the connections it makes scripted. */
interface FakeNative {
  calls: string[];
  found: unknown[];
  /** How the next connection completes; null connects straight away. */
  connect: (() => Promise<string>) | null;
  handlers: () => {
    open(event: unknown): void;
    message(event: { id: string; data: string }): void;
    close(event: { id: string; reason: string | null }): void;
  };
}

vi.mock('../platform/native', () => {
  let handlers: unknown = null;
  const fake = {
    calls: [] as string[],
    found: [] as unknown[],
    connect: null as (() => Promise<string>) | null,
    handlers: () => handlers,
    onLan: async (given: unknown) => {
      handlers = given;
      return () => undefined;
    },
    lanBrowse: async () => fake.found,
    lanConnect: () => {
      fake.calls.push('connect');
      return fake.connect ? fake.connect() : Promise.resolve('c1');
    },
    lanDisconnect: async (id: string) => {
      fake.calls.push(`disconnect ${id}`);
    },
    lanSend: async () => undefined,
  };
  return { native: fake };
});

const known: KnownPeer[] = [
  {
    deviceId: 'A',
    name: 'Projector',
    fingerprint: 'aa:bb',
    addresses: ['192.168.1.10'],
    port: 47311,
  },
  {
    deviceId: 'B',
    name: 'Streaming',
    fingerprint: 'cc:dd',
    addresses: ['192.168.1.11'],
    port: 47311,
  },
];
const found = (deviceId: string, fingerprint: string, addresses = ['192.168.1.20']) => ({
  deviceId,
  name: deviceId,
  fingerprint,
  addresses,
  port: 47311,
});

describe('choosing the coordinator on the LAN (D14, D19, D20)', () => {
  it('takes the device the relay names, when its fingerprint is the one the server gave', () => {
    const chosen = chooseCoordinator([found('B', 'CC:DD'), found('A', 'AA:BB')], known, 'A');
    expect(chosen).toMatchObject({ deviceId: 'A', address: '192.168.1.20' });
  });

  it('refuses a device announcing a fingerprint nobody vouched for', () => {
    expect(chooseCoordinator([found('A', '11:22')], known, 'A')).toBeNull();
    expect(chooseCoordinator([found('X', 'aa:bb')], known, null)).toBeNull();
  });

  it('accepts any trusted coordinator when the server cannot say who it is', () => {
    expect(chooseCoordinator([found('B', 'cc:dd')], known, null)?.deviceId).toBe('B');
  });

  it('falls back to the address the server knew when mDNS gives none', () => {
    expect(chooseCoordinator([found('A', 'aa:bb', [])], known, 'A')?.address).toBe('192.168.1.10');
  });
});

describe('following the coordinator on the LAN (D14, D21)', () => {
  const fake = native as unknown as FakeNative;
  const flush = () => new Promise((done) => setTimeout(done, 5));
  const ready = (coordinatorId: string): RelayToDesktop => ({
    type: 'ready',
    workspaceId: 'ws',
    deviceId: 'me',
    coordinator: false,
    coordinatorName: coordinatorId,
    coordinatorId,
    peers: [],
  });

  function transport(coordinatorId: () => string | null, enabled: () => boolean = () => true) {
    const log: string[] = [];
    const lan = new LanTransport({
      workspaceId: () => 'ws',
      token: () => 'token',
      hello: () => ({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token: 'token',
        capabilities: { roles: ['coordinator'], appVersion: 'test' },
      }),
      knownPeers: () => known,
      coordinatorId,
      enabled,
      events: {
        open: (kind) => log.push(`open ${kind}`),
        close: (kind) => log.push(`close ${kind}`),
        message: (kind, message) => log.push(`${kind} ${message.type}`),
      },
    });
    return { lan, log };
  }

  it('drops its connection when the server names another coordinator, or this device', async () => {
    fake.calls.length = 0;
    fake.connect = null;
    fake.found = [found('A', 'aa:bb')];
    let coordinator: string | null = 'A';
    const { lan, log } = transport(() => coordinator);
    lan.start();
    await flush();
    expect(fake.calls).toEqual(['connect']);
    fake.handlers().message({ id: 'c1', data: JSON.stringify(ready('A')) });
    expect(log).toEqual(['open lan', 'lan ready']);
    expect(lan.open).toBe(true);

    // The server names the device this one is connected to, then nobody: nothing changes.
    lan.follow('A', false);
    coordinator = null;
    lan.follow(null, false);
    expect(fake.calls).toEqual(['connect']);
    expect(lan.open).toBe(true);

    // Another operator took over on the server: a connection to A would carry A's live
    // state here, and this device's commands to A, against the server's word.
    coordinator = 'B';
    lan.follow('B', false);
    expect(fake.calls).toEqual(['connect', 'disconnect c1']);
    expect(lan.open).toBe(false);
    expect(log.at(-1)).toBe('close lan');
    // Nothing more is heard from the dropped connection.
    fake.handlers().message({ id: 'c1', data: JSON.stringify(ready('A')) });
    expect(log.at(-1)).toBe('close lan');
    lan.close();

    // Becoming coordinator drops the connection too, whoever it is to.
    fake.calls.length = 0;
    const second = transport(() => 'A');
    second.lan.start();
    await flush();
    fake.handlers().message({ id: 'c1', data: JSON.stringify(ready('A')) });
    second.lan.follow('me', true);
    expect(fake.calls).toEqual(['connect', 'disconnect c1']);
    expect(second.log.at(-1)).toBe('close lan');
    second.lan.close();
  });

  it('does not keep a connection that completed as this device became coordinator', async () => {
    fake.calls.length = 0;
    fake.found = [found('A', 'aa:bb')];
    let enabled = true;
    let complete: (id: string) => void = () => undefined;
    fake.connect = () => new Promise((resolve) => (complete = resolve));
    const { lan, log } = transport(
      () => 'A',
      () => enabled,
    );
    lan.start();
    await flush();
    expect(fake.calls).toEqual(['connect']);
    // Carry on here was chosen while the native core was still connecting.
    enabled = false;
    complete('c2');
    await flush();
    expect(fake.calls).toEqual(['connect', 'disconnect c2']);
    expect(log).toEqual([]);
    expect(lan.open).toBe(false);
    lan.close();
    fake.connect = null;
  });
});
