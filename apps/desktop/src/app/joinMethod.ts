import type { ServerInfo } from '@worship-q/protocol';

/**
 * How a new computer joins a church instance (decisions D29, D30): by an administrator's
 * approval when the instance can give one, else with a connection code as before.
 *
 * Pairing needs an instance that offers it, with sign-in configured so an administrator can
 * approve, and at least one administrator, which the instance shows by turning codes off.
 * An instance that could not be asked is joined with a code.
 */
export function joinMethod(info: ServerInfo | null): 'pairing' | 'code' {
  return info?.pairing && info.admin && !info.codes ? 'pairing' : 'code';
}

/** Whether the operator may switch from a code to asking for approval. */
export function canPair(info: ServerInfo | null): boolean {
  return !!info?.pairing && !!info.admin;
}
