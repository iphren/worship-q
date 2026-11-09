/**
 * API.Bible's usage reporting (B25, spike P0.1): every API.Bible passage the server serves,
 * and every stored token a coordinator sends when it presents a saved item, reported with a
 * GET to `fums.api.bible/f3`. Batched, retried in the background, never blocking an answer.
 */
import type { Fetch } from './providers/types';

export const FUMS_URL = 'https://fums.api.bible/f3';
export const FUMS_EVERY_MS = 30_000;
/** Tokens per request, keeping the address short. */
export const FUMS_BATCH = 20;
export const FUMS_ATTEMPTS = 5;

interface Pending {
  tokens: string[];
  device: string;
  session: string;
  attempts: number;
}

/** A random identifier as API.Bible expects: letters and digits, nothing personal. */
const clean = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

export class Fums {
  private queue: Pending[] = [];
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly fetch: Fetch = globalThis.fetch) {}

  /** Queues tokens shown on one device in one session. */
  report(tokens: readonly string[], device: string, session: string): void {
    const kept = tokens.filter((token) => typeof token === 'string' && token.length > 0);
    if (kept.length === 0) return;
    const d = clean(device) || 'unknown';
    const s = clean(session) || 'unknown';
    const same = this.queue.find((p) => p.device === d && p.session === s && p.attempts === 0);
    if (same) same.tokens.push(...kept);
    else this.queue.push({ tokens: [...kept], device: d, session: s, attempts: 0 });
  }

  get pending(): number {
    return this.queue.reduce((sum, p) => sum + p.tokens.length, 0);
  }

  /** Sends what is queued; a failed request is kept for the next flush, a few times. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.send().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async send(): Promise<void> {
    const batch = this.queue;
    this.queue = [];
    for (const pending of batch) {
      for (let i = 0; i < pending.tokens.length; i += FUMS_BATCH) {
        const tokens = pending.tokens.slice(i, i + FUMS_BATCH);
        const query = [
          ...tokens.map((t) => `t=${encodeURIComponent(t)}`),
          `dId=${encodeURIComponent(pending.device)}`,
          `sId=${encodeURIComponent(pending.session)}`,
        ].join('&');
        let ok: boolean;
        try {
          const response = await this.fetch(`${FUMS_URL}?${query}`, {
            signal: AbortSignal.timeout(10_000),
          });
          ok = response.ok;
        } catch {
          ok = false;
        }
        if (!ok && pending.attempts + 1 < FUMS_ATTEMPTS) {
          this.queue.push({ ...pending, tokens, attempts: pending.attempts + 1 });
        }
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), FUMS_EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
