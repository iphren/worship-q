/** The clock and timers the audio logic runs on, so tests can drive time themselves. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A connection's state, as `RTCPeerConnection.connectionState` reports it. */
export type PeerState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

/** A random session id. */
export function newSessionId(): string {
  return globalThis.crypto.randomUUID();
}
