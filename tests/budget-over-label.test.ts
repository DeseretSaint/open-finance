import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const src = readFileSync(join(root, "src/app/(app)/budgets/page.tsx"), "utf8");

describe("budget over-budget status label", () => {
  it("shows an explicit 'Over budget' label parallel to 'Near limit'", () => {
    // the over state must have a dedicated, screen-reader-visible label (not
    // only the colored "$X over" money text the near state already parallels)
    expect(src).toContain('className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger">');
    expect(src).toContain("Over budget — {Math.round(b.pct * 100)}% used.");
    // near-limit label still present (parity)
    expect(src).toContain("Near limit — {Math.round(b.pct * 100)}% used.");
  });

  it("encodes budget status with icon + text, not color alone (Q17)", () => {
    // WCAG 1.4.1: status must not rely on color only — add a redundant icon
    // (AlertTriangle/AlertCircle) so over/near are distinguishable without color
    expect(src).toContain("AlertTriangle");
    expect(src).toContain("AlertCircle");
    // icons are decorative (state already in the adjacent text), hidden from AT
    expect(src).toContain('<AlertTriangle size={13} aria-hidden className="shrink-0" />');
    expect(src).toContain('<AlertCircle size={13} aria-hidden className="shrink-0" />');
    // import present
    expect(src).toContain("AlertCircle, AlertTriangle");
  });
});
