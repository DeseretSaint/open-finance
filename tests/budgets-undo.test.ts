import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Q38 undo-over-warning: budgets reversible delete", () => {
  const page = read("src/app/(app)/budgets/page.tsx");
  const snackbar = read("src/components/ui/undo-snackbar.tsx");

  it("deletes a budget immediately (no 'Are you sure?' confirm) and captures it for undo", () => {
    expect(page).toContain("remove.mutate(b)");
    expect(page).toContain("setUndoBudget(");
    // the bare confirm path is gone
    expect(page).not.toContain("setConfirmDelete");
    expect(page).not.toContain('title="Delete budget?"');
  });

  it("recreates the deleted budget on Undo via POST /api/budgets with its fields", () => {
    expect(page).toContain('api.post("/api/budgets", {');
    expect(page).toContain("undoDelete.mutate(undoBudget)");
    expect(page).toContain('<UndoSnackbar');
    // rebuild carries the budget's reconstructable fields
    expect(page).toContain("amountCents: b.amount_cents");
    expect(page).toContain("categoryIds: b.categoryIds");
  });

  it("snackbar is an M3 role=status with a single Undo action + auto-dismiss", () => {
    expect(snackbar).toContain('role="status"');
    expect(snackbar).toContain('aria-live="polite"');
    expect(snackbar).toContain("Undo");
    // timed auto-dismiss (M3 LONG = 2750ms)
    expect(snackbar).toContain("setTimeout(onClose, duration)");
  });
});
