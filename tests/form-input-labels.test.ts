import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Regression guard: every <Input> on a core screen must be programmatically
// labeled (via id -> <label htmlFor> or an explicit aria-label) so screen
// readers announce the field purpose instead of a generic "edit text".
const SCREENS = [
  "src/app/(app)/budgets/page.tsx",
  "src/app/(app)/accounts/page.tsx",
  "src/app/(app)/transactions/page.tsx",
  "src/app/(app)/agents/page.tsx",
  "src/app/(app)/plan/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/login/page.tsx",
  "src/app/register/page.tsx",
  "src/components/onboarding-wizard.tsx",
  "src/components/device-lock-gate.tsx",
  "src/components/pairing-section.tsx",
];

describe("form inputs are programmatically labeled", () => {
  for (const file of SCREENS) {
    it(`every <Input> in ${file} has id or aria-label`, () => {
      const src = readFileSync(file, "utf8");
      const re = /<Input\b([\s\S]*?)\/>/g;
      let m;
      const unlabeled: string[] = [];
      while ((m = re.exec(src))) {
        const attrs = m[1];
        const atLine = src.slice(0, m.index).split("\n").length;
        const hasId = /\bid=/.test(attrs);
        const hasAria = /aria-label/.test(attrs);
        if (!hasId && !hasAria) {
          unlabeled.push(`${file}:${atLine}`);
        }
      }
      expect(unlabeled, `unlabeled inputs: ${unlabeled.join(", ")}`).toEqual([]);
    });
  }
});
