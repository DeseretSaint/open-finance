import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Add-transaction amount validation UX: a non-numeric / zero amount should be
 * caught inline (with an aria-visible alert) and block submit, rather than
 * round-tripping to the server's generic 400. Also locks the parseFloat→Number
 * fix: parseFloat("1,000") === 1 would silently record $1.00; Number("1,000")
 * is NaN → rejected. The page is a client component (can't render in node
 * without a DOM), so these are source-level guards (matches the
 * budget-amount-validation / agent-manual-editor pattern).
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/transactions/page.tsx"), "utf8");

describe("add-transaction amount validation UX", () => {
  it("computes an inline error for non-finite and zero amounts", () => {
    expect(src).toContain("Enter a valid amount.");
    expect(src).toContain("Amount cannot be zero.");
    expect(src).toMatch(/!Number\.isFinite\(addAmountNum\) \|\| addAmountNum === 0/);
  });

  it("uses Number() — not parseFloat — so '1,000' is rejected, not truncated to $1", () => {
    expect(src).toContain("const addAmountNum = Number(addAmount);");
    expect(src).toContain("Math.round(addAmountNum * 100)");
    expect(src).not.toContain("parseFloat(addAmount)");
  });

  it("marks the amount input invalid when there is an error", () => {
    expect(src).toContain("aria-invalid={!!addAmountError}");
  });

  it("surfaces the error as an accessible alert", () => {
    expect(src).toContain('role="alert" className="mt-1 text-xs text-danger">{addAmountError}');
  });

  it("blocks submit while the amount is invalid", () => {
    expect(src).toContain(
      "disabled={add.isPending || !addName || !addAmount || !addAccount || !!addAmountError}"
    );
  });
});
