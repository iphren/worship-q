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

type Ready = Extract<RelayToDesktop, { type: 'ready' }>;

function ready(coordinatorId: string): Ready {
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

/** The server's word that nobody coordinates. */
function nobody(): Ready {
  return { ...ready('x'), coordinatorId: null, coordinatorName: null };
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

describe('whose word on roles stands (D14, D21)', () => {
  it('hears the server, not the LAN room, while the server names a coordinator', () => {
    const { transports, log } = setup();
    transports.opened('relay');
    transports.received('relay', ready('c1'));
    transports.opened('lan');
    // Switching repeats the server's word, so the link asks for the snapshot over the LAN.
    expect(log).toEqual([
      'open relay',
      'relay ready c1',
      'close relay',
      'open lan',
      'relay ready c1',
    ]);
    log.length = 0;
    transports.received('lan', ready('c1'));
    // The room says ready again whenever a device joins it; its word never reaches the link.
    transports.received('lan', ready('lan-host'));
    expect(log).toEqual([]);
    transports.received('relay', ready('c2'));
    expect(log).toEqual(['relay ready c2']);
  });

  it('hears the LAN room while the server names nobody', () => {
    const { transports, log } = setup();
    transports.opened('relay');
    transports.received('relay', nobody());
    transports.opened('lan');
    transports.received('lan', ready('c1'));
    expect(log).toEqual([
      'open relay',
      'relay ready null',
      'close relay',
      'open lan',
      'relay ready null',
      'lan ready c1',
    ]);
    log.length = 0;
    // The server still sees nobody: this device keeps following the room's coordinator.
    transports.received('relay', nobody());
    expect(log).toEqual([]);
    // Another operator took over on the server: its word stands again.
    transports.received('relay', ready('c2'));
    expect(log).toEqual(['relay ready c2']);
  });

  it('lets the LAN room’s word stand once the server is gone', () => {
    const { transports, log } = setup();
    transports.opened('relay');
    transports.received('relay', ready('c1'));
    transports.opened('lan');
    transports.received('lan', ready('c1'));
    log.length = 0;
    transports.closed('relay');
    expect(log).toEqual(['lan ready c1']);
  });
});
