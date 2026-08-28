import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Q13 form validation timing (blur-gated, not live)", () => {
  const tx = read("src/app/(app)/transactions/page.tsx");
  const budgets = read("src/app/(app)/budgets/page.tsx");

  it("add-transaction amount validates on blur, error gated by touched", () => {
    expect(tx).toContain("const [amountTouched, setAmountTouched] = useState(false);");
    expect(tx).toContain("onBlur={() => setAmountTouched(true)}");
    // error only shows after blur (touched), not on every keystroke
    expect(tx).toContain("{amountTouched && addAmountError && (");
    expect(tx).toContain("aria-invalid={amountTouched && !!addAmountError}");
  });

  it("edit-transaction amount validates on blur, error gated by touched", () => {
    expect(tx).toContain("const [editTouched, setEditTouched] = useState(false);");
    expect(tx).toContain("onBlur={() => setEditTouched(true)}");
    expect(tx).toContain("{editTouched && editAmountError && (");
    expect(tx).toContain("aria-invalid={editTouched && !!editAmountError}");
  });

  it("budget create/edit amount validates on blur, error gated by touched", () => {
    expect(budgets).toContain("const [amountTouched, setAmountTouched] = useState(false);");
    expect(budgets).toContain("onBlur={() => setAmountTouched(true)}");
    expect(budgets).toContain("{amountTouched && amountError && (");
    expect(budgets).toContain("aria-invalid={amountTouched && !!amountError}");
  });
});
