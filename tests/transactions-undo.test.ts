import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Q38 undo-over-warning: transactions reversible delete", () => {
  const page = read("src/app/(app)/transactions/page.tsx");
  const snackbar = read("src/components/ui/undo-snackbar.tsx");

  it("deletes a manual transaction immediately (no 'Are you sure?' confirm) and captures it for undo", () => {
    expect(page).toContain("remove.mutate(t)");
    expect(page).toContain("setUndoTxn(");
    // the bare confirm path is gone
    expect(page).not.toContain("setConfirmDelete");
  });

  it("recreates the deleted row on Undo via POST /api/transactions", () => {
    expect(page).toContain('api.post("/api/transactions", {');
    expect(page).toContain("undoDelete.mutate(undoTxn)");
    expect(page).toContain('<UndoSnackbar');
  });

  it("snackbar is an M3 role=status with a single Undo action + auto-dismiss", () => {
    expect(snackbar).toContain('role="status"');
    expect(snackbar).toContain('aria-live="polite"');
    expect(snackbar).toContain("Undo");
    // timed auto-dismiss (M3 LONG = 2750ms)
    expect(snackbar).toContain("setTimeout(onClose, duration)");
  });
});
