import { describe, expect, it } from 'vitest';
import { chooseCoordinator, type KnownPeer } from './lan';

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
