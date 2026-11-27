import type { RemoteDevice } from '@worship-q/protocol';
import type { PhoneSocket } from '@worship-q/phone';

/** One open way to the workspace, not yet carrying anything. */
export interface Candidate {
  readonly via: 'lan' | 'relay';
  send(data: string): void;
  close(): void;
  onmessage: ((data: string) => void) | null;
  onclose: ((reason?: string) => void) | null;
}

/** How the app opens each way; the native core and the web view in the app, fakes in tests. */
export interface Ways {
  /** Opens the church or public server's relay; resolves once open. */
  relay(url: string): Promise<Candidate>;
  /** Opens a pinned connection to a device on the venue network; resolves once open. */
  lan(address: string, port: number, fingerprint: string): Promise<Candidate>;
  /** Devices of the workspace advertising on the venue network. */
  browse(
    workspace: string,
    seconds: number,
  ): Promise<{ fingerprint: string; addresses: string[]; port: number }[]>;
}

export interface Target {
  /** The relay's address, or null for a workspace reached only on the venue network. */
  relayUrl: string | null;
  /** What the devices advertise on the venue network: the workspace's server identifier. */
  workspace: string;
  /** The only devices this phone trusts on the venue network (N30). */
  trusted: RemoteDevice[];
}

export interface Timing {
  /** How long the relay waits for the venue network once it is open. */
  graceMs: number;
  /** How long to look for the devices with mDNS. */
  browseSeconds: number;
}

const TIMING: Timing = { graceMs: 2500, browseSeconds: 2 };

/**
 * One connection attempt for the app's `PhoneLink` (native apps plan M2.7): the venue
 * network and the relay are tried together, and the venue network is kept if it answers
 * within the grace period, so a phone in the hall works with no internet and does not wait
 * for the internet when it has some. Nothing is said on any connection until one is chosen,
 * so a first scan never shows up as two requests.
 *
 * On the venue network only trusted fingerprints are used: the invitation's and the
 * coordinator's list (N30). mDNS only adds addresses for them, never a device.
 */
export function appSocket(target: Target, ways: Ways, timing: Timing = TIMING): PhoneSocket {
  const trusted = new Map(target.trusted.map((d) => [d.fingerprint.toUpperCase(), d]));
  const opened: Candidate[] = [];
  const tried = new Set<string>();
  let chosen: Candidate | null = null;
  let relayReady: Candidate | null = null;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let lanPending = 0;
  let browsing = true;
  let relayPending = target.relayUrl !== null;
  let finished = false;

  const socket: PhoneSocket = {
    get open() {
      return chosen !== null && !finished;
    },
    get via() {
      return chosen?.via ?? 'relay';
    },
    send: (data) => chosen?.send(data),
    close: () => end(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };

  function end(reason?: string): void {
    if (finished) return;
    finished = true;
    clearTimeout(grace);
    for (const candidate of opened) candidate.close();
    socket.onclose?.(reason ? { reason } : {});
  }

  function choose(candidate: Candidate): void {
    if (chosen || finished) return;
    chosen = candidate;
    clearTimeout(grace);
    for (const other of opened) if (other !== candidate) other.close();
    candidate.onmessage = (data) => socket.onmessage?.(data);
    candidate.onclose = (reason) => end(reason ?? 'closed');
    socket.onopen?.();
  }

  /** Nothing is left to wait for: the relay if it opened, else give up for now. */
  function settle(): void {
    if (chosen || finished || lanPending > 0 || browsing) return;
    if (relayReady) return choose(relayReady);
    if (!relayPending) end('unreachable');
  }

  function arrived(candidate: Candidate): void {
    if (chosen || finished) return candidate.close();
    opened.push(candidate);
    // Until chosen, a closing candidate only drops out.
    candidate.onclose = () => {
      const at = opened.indexOf(candidate);
      if (at >= 0) opened.splice(at, 1);
      if (candidate === relayReady) relayReady = null;
      settle();
    };
  }

  function tryLan(address: string, port: number, fingerprint: string): void {
    const key = `${address}|${port}|${fingerprint.toUpperCase()}`;
    if (tried.has(key) || chosen || finished) return;
    tried.add(key);
    lanPending++;
    ways.lan(address, port, fingerprint).then(
      (candidate) => {
        lanPending--;
        arrived(candidate);
        if (!finished) choose(candidate);
      },
      () => {
        lanPending--;
        settle();
      },
    );
  }

  for (const device of target.trusted) {
    for (const address of device.addresses) tryLan(address, device.port, device.fingerprint);
  }

  if (target.trusted.length === 0) browsing = false;
  else {
    ways.browse(target.workspace, timing.browseSeconds).then(
      (found) => {
        for (const device of found) {
          const known = trusted.get(device.fingerprint.toUpperCase());
          if (!known) continue;
          for (const address of device.addresses) tryLan(address, device.port, known.fingerprint);
        }
        browsing = false;
        settle();
      },
      () => {
        browsing = false;
        settle();
      },
    );
  }

  if (target.relayUrl) {
    ways.relay(target.relayUrl).then(
      (candidate) => {
        relayPending = false;
        arrived(candidate);
        if (finished || chosen) return;
        relayReady = candidate;
        grace = setTimeout(() => relayReady && choose(relayReady), timing.graceMs);
        settle();
      },
      () => {
        relayPending = false;
        settle();
      },
    );
  }

  queueMicrotask(settle);
  return socket;
}
