import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("agents page fetch error handling", () => {
  const src = read("src/app/(app)/agents/page.tsx");

  it("collects failed queries gated on no-data so rendered lists are never blanked", () => {
    // all 5 agents-page queries are covered by the failure sweep
    expect(src).toContain("[agents, requests, audit, accounts, manual].filter(");
    // gated on isError && !data (background refetch errors don't blank rendered data)
    expect(src).toContain("q.isError && !q.data");
  });

  it("renders an alert banner with a retry button wired to refetch", () => {
    expect(src).toContain("Couldn&apos;t load");
    expect(src).toContain("onClick={retryFailed}");
    expect(src).toContain("disabled={retrying}");
    expect(src).toContain('{retrying ? "Retrying…" : "Try again"}');
    // retry re-fires every failed query
    expect(src).toContain("failedQueries.forEach((q) => q.refetch())");
  });

  it("mounts the banner in BOTH render branches (setup walkthrough + connected view)", () => {
    // one JSX element definition + two mounts (no-agent walkthrough + agent-connected)
    const mounts = src.match(/\{failedBanner\}/g) ?? [];
    expect(mounts.length).toBe(2);
  });
});
