import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ConfirmDialog must stay open while the delete/remove mutation is in flight and
 * only close on success — run-130 found budgets closed the dialog (setConfirmDelete(null))
 * inside onConfirm BEFORE the mutation resolved, so the busy spinner never showed and any
 * error was silently swallowed. Same latent bug existed in accounts / transactions / plan /
 * settings. These guards fail the build if any of those dialogs re-close early inside onConfirm.
 */
const paths = {
  accounts: "src/app/(app)/accounts/page.tsx",
  transactions: "src/app/(app)/transactions/page.tsx",
  plan: "src/app/(app)/plan/page.tsx",
  settings: "src/app/(app)/settings/page.tsx",
} as const;

function dialogFragment(src: string, title: string): string {
  const start = src.indexOf(`title="${title}"`);
  if (start < 0) throw new Error(`dialog title not found: ${title}`);
  // ConfirmDialog is a self-closing component; slice to its closing />
  const end = src.indexOf("/>", start);
  if (end < 0) throw new Error(`dialog close not found: ${title}`);
  return src.slice(start, end);
}

function onConfirmBody(fragment: string): string {
  const oc = fragment.indexOf("onConfirm={() => {");
  if (oc < 0) throw new Error("onConfirm not found in fragment");
  let i = fragment.indexOf("{", oc) + 1;
  let depth = 1;
  for (; i < fragment.length && depth > 0; i++) {
    if (fragment[i] === "{") depth++;
    else if (fragment[i] === "}") depth--;
  }
  return fragment.slice(oc, i);
}

describe("confirm dialog stays open through the request", () => {
  it("accounts: remove closes only on success and surfaces errors", () => {
    const src = readFileSync(path.resolve(__dirname, "../", paths.accounts), "utf8");
    // the dialog's onConfirm does NOT close the dialog itself
    const dlg = onConfirmBody(dialogFragment(src, "Remove account?"));
    expect(dlg).not.toContain("setConfirmDelete(null)");
    // the mutation closes on success and sets an error on failure
    expect(src).toMatch(/onSuccess: async \(\) => \{\s*setConfirmDelete\(null\);/);
    expect(src).toMatch(/onError: \(e\) =>\s*setConfirmDelete\(\(c\)/);
  });

  it("transactions: reversible delete uses undo (no early-close confirm, error surfaced)", () => {
    const src = readFileSync(path.resolve(__dirname, "../", paths.transactions), "utf8");
    // the bare confirm was replaced by immediate delete + timed Undo (Q38: undo > warning)
    expect(src).not.toContain('title="Delete transaction?"');
    expect(src).toContain("remove.mutate(t)");
    expect(src).toContain("setUndoTxn(");
    // delete errors are still surfaced (not silently swallowed)
    expect(src).toContain('"Failed to delete transaction."');
    // Undo recreates the deleted row
    expect(src).toContain('api.post("/api/transactions", {');
  });

  it("plan: all three removes use immediate-delete + Undo (no early-close confirm; error surfaced)", () => {
    const src = readFileSync(path.resolve(__dirname, "../", paths.plan), "utf8");
    // the bare confirm was replaced by immediate delete + timed Undo (Q38: undo > warning)
    expect(src).not.toContain("setConfirmDelete");
    expect(src).not.toContain("<ConfirmDialog");
    expect(src).toContain("removeBill.mutate(b)");
    expect(src).toContain("removeDebt.mutate(d)");
    expect(src).toContain("removeGoal.mutate(g)");
    expect(src).toContain("setUndoBill(");
    expect(src).toContain("setUndoDebt(");
    expect(src).toContain("setUndoGoal(");
    // delete errors are still surfaced (not silently swallowed)
    expect(src).toContain('"Failed to delete bill."');
    expect(src).toContain('"Failed to delete debt."');
    expect(src).toContain('"Failed to delete goal."');
    // Undo recreates each deleted entity
    expect(src).toContain('api.post("/api/planning/bills", {');
    expect(src).toContain('api.post("/api/planning/debts", {');
    expect(src).toContain('api.post("/api/planning/goals", {');
  });

  it("settings: logout-all and remove-item close only on success", () => {
    const src = readFileSync(path.resolve(__dirname, "../", paths.settings), "utf8");
    const logout = onConfirmBody(dialogFragment(src, "Sign out everywhere?"));
    expect(logout).not.toContain("setConfirmLogoutAll(false)");
    expect(src).toMatch(/onSuccess: \(\) => \{\s*setConfirmLogoutAll\(false\);\s*window\.location\.href = "\/login";/);
    const rm = onConfirmBody(dialogFragment(src, "Remove this bank connection?"));
    expect(rm).not.toContain("setConfirmRemoveItem(null)");
    expect(src).toMatch(/onSuccess: \(\) => \{\s*setConfirmRemoveItem\(null\);/);
  });
});
