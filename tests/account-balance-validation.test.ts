import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Manual add-account balance validation UX: a non-numeric balance should be
 * caught inline (with an aria-visible alert) and block submit, rather than
 * round-tripping to the server's generic 400. Also locks the parseFloat→Number
 * fix: parseFloat("1,000") === 1 would silently record $1.00; Number("1,000")
 * is NaN → rejected. The page is a client component (can't render in node
 * without a DOM), so these are source-level guards (matches the
 * budget/transaction/plan amount-validation pattern).
 */
const src = readFileSync(
  path.resolve(__dirname, "../src/app/(app)/accounts/page.tsx"),
  "utf8"
);

describe("add-account balance validation UX", () => {
  it("computes an inline error for a non-finite balance", () => {
    expect(src).toContain("Enter a valid balance.");
    expect(src).toMatch(
      /balanceNum !== null && !Number\.isFinite\(balanceNum\) \? "Enter a valid balance\." : null/
    );
  });

  it("uses Number() — not parseFloat — so '1,000' is rejected, not truncated to $1", () => {
    expect(src).toContain("const balanceNum = balance.trim() === \"\" ? null : Number(balance);");
    expect(src).toContain("Math.round(balanceNum * 100)");
    expect(src).not.toContain("parseFloat(balance)");
  });

  it("marks the balance input invalid when there is an error", () => {
    expect(src).toContain("aria-invalid={!!balanceError}");
  });

  it("surfaces the error as an accessible alert", () => {
    expect(src).toContain('role="alert" className="mt-1 text-xs text-danger">{balanceError}');
  });

  it("blocks submit while the balance is invalid", () => {
    expect(src).toContain(
      "disabled={create.isPending || !name || !!balanceError}"
    );
  });
});
