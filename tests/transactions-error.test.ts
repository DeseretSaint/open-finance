import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("transactions page fetch error handling", () => {
  const src = read("src/app/(app)/transactions/page.tsx");

  it("collects failed queries gated on no-data so rendered rows are never blanked", () => {
    // the transactions / accounts / categories queries are covered by the failure sweep
    expect(src).toContain(
      "[txQuery, accounts, categories].filter("
    );
    // gated on isError && !data (background refetch errors don't blank rows)
    expect(src).toContain("q.isError && !q.data");
  });

  it("renders an alert banner with a retry button wired to refetch", () => {
    expect(src).toContain('role="alert"');
    expect(src).toContain("Couldn&apos;t load your transactions");
    expect(src).toContain("onClick={retry}");
    expect(src).toContain("disabled={isRetrying}");
    expect(src).toContain('{isRetrying ? "Retrying…" : "Try again"}');
    // retry re-fires every failed query
    expect(src).toContain("failedQueries.forEach((q) => q.refetch())");
  });
});
