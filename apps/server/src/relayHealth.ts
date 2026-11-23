/**
 * Whether the live audio relay answers. `WORSHIP_Q_TURN_URL` only says that one was set up:
 * with coturn stopped, devices are still handed its address, and a listener whose network
 * needs it cannot connect. So the server asks it, with a STUN Binding request, needing no
 * credential, every half minute, and says so in its log, `info` and the admin page.
 *
 * It asks at the relay's own listening address when that is known, so a provider that does
 * not route a host back to its own public address raises no false alarm. So this shows that
 * coturn is running; it does not show that the firewall lets the internet reach it.
 */
import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import type { IceConfig } from './ice';

export const RELAY_CHECK_EVERY_MS = 30_000;
/** One try waits this long for an answer. */
export const RELAY_TRY_MS = 1000;
/** UDP can lose a packet: the relay counts as down only after this many tries. */
export const RELAY_TRIES = 3;

const STUN_MAGIC = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const BINDING_ERROR = 0x0111;

export type RelayStatus = 'checking' | 'ok' | 'down';

export interface RelayTarget {
  host: string;
  port: number;
}

/** A STUN Binding request, with its transaction id. */
export function bindingRequest(id: Buffer = randomBytes(12)): Buffer {
  const message = Buffer.alloc(20);
  message.writeUInt16BE(BINDING_REQUEST, 0);
  message.writeUInt16BE(0, 2);
  message.writeUInt32BE(STUN_MAGIC, 4);
  id.copy(message, 8, 0, 12);
  return message;
}

/** Whether `reply` answers `request`; an error answer still shows the relay is there. */
export function answersBinding(request: Buffer, reply: Buffer): boolean {
  if (reply.length < 20) return false;
  const type = reply.readUInt16BE(0);
  if (type !== BINDING_SUCCESS && type !== BINDING_ERROR) return false;
  return (
    reply.readUInt32BE(4) === STUN_MAGIC && reply.subarray(8, 20).equals(request.subarray(8, 20))
  );
}

/**
 * Where to ask: the first plain `turn:` address, at `listenIp` when given. A `turns:` address
 * is TLS, which a UDP request cannot check, so a relay with only those is not checked.
 */
export function relayTarget(ice: IceConfig, listenIp?: string): RelayTarget | null {
  for (const url of ice.turn?.urls ?? []) {
    const match = /^turn:(\[[^\]]+\]|[^:?]+)(?::(\d+))?/.exec(url);
    if (!match) continue;
    const host = match[1]!.replace(/^\[|\]$/g, '');
    return { host: listenIp?.trim() || host, port: Number(match[2] ?? 3478) };
  }
  return null;
}

/** One STUN request; true when the relay answered within `timeoutMs`. Never rejects. */
export function askRelay(target: RelayTarget, timeoutMs: number = RELAY_TRY_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createSocket(target.host.includes(':') ? 'udp6' : 'udp4');
    const request = bindingRequest();
    let done = false;
    const finish = (answer: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve(answer);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('error', () => finish(false));
    socket.on('message', (reply) => {
      if (answersBinding(request, reply)) finish(true);
    });
    socket.send(request, target.port, target.host, (error) => {
      if (error) finish(false);
    });
  });
}

export class RelayHealth {
  private status_: RelayStatus = 'checking';
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ask: () => Promise<boolean>,
    private readonly log: { info(message: string): void; warn(message: string): void } = console,
    private readonly tries: number = RELAY_TRIES,
  ) {}

  get status(): RelayStatus {
    return this.status_;
  }

  /** Asks now, then every half minute. Resolves once the first answer is known. */
  async start(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => void this.check(), RELAY_CHECK_EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round of tries; the log says only when the answer changes. */
  async check(): Promise<void> {
    let answered = false;
    for (let attempt = 0; attempt < this.tries && !answered; attempt++) {
      answered = await this.ask().catch(() => false);
    }
    const next: RelayStatus = answered ? 'ok' : 'down';
    if (next === this.status_) return;
    this.status_ = next;
    if (next === 'ok') this.log.info('Live audio relay: answering');
    else {
      this.log.warn(
        'Live audio relay: NOT answering. Listeners whose network needs it cannot connect. Is coturn running?',
      );
    }
  }
}
