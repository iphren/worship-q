/**
 * The public server's rate limits (public server task breakdown M5.1, S3): fixed windows
 * counted in memory, per key, and forgotten when their window ends, so the server keeps no
 * record of who used it once the window is over.
 */

export class RateLimiter {
  /** Each key's count and when its window ends, in ms. */
  private readonly windows = new Map<string, { count: number; endsAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Null when one more use under `key` is allowed, else the seconds until it is. */
  peek(key: string): number | null {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || window.endsAt <= now) return null;
    return window.count >= this.limit ? Math.max(1, Math.ceil((window.endsAt - now) / 1000)) : null;
  }

  /** Counts one use under `key` when allowed; answers as `peek` did before counting. */
  take(key: string): number | null {
    const refused = this.peek(key);
    if (refused !== null) return refused;
    const now = this.now();
    this.forgetEnded(now);
    const window = this.windows.get(key);
    if (window) window.count++;
    else this.windows.set(key, { count: 1, endsAt: now + this.windowMs });
    return null;
  }

  /** How many keys are remembered; for tests of forgetting. */
  get size(): number {
    this.forgetEnded(this.now());
    return this.windows.size;
  }

  private forgetEnded(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.endsAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * One use counted against several limits at once, such as a copy of the app and the IP
 * address behind it. All are checked before any is counted, so a refusal by one costs the
 * others nothing. A null key is not counted. Answers as `RateLimiter.take`.
 */
export function takeAll(checks: readonly { limiter: RateLimiter; key: string | null }[]) {
  const active = checks.filter((c): c is { limiter: RateLimiter; key: string } => !!c.key);
  for (const { limiter, key } of active) {
    const refused = limiter.peek(key);
    if (refused !== null) return refused;
  }
  for (const { limiter, key } of active) limiter.take(key);
  return null;
}
