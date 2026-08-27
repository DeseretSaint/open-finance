import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("reports page fetch error handling", () => {
  const src = read("src/app/(app)/reports/page.tsx");

  it("collects failed queries gated on no-data so rendered charts are never blanked", () => {
    // all 6 report queries are covered by the failure sweep
    expect(src).toContain(
      "[byCategory, monthSummary, cashflow, netWorth, netWorthTrend, projection].filter("
    );
    // gated on isError && !data (background refetch errors don't blank charts)
    expect(src).toContain("q.isError && !q.data");
  });

  it("renders an alert banner with a retry button wired to refetch", () => {
    expect(src).toContain('role="alert"');
    expect(src).toContain("Couldn&apos;t load");
    expect(src).toContain("onClick={retryFailed}");
    expect(src).toContain("disabled={retrying}");
    expect(src).toContain('{retrying ? "Retrying…" : "Try again"}');
    // retry re-fires every failed query
    expect(src).toContain("failedQueries.forEach((q) => q.refetch())");
  });
});
