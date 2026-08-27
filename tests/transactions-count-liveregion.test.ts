import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Transactions result-count live region: the "N transaction(s)" count next to
 * the filter bar is the only on-screen signal that a filter/add/delete changed
 * the visible set. Without an aria-live region, screen-reader users only hear
 * it if they happen to navigate to that text — so a filter change is silent.
 * Marking the count role="status" (aria-live=polite) announces it whenever the
 * total changes, matching the run-73 live-region pattern. Source-level guard
 * (the page is a client component; can't render in node without a DOM).
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/transactions/page.tsx"), "utf8");

describe("transactions result-count live region", () => {
  it("announces the transaction count via an aria-live status region", () => {
    expect(src).toContain('role="status" aria-live="polite"');
    // The status region wraps the live total count string.
    expect(src).toMatch(/role="status" aria-live="polite" className="text-sm text-text-muted">\{data \? `\$/);
  });
});
