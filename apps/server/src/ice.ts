/**
 * The ICE servers for live audio (live audio plan A10; task breakdown M5.1): a public STUN
 * server by default, which the administrator can replace or empty with `WORSHIP_Q_STUN`,
 * and, when `WORSHIP_Q_TURN_URL` and `WORSHIP_Q_TURN_SECRET` are both set, the church's
 * coturn relay with a credential valid ten minutes (coturn's `use-auth-secret`: the user
 * name is the expiry time in seconds, the password its HMAC-SHA1 with the secret, base64).
 *
 * coturn checks the expiry only when an allocation is made (L13), so ten minutes is enough
 * for a connection that lasts a service; a device asks again before each new connection.
 * The secret never leaves this module: not in an answer, `info`, or a log line.
 */
import { createHmac } from 'node:crypto';
import type { IceServer } from '@worship-q/protocol';

export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';
/** How long a relay credential is valid. */
export const TURN_CREDENTIAL_SECONDS = 10 * 60;

export interface IceConfig {
  stun: string[];
  turn: { urls: string[]; secret: string } | null;
}

/** Thrown at start for a setting that cannot be used, naming it. */
export class IceConfigError extends Error {}

/**
 * Reads the settings. A STUN value that is not a `stun:` address stops the server with a
 * message naming the setting; a relay with only one of its two settings is left out, with a
 * warning.
 */
export function iceConfigFromEnv(
  env: Record<string, string | undefined>,
  warn: (message: string) => void = (message) => console.warn(message),
): IceConfig {
  const raw = env.WORSHIP_Q_STUN;
  const stun =
    raw === undefined
      ? [DEFAULT_STUN]
      : raw
          .split(',')
          .map((url) => url.trim())
          .filter((url) => url !== '');
  for (const url of stun) {
    if (!/^stuns?:/.test(url)) {
      throw new IceConfigError(
        `WORSHIP_Q_STUN must list stun: addresses, comma-separated; “${url}” is not one.`,
      );
    }
  }
  const turnUrl = env.WORSHIP_Q_TURN_URL?.trim() ?? '';
  const secret = env.WORSHIP_Q_TURN_SECRET?.trim() ?? '';
  let turn: IceConfig['turn'] = null;
  if (turnUrl && secret) {
    const urls = turnUrl
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url !== '');
    for (const url of urls) {
      if (!/^turns?:/.test(url)) {
        throw new IceConfigError(
          `WORSHIP_Q_TURN_URL must list turn: addresses, comma-separated; “${url}” is not one.`,
        );
      }
    }
    turn = { urls, secret };
  } else if (turnUrl || secret) {
    warn(
      turnUrl
        ? 'WORSHIP_Q_TURN_URL is set without WORSHIP_Q_TURN_SECRET: no relay is offered.'
        : 'WORSHIP_Q_TURN_SECRET is set without WORSHIP_Q_TURN_URL: no relay is offered.',
    );
  }
  return { stun, turn };
}

/** A relay credential valid until `nowMs` plus ten minutes. */
export function turnCredential(
  secret: string,
  nowMs: number,
): { username: string; credential: string } {
  const username = String(Math.floor(nowMs / 1000) + TURN_CREDENTIAL_SECONDS);
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/** The list a device or an administrator's browser gets, made fresh each time. */
export function iceServers(config: IceConfig, nowMs: number): IceServer[] {
  const servers: IceServer[] = config.stun.map((urls) => ({ urls }));
  if (config.turn) {
    servers.push({ urls: config.turn.urls, ...turnCredential(config.turn.secret, nowMs) });
  }
  return servers;
}
