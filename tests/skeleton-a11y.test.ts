import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Loading skeletons must announce themselves to assistive tech (role=status +
// aria-busy) so screen-reader users get a "Loading…" announcement instead of
// silent, unexplained empty space. Mirrors the a11y parity work in runs 182/184/187.
describe("skeleton loaders announce loading state", () => {
  const cases: Array<[string, string, string]> = [
    ["dashboard", "src/app/(app)/dashboard/page.tsx", "Loading your dashboard"],
    ["transactions", "src/app/(app)/transactions/page.tsx", "Loading your transactions"],
    ["accounts", "src/app/(app)/accounts/page.tsx", "Loading your accounts"],
    ["budgets", "src/app/(app)/budgets/page.tsx", "Loading your budgets"],
  ];
  for (const [name, file, label] of cases) {
    it(`${name} skeleton is a live loading region`, () => {
      const src = read(file);
      expect(src).toMatch(/aria-busy="true"/);
      expect(src).toContain('role="status"');
      expect(src).toContain(`aria-label="${label}"`);
    });
  }
});
