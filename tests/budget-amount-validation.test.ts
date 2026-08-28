import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Create-budget amount validation UX: a non-numeric / zero / negative amount
 * should be caught inline (with an aria-visible alert) and block submit, rather
 * than round-tripping to the server's generic 400. The page is a client
 * component (can't render in node without a DOM), so these are source-level
 * guards (matches agent-manual-editor / reports-trend-chart pattern).
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/budgets/page.tsx"), "utf8");

describe("budget create-amount validation UX", () => {
  it("computes an inline error for empty/invalid/zero/negative amounts", () => {
    expect(src).toContain("Enter an amount greater than 0");
    // guards: non-finite (NaN from letters) or <= 0
    expect(src).toMatch(/!Number\.isFinite\(amountNum\) \|\| amountNum <= 0/);
  });

  it("marks the amount input invalid only after blur (touched), not on every keystroke", () => {
    expect(src).toContain("aria-invalid={amountTouched && !!amountError}");
  });

  it("surfaces the error as an accessible alert gated by touched", () => {
    expect(src).toContain("{amountTouched && amountError && (");
    expect(src).toContain('role="alert" className="mt-1 text-xs text-danger">{amountError}');
  });

  it("blocks submit while the amount is invalid", () => {
    // disabled prop must include the invalid-amount guard
    expect(src).toContain("disabled={create.isPending || update.isPending || !name || !amount || !!amountError}");
  });
});
