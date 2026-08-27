import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("accounts page fetch error handling", () => {
  const src = read("src/app/(app)/accounts/page.tsx");

  it("collects failed queries gated on no-data so rendered accounts are never blanked", () => {
    // the accounts / deleted queries are covered by the failure sweep
    expect(src).toContain("[accountsQuery, deleted].filter(");
    // gated on isError && !data (background refetch errors don't blank accounts)
    expect(src).toContain("q.isError && !q.data");
  });

  it("renders an alert banner with a retry button wired to refetch", () => {
    expect(src).toContain('role="alert"');
    expect(src).toContain("Couldn&apos;t load your accounts");
    expect(src).toContain("onClick={retry}");
    expect(src).toContain("disabled={isRetrying}");
    expect(src).toContain('{isRetrying ? "Retrying…" : "Try again"}');
    // retry re-fires every failed query
    expect(src).toContain("failedQueries.forEach((q) => q.refetch())");
  });
});
