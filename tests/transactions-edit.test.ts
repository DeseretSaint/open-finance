import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("transactions manual-row edit", () => {
  const src = read("src/app/(app)/transactions/page.tsx");

  it("defines the edit mutation against PATCH /api/transactions/:id", () => {
    // the mutation the escape-close hook references must exist
    expect(src).toMatch(/const edit = useMutation\(\{/);
    expect(src).toContain("api.patch(`/api/transactions/${editId}`, {");
    // sends exactly the fields the route's updateSchema accepts
    expect(src).toContain("name: editName,");
    expect(src).toContain("amountCents: Math.round(editNum * 100),");
    expect(src).toContain("date: editDate,");
    // success closes + invalidates; failure surfaces a message
    expect(src).toMatch(/onSuccess: \(\) => \{\s*setEditId\(null\);/);
    expect(src).toContain('onError: (e) => setError(e instanceof Error ? e.message : "Update failed.")');
  });

  it("shows the Edit affordance only on manual rows and pre-fills the form", () => {
    expect(src).toContain("aria-label={`Edit ${t.name}`}");
    // pre-fill from the row (cents → dollars)
    expect(src).toContain("setEditAmount((t.amount_cents / 100).toFixed(2));");
    expect(src).toContain("setEditDate(t.date);");
    // the Edit button lives inside the same manual-only branch as Delete
    const editIdx = src.indexOf("aria-label={`Edit ${t.name}`}");
    const manualGuard = src.lastIndexOf('t.source === "manual"', editIdx);
    expect(manualGuard).toBeGreaterThan(-1);
    expect(editIdx - manualGuard).toBeLessThan(200);
  });

  it("renders an accessible edit modal with inline validation", () => {
    expect(src).toContain('aria-label="Edit transaction"');
    expect(src).toContain("editDialogA11yRef");
    // escape closes only when the save isn't in flight
    expect(src).toMatch(/useEscapeToClose\(\(\) => \{ if \(!edit\.isPending\) setEditId\(null\); \}, editId !== null\);/);
    // inline amount validation mirrors the add form (Number(), not parseFloat)
    expect(src).toContain("const editNum = Number(editAmount);");
    expect(src).toContain("editAmountError");
    // submit is disabled while saving or when inputs are invalid
    expect(src).toContain("disabled={edit.isPending || !editName || !editAmount || !!editAmountError}");
    expect(src).toContain('{edit.isPending ? "Saving…" : "Save changes"}');
  });
});
