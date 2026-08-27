import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Plan page "Paid" button UX (run-139, SLOT-B fresh-eyes fix):
 *  - payBill had NO onError → a failed pay silently swallowed the error (no feedback).
 *  - the "Paid" Button had no busy/disabled state → double-clickable, no "Saving…" feedback.
 *  - the add-sheet overlay close guard omitted createExpense.isPending → a mid-flight
 *    expense create could be dismissed by an outside tap.
 * Guards fail the build if any of those regress.
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/plan/page.tsx"), "utf8");

describe("plan page bill Paid button", () => {
  it("payBill surfaces errors via onError", () => {
    const m = src.indexOf("const payBill = useMutation(");
    expect(m).toBeGreaterThan(-1);
    let i = src.indexOf("{", m) + 1;
    let depth = 1;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    const body = src.slice(m, i);
    expect(body).toContain("onSuccess: invalidate");
    expect(body).toContain('onError: (e) => setErr');
  });

  it("Paid button is disabled while pending and shows a busy label + aria-label", () => {
    expect(src).toContain("disabled={payBill.isPending}");
    expect(src).toContain('aria-label={`Mark ${b.name} paid`}');
    expect(src).toContain("payBill.isPending && payBill.variables === b.id ? \"Saving…\" : \"Paid\"");
  });

  it("add-sheet overlay close guard covers the expense create", () => {
    expect(src).toContain(
      "if (createBill.isPending || createDebt.isPending || createGoal.isPending || createExpense.isPending) return;"
    );
  });
});
