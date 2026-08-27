import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Budget edit UX: the backend has always supported PATCH /api/budgets/:id
 * (name/amountCents/period/categoryIds), but the UI only offered
 * create/delete — users had to delete + recreate to change an amount.
 * The budgets page now has an edit button per card that opens the same
 * modal pre-filled and submits via PATCH. Client component → source-level
 * guards (matches budget-amount-validation / agent-manual-editor pattern).
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/budgets/page.tsx"), "utf8");

describe("budget edit UX", () => {
  it("adds an accessible edit button on each budget card", () => {
    expect(src).toContain("aria-label={`Edit budget ${b.name}`}");
    expect(src).toContain("onClick={() => openEdit(b)}");
  });

  it("tracks which budget is being edited", () => {
    expect(src).toContain('const [editingId, setEditingId] = useState<string | null>(null)');
  });

  it("submits edits through PATCH /api/budgets/:id", () => {
    expect(src).toContain("api.patch(`/api/budgets/${editingId}`");
    // sends the full editable shape the route's zod schema accepts
    expect(src).toMatch(/api\.patch\(`\/api\/budgets\/\$\{editingId\}`, \{\s*name,\s*amountCents: Math\.round\(parseFloat\(amount\) \* 100\),\s*period,\s*categoryIds,\s*\}\)/);
  });

  it("pre-fills the modal from the budget being edited", () => {
    expect(src).toContain("function openEdit(b: Budget)");
    expect(src).toContain("setName(b.name)");
    expect(src).toContain("setAmount((b.amount_cents / 100).toFixed(2))");
    expect(src).toContain("setCategoryIds(b.categoryIds)");
  });

  it("routes submit to update vs create based on edit state", () => {
    expect(src).toContain("if (editingId) update.mutate();");
    expect(src).toContain("else create.mutate();");
  });

  it("labels the modal and button for edit mode", () => {
    expect(src).toContain('aria-label={editingId ? "Edit budget" : "Create a budget"}');
    expect(src).toContain('editingId ? "Save changes" : "Create budget"');
  });

  it("resets edit state when the modal closes", () => {
    expect(src).toContain("function closeModal()");
    expect(src).toContain("setEditingId(null)");
  });

  it("keeps the delete dialog open while the request is in flight", () => {
    // The ConfirmDialog's busy prop is wired to the remove mutation so the
    // spinner shows and the user can't dismiss mid-request.
    expect(src).toContain("busy={remove.isPending}");
  });

  it("does not close the dialog before the delete completes", () => {
    // Regression guard: previously the dialog closed (setConfirmDelete(null))
    // on confirm, hiding the busy state and silently swallowing any error.
    expect(src).not.toContain("remove.mutate(confirmDelete.id);\n          setConfirmDelete(null);");
  });

  it("surfaces delete errors to the user", () => {
    // onError stashes the message on confirmDelete.error, appended to the
    // dialog's message text so a failed delete is visible (not swallowed).
    expect(src).toContain("confirmDelete.error");
  });
});
