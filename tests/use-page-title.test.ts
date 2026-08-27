import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PAGES: Array<[string, string]> = [
  ["src/app/(app)/dashboard/page.tsx", "Dashboard"],
  ["src/app/(app)/accounts/page.tsx", "Accounts"],
  ["src/app/(app)/transactions/page.tsx", "Transactions"],
  ["src/app/(app)/budgets/page.tsx", "Budgets"],
  ["src/app/(app)/plan/page.tsx", "Plan"],
  ["src/app/(app)/reports/page.tsx", "Reports"],
  ["src/app/(app)/settings/page.tsx", "Settings"],
  ["src/app/(app)/agents/page.tsx", "Agents"],
];

describe("usePageTitle (per-page document.title)", () => {
  it("usePageTitle is SSR-safe and restores the previous title", () => {
    const src = read("src/lib/use-page-title.ts");
    expect(src).toContain("export function usePageTitle(title: string)");
    expect(src).toContain("hasDocument()");
    expect(src).toContain("document.title = title;");
    // restores the prior title on unmount
    expect(src).toContain("return () =>");
    expect(src).toContain("document.title = previous;");
  });

  for (const [file, label] of PAGES) {
    it(`${(file)} imports and calls usePageTitle("${label}")`, () => {
      const src = read(file);
      expect(src).toContain('import { usePageTitle } from "@/lib/use-page-title";');
      expect(src).toContain(`usePageTitle("${label}");`);
    });
  }
});
