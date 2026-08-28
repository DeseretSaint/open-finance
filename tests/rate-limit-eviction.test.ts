import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Memory-bounding of the in-memory sliding-window limiter. The limiter caps
 * tracked keys at MAX_BUCKETS (1000). Under a high-cardinality flood (distinct
 * client IPs, none expired within the window) the `prune()` step frees nothing,
 * so without overflow eviction the Map would grow per attacker IP — a
 * memory-exhaustion DoS. These tests lock the LRU overflow eviction so the
 * footprint stays hard-capped and evicted keys reset to a fresh bucket.
 */

const WINDOW = 3_600_000; // 1h — nothing expires during the test

describe("rate limiter memory bounding (LRU overflow eviction)", () => {
  it("evicts the oldest-inserted bucket when flooded with distinct keys", () => {
    const lim = createRateLimiter({ windowMs: WINDOW, max: 1 });
    // First key is blocked after its second hit.
    expect(lim.check("k0").ok).toBe(true);
    expect(lim.check("k0").ok).toBe(false); // now count 2 > max 1

    // Flood 1500 further distinct keys; each is within window so prune() frees
    // nothing — overflow eviction must run to keep the Map <= MAX_BUCKETS.
    for (let i = 1; i <= 1500; i++) {
      expect(lim.check(`k${i}`).ok).toBe(true);
    }

    // The oldest key (k0) was evicted (LRU) → it now behaves like a fresh
    // bucket again (ok). Without eviction it would still be blocked.
    expect(lim.check("k0").ok).toBe(true);

    // A recently-added key is retained (still blocked, count 2 within window).
    expect(lim.check("k1500").ok).toBe(false);
  });

  it("does not evict while under the cap", () => {
    const lim = createRateLimiter({ windowMs: WINDOW, max: 5 });
    for (let i = 0; i < 500; i++) expect(lim.check(`u${i}`).ok).toBe(true);
    // Well under MAX_BUCKETS (1000): oldest retained, still in its window.
    expect(lim.check("u0").ok).toBe(true);
  });
});
