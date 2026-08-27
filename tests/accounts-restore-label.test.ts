import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/app/(app)/accounts/page.tsx"), "utf8");

describe("accounts recently-removed restore buttons are labeled", () => {
  it("each Restore button carries a per-account aria-label", () => {
    expect(src).toContain("aria-label={`Restore ${a.official_name ?? a.name}`}");
  });

  it("the aria-label sits on the restore Button (before its onClick)", () => {
    const idx = src.indexOf("aria-label={`Restore ${a.official_name ?? a.name}`}");
    expect(idx).toBeGreaterThan(-1);
    const after = src.slice(idx, idx + 300);
    expect(after).toContain("restore.mutate(a.id)");
  });
});
