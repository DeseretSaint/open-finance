import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Plan add-sheet amount validation UX (same class as run-59 budgets / run-68
 * transactions): the bill/debt/goal/upcoming-expense forms enabled submit on
 * ANY non-empty amount string and used parseFloat — so "abc" → NaN, "0", and
 * worst case "1,000" → $1.00 (parseFloat stops at the comma) all round-tripped
 * to the server's generic 400 or silently recorded a wrong amount. These
 * source guards lock the Number()-based inline validation + aria-invalid +
 * role=alert + disabled-submit wiring for all four forms. The page is a client
 * component (can't render in node without a DOM), so source-level guards match
 * the budget-amount-validation / transaction-amount-validation pattern.
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/plan/page.tsx"), "utf8");

describe("plan add-sheet amount validation UX", () => {
  it("validates amounts via a shared Number()-based helper (non-finite or <= 0 rejected)", () => {
    expect(src).toContain("function positiveAmountError(raw: string): string | null {");
    expect(src).toContain("const n = Number(raw);");
    expect(src).toMatch(/if \(!Number\.isFinite\(n\)\) return "Enter a valid amount\.";?/);
    expect(src).toMatch(/if \(n <= 0\) return "Amount must be greater than 0\.";?/);
  });

  it("uses Number() — not parseFloat — for the four primary amounts so '1,000' is rejected, not truncated to $1", () => {
    expect(src).toContain("Math.round(Number(billAmount) * 100)");
    expect(src).toContain("Math.round(Number(debtPrincipal) * 100)");
    expect(src).toContain("Math.round(Number(goalTarget) * 100)");
    expect(src).toContain("Math.round(Number(expAmount) * 100)");
    expect(src).not.toContain("parseFloat(billAmount)");
    expect(src).not.toContain("parseFloat(debtPrincipal)");
    expect(src).not.toContain("parseFloat(goalTarget)");
    expect(src).not.toContain("parseFloat(expAmount)");
  });

  it("computes an inline error for each primary amount field", () => {
    expect(src).toContain("const billAmountError = positiveAmountError(billAmount);");
    expect(src).toContain("const debtPrincipalError = positiveAmountError(debtPrincipal);");
    expect(src).toContain("const goalTargetError = positiveAmountError(goalTarget);");
    expect(src).toContain("const expAmountError = positiveAmountError(expAmount);");
  });

  it("marks each amount input invalid when there is an error", () => {
    expect(src).toContain("aria-invalid={!!billAmountError}");
    expect(src).toContain("aria-invalid={!!debtPrincipalError}");
    expect(src).toContain("aria-invalid={!!goalTargetError}");
    expect(src).toContain("aria-invalid={!!expAmountError}");
  });

  it("surfaces each error as an accessible alert", () => {
    expect(src).toContain('role="alert" className="mt-1 text-xs text-danger">{billAmountError}');
    expect(src).toContain('role="alert" className="mt-1 text-xs text-danger">{debtPrincipalError}');
    expect(src).toContain('role="alert" className="mt-1 text-xs text-danger">{goalTargetError}');
    expect(src).toContain('role="alert" className="mt-1 text-xs text-danger">{expAmountError}');
  });

  it("blocks submit while the amount is invalid on all four forms", () => {
    expect(src).toContain(
      "disabled={createBill.isPending || !billName || !billAmount || !!billAmountError}"
    );
    expect(src).toContain(
      "disabled={createDebt.isPending || !debtName || !debtPrincipal || !!debtPrincipalError}"
    );
    expect(src).toContain(
      "disabled={createGoal.isPending || !goalName || !goalTarget || !!goalTargetError}"
    );
    expect(src).toContain(
      "disabled={createExpense.isPending || !expName || !expAmount || !!expAmountError || (expSetAside && expMode === \"days_of_month\" && expDays.length === 0)}"
    );
  });
});
