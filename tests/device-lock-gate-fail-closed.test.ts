import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src/components/device-lock-gate.tsx"),
  "utf8",
);

describe("device-lock gate fails CLOSED on fetch error (run-170 SLOT-B finding)", () => {
  it("no longer renders children when the lock query has no data", () => {
    // The old fail-open guard: `!isMobile || lock.isLoading || !lock.data`
    // returned children — an errored fetch (isError → no data) unlocked the app.
    expect(src).not.toMatch(/!isMobile\s*\|\|\s*lock\.isLoading\s*\|\|\s*!lock\.data/);
  });

  it("gates on lock.isError before rendering children", () => {
    expect(src).toMatch(/lock\.isError\s*\|\|\s*!lock\.data/);
    // The error branch must come BEFORE the configured/locked branches.
    const errIdx = src.indexOf("lock.isError");
    const configuredIdx = src.indexOf("!lock.data.configured");
    expect(errIdx).toBeGreaterThan(-1);
    expect(configuredIdx).toBeGreaterThan(errIdx);
  });

  it("shows a retry wired to lock.refetch() instead of the app UI", () => {
    expect(src).toContain("Device lock unavailable");
    expect(src).toMatch(/onClick=\{\(\)\s*=>\s*lock\.refetch\(\)\}/);
    expect(src).toContain("Retrying…");
  });
});
