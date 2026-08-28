import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Source guard (node env): the shared dialog a11y hook must lock background
// scroll while open so the underlying page can't drift behind a mobile sheet,
// and must restore the prior overflow on close. This covers all 10 dialogs
// that wire the hook (budgets/accounts/transactions/plan/settings/sidebar).
const src = readFileSync(join(process.cwd(), "src/lib/use-dialog-a11y.ts"), "utf8");

describe("useDialogA11y — background scroll lock (source guard)", () => {
  it("declares a body-scroll-lock helper called by the hook", () => {
    expect(src).toMatch(/useBodyScrollLock\(open\)/);
    expect(src).toMatch(/function useBodyScrollLock\(open:\s*boolean\)/);
  });

  it("sets overflow hidden while open and restores the prior value on close", () => {
    expect(src).toMatch(/document\.body\.style\.overflow\s*=\s*"hidden"/);
    // Restore branch must reassign from the captured previous value.
    expect(src).toMatch(/document\.body\.style\.overflow\s*=\s*prev/);
  });
});
