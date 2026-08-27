import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Update-banner + agent request buttons must disable while their mutation is in flight so a
 * quick double-tap can't fire two self-update / permission-resolve requests. Found run-148:
 * update-banner's `decide` mutation (the /api/updates/decide self-update trigger) had four
 * buttons with no `disabled={decide.isPending}` — "Update now" especially could double-POST the
 * update trigger. Agents' Grant/Deny buttons for a permission request had no busy guard either.
 */

describe("update banner + agent request buttons disable while pending", () => {
  it("every decide.* button in the update banner is guarded by disabled={decide.isPending}", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/components/update-banner.tsx"), "utf8");
    const mutateCalls = (src.match(/decide\.mutate\(/g) ?? []).length;
    const guards = (src.match(/disabled=\{decide\.isPending\}/g) ?? []).length;
    expect(mutateCalls).toBeGreaterThan(0);
    expect(guards).toBe(mutateCalls);
  });

  it("every agent permission Grant/Deny button is guarded by a row-scoped busy state", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/agents/page.tsx"), "utf8");
    const mutateCalls = (src.match(/resolveRequest\.mutate\(/g) ?? []).length;
    const guards = (
      src.match(/disabled=\{resolveRequest\.isPending && resolveRequest\.variables\?\.id === r\.id\}/g) ??
      []
    ).length;
    expect(mutateCalls).toBeGreaterThan(0);
    expect(guards).toBe(mutateCalls);
  });
});
