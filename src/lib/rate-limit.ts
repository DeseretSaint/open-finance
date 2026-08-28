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

/** Hard cap on tracked keys per limiter instance. When exceeded we sweep
 *  expired buckets; this bounds memory for a long-running server (a key is
 *  otherwise only reclaimed when check() is re-invoked for that exact key). */
const MAX_BUCKETS = 1000;

export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  function check(key: string): RateLimitResult {
    if (buckets.size > MAX_BUCKETS) {
      prune();
      // `prune()` only drops expired buckets. Under a high-cardinality flood
      // (many distinct client IPs each within their window, e.g. a distributed
      // login brute-force) no bucket may be expired, so pruning frees nothing.
      // Without an overflow eviction the Map would then grow unbounded per
      // attacker IP — a memory-exhaustion DoS. When prune isn't enough, evict
      // the oldest-inserted buckets (LRU) to keep the footprint hard-capped.
      if (buckets.size > MAX_BUCKETS) {
        let overflow = buckets.size - MAX_BUCKETS;
        for (const k of buckets.keys()) {
          if (overflow <= 0) break;
          buckets.delete(k);
          overflow--;
        }
      }
    }
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
