import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Visual progress bars that render only a raw <div style={{width}}> are silent to
// screen readers. They must expose role="progressbar" + aria-value* so AT announces
// the percentage. The app already uses the shared <Progress> component (budgets
// cards) for this; these two standalone bars were missed. Mirrors the a11y-parity
// work in runs 191/194/195.
describe("progress bars expose accessible semantics", () => {
  it("budgets income-used bar is a labelled progressbar", () => {
    const src = read("src/app/(app)/budgets/page.tsx");
    expect(src).toMatch(/role="progressbar"/);
    expect(src).toMatch(/aria-valuemin=\{0\}/);
    expect(src).toMatch(/aria-valuemax=\{100\}/);
    expect(src).toContain('aria-label="Percentage of this period\'s income spent"');
    expect(src).toMatch(/aria-valuenow=\{/);
  });

  it("settings categorization bar is a labelled progressbar", () => {
    const src = read("src/app/(app)/settings/page.tsx");
    expect(src).toMatch(/role="progressbar"/);
    expect(src).toMatch(/aria-valuemin=\{0\}/);
    expect(src).toMatch(/aria-valuemax=\{100\}/);
    expect(src).toMatch(/aria-valuenow=\{Math\.round\(\(catProgress\.done \/ catProgress\.total\) \* 100\)\}/);
    expect(src).toContain("transactions in range categorized");
  });
});
