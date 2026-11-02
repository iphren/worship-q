import type { RelayToDesktop } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import { TransportSwitch, type Transport, type TransportKind } from './transport';

function fake(kind: TransportKind): Transport {
  return {
    kind,
    open: true,
    start: () => undefined,
    send: () => undefined,
    close: () => undefined,
  };
}

function ready(coordinatorId: string): RelayToDesktop {
  return {
    type: 'ready',
    workspaceId: 'w',
    deviceId: 'me',
    coordinator: false,
    coordinatorName: 'Projector',
    coordinatorId,
    peers: [],
  };
}

function setup() {
  const log: string[] = [];
  const events = {
    open: (kind: TransportKind) => log.push(`open ${kind}`),
    close: (kind: TransportKind) => log.push(`close ${kind}`),
    message: (kind: TransportKind, message: RelayToDesktop) =>
      log.push(
        `${kind} ${message.type}${message.type === 'ready' ? ` ${message.coordinatorId}` : ''}`,
      ),
  };
  const transports = new TransportSwitch([fake('relay'), fake('lan')], events);
  return { transports, log };
}

describe('choosing a transport (D21)', () => {
  it('names the coordinator again when falling back to the relay after the LAN drops', () => {
    const { transports, log } = setup();
    transports.opened('relay');
    transports.received('relay', ready('c1'));
    transports.opened('lan');
    transports.received('lan', ready('c1'));
    log.length = 0;

    transports.closed('lan');
    // The relay's ready came long ago; without it again, the link would know no coordinator.
    expect(log).toEqual(['close lan', 'open relay', 'relay ready c1']);
  });

  it('does not repeat a ready that arrives with the connection itself', () => {
    const { transports, log } = setup();
    transports.opened('relay');
    transports.received('relay', ready('c1'));
    expect(log).toEqual(['open relay', 'relay ready c1']);
  });

  it('forgets a closed transport’s word on roles', () => {
    const { transports, log } = setup();
    transports.opened('relay');
    transports.received('relay', ready('c1'));
    transports.closed('relay');
    transports.opened('lan');
    transports.opened('relay');
    log.length = 0;
    transports.closed('lan');
    expect(log).toEqual(['close lan', 'open relay']);
  });
});
