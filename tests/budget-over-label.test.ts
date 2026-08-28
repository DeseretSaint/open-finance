import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const src = readFileSync(join(root, "src/app/(app)/budgets/page.tsx"), "utf8");

describe("budget over-budget status label", () => {
  it("shows an explicit 'Over budget' label parallel to 'Near limit'", () => {
    // the over state must have a dedicated, screen-reader-visible label (not
    // only the colored "$X over" money text the near state already parallels)
    expect(src).toContain('className="mt-1.5 text-xs font-medium text-danger">Over budget —');
    expect(src).toContain("Over budget — {Math.round(b.pct * 100)}% used.");
    // near-limit label still present (parity)
    expect(src).toContain("Near limit — {Math.round(b.pct * 100)}% used.");
  });
});
