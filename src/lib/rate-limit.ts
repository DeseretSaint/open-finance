/** In-memory sliding-window rate limiter. Fine for a single-process
 *  self-hosted app (documented: resets on restart). */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  function check(key: string): RateLimitResult {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return { ok: true, retryAfterMs: 0 };
    }
    b.count += 1;
    if (b.count > opts.max) {
      return { ok: false, retryAfterMs: b.resetAt - now };
    }
    return { ok: true, retryAfterMs: 0 };
  }

  function reset(key?: string): void {
    if (key) buckets.delete(key);
    else buckets.clear();
  }

  // Bound memory: drop expired buckets occasionally.
  function prune(): void {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  return { check, reset, prune };
}
