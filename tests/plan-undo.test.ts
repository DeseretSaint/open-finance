import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Q38 undo-over-warning: plan reversible deletes", () => {
  const page = read("src/app/(app)/plan/page.tsx");
  const snackbar = read("src/components/ui/undo-snackbar.tsx");

  it("deletes bill/debt/goal immediately (no 'Are you sure?' confirm) and captures each for undo", () => {
    expect(page).toContain("removeBill.mutate(b)");
    expect(page).toContain("removeDebt.mutate(d)");
    expect(page).toContain("removeGoal.mutate(g)");
    expect(page).toContain("setUndoBill(");
    expect(page).toContain("setUndoDebt(");
    expect(page).toContain("setUndoGoal(");
    // the bare confirm path is gone
    expect(page).not.toContain("setConfirmDelete");
    expect(page).not.toContain("<ConfirmDialog");
  });

  it("recreates the deleted entities on Undo via their POST endpoints with reconstructable fields", () => {
    expect(page).toContain('api.post("/api/planning/bills", {');
    expect(page).toContain('api.post("/api/planning/debts", {');
    expect(page).toContain('api.post("/api/planning/goals", {');
    expect(page).toContain("undoDeleteBill.mutate(undoBill)");
    expect(page).toContain("undoDeleteDebt.mutate(undoDebt)");
    expect(page).toContain("undoDeleteGoal.mutate(undoGoal)");
    expect(page).toContain("amountCents: b.amount_cents");
    expect(page).toContain("principalCents: d.principal_cents");
    expect(page).toContain("targetCents: g.target_cents");
  });

  it("snackbar is an M3 role=status with a single Undo action + auto-dismiss", () => {
    expect(page).toContain("<UndoSnackbar");
    expect(snackbar).toContain('role="status"');
    expect(snackbar).toContain('aria-live="polite"');
    expect(snackbar).toContain("Undo");
    // timed auto-dismiss (M3 LONG = 2750ms)
    expect(snackbar).toContain("setTimeout(onClose, duration)");
  });
});
