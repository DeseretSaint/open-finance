import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Every main page needs a per-page heading so screen-reader / heading-navigation
// users hear the current section name. The app-shell header <h1> shows the user's
// display name on every route, so these sr-only page headings are what actually
// announce "Dashboard / Transactions / Budgets / Reports / Plan / Settings".
// (accounts + agents already had visible <h1>s; the other six were missing one.)
describe("main pages expose a per-page heading", () => {
  const cases: Array<[string, string]> = [
    ["dashboard", "src/app/(app)/dashboard/page.tsx"],
    ["transactions", "src/app/(app)/transactions/page.tsx"],
    ["budgets", "src/app/(app)/budgets/page.tsx"],
    ["reports", "src/app/(app)/reports/page.tsx"],
    ["plan", "src/app/(app)/plan/page.tsx"],
    ["settings", "src/app/(app)/settings/page.tsx"],
  ];
  for (const [name, file] of cases) {
    it(`${name} page has an sr-only page heading`, () => {
      const src = read(file);
      expect(src).toContain(`<h1 className="sr-only">${name[0].toUpperCase()}${name.slice(1)}</h1>`);
    });
  }
});
