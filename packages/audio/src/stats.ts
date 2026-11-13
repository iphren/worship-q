/**
 * The delay figure and path shown while listening (live audio plan §3; task breakdown M3.6):
 * the receive buffer over the last interval plus half the round trip, rounded to 10 ms. It
 * is the network and buffer part of the delay, not the whole mouth-to-ear figure, and is
 * labelled so. **Relayed** when the selected candidate pair goes through a TURN relay on
 * either side, otherwise **Direct**.
 *
 * Nothing depends on how often it is read: the buffer is the change in the engine's own
 * running totals between two readings, whatever their spacing.
 */

/** What one reading of a connection's statistics gives. */
export interface StatsSample {
  /** When it was read, on this device's clock. */
  at: number;
  /** `jitterBufferDelay`: seconds, summed over every sample played. */
  bufferDelay: number | null;
  /** `jitterBufferEmittedCount`: samples played. */
  emitted: number | null;
  /** The selected pair's `currentRoundTripTime`, in seconds. */
  roundTrip: number | null;
  /** The selected pair goes through a relay; null when no pair is selected yet. */
  relayed: boolean | null;
}

type Entry = Record<string, unknown>;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Reads a sample from an `RTCStatsReport`, or anything iterable over its entries. */
export function readStats(report: unknown, at: number): StatsSample {
  const entries: Entry[] = [];
  if (report && typeof (report as { forEach?: unknown }).forEach === 'function') {
    (report as { forEach(fn: (value: Entry) => void): void }).forEach((value) =>
      entries.push(value),
    );
  } else if (Array.isArray(report)) {
    entries.push(...(report as Entry[]));
  }
  const byId = new Map(entries.map((entry) => [String(entry.id), entry]));
  const inbound = entries.find(
    (entry) => entry.type === 'inbound-rtp' && (entry.kind ?? entry.mediaType) === 'audio',
  );
  const transport = entries.find((entry) => entry.type === 'transport');
  const pair =
    (transport && byId.get(String(transport.selectedCandidatePairId))) ??
    entries.find(
      (entry) =>
        entry.type === 'candidate-pair' &&
        entry.state === 'succeeded' &&
        (entry.selected === true || entry.nominated === true),
    );
  let relayed: boolean | null = null;
  if (pair) {
    const local = byId.get(String(pair.localCandidateId));
    const remote = byId.get(String(pair.remoteCandidateId));
    relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
  }
  return {
    at,
    bufferDelay: num(inbound?.jitterBufferDelay),
    emitted: num(inbound?.jitterBufferEmittedCount),
    roundTrip: num(pair?.currentRoundTripTime),
    relayed,
  };
}

/** A figure older than this, with nothing played since, is marked as old. */
export const DELAY_STALE_MS = 5000;

export interface DelayFigure {
  /** Buffer plus half the round trip, rounded to 10 ms; null while the buffer is unknown. */
  delayMs: number | null;
  /** The receive buffer alone, unrounded; for the listener's own check (A18). */
  bufferMs: number | null;
  /** Nothing has been played for a while (silence while waiting): the figure is the last one. */
  stale: boolean;
  path: 'direct' | 'relayed' | null;
}

/** Turns successive readings of one connection into the figure shown. */
export class DelayMeter {
  private session: string | null = null;
  private previous: StatsSample | null = null;
  private last: { delayMs: number | null; bufferMs: number | null; at: number } | null = null;
  private path: DelayFigure['path'] = null;

  /** A new reading; `session` changing starts afresh, so connections are never mixed. */
  push(session: string, sample: StatsSample): DelayFigure {
    if (session !== this.session) {
      this.session = session;
      this.previous = null;
      this.last = null;
      this.path = null;
    }
    if (sample.relayed !== null) this.path = sample.relayed ? 'relayed' : 'direct';
    const previous = this.previous;
    this.previous = sample;
    if (
      previous &&
      previous.bufferDelay !== null &&
      previous.emitted !== null &&
      sample.bufferDelay !== null &&
      sample.emitted !== null &&
      sample.emitted > previous.emitted
    ) {
      const bufferMs =
        ((sample.bufferDelay - previous.bufferDelay) / (sample.emitted - previous.emitted)) * 1000;
      const half = sample.roundTrip !== null ? (sample.roundTrip * 1000) / 2 : 0;
      this.last = { delayMs: Math.round((bufferMs + half) / 10) * 10, bufferMs, at: sample.at };
    }
    if (!this.last) return { delayMs: null, bufferMs: null, stale: false, path: this.path };
    return {
      delayMs: this.last.delayMs,
      bufferMs: this.last.at === sample.at ? this.last.bufferMs : null,
      stale: sample.at - this.last.at > DELAY_STALE_MS,
      path: this.path,
    };
  }

  reset(): void {
    this.session = null;
    this.previous = null;
    this.last = null;
    this.path = null;
  }
}
