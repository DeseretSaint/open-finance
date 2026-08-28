import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/app/(app)/reports/page.tsx"), "utf8");

describe("reports charts have accessible names (WCAG 1.1.1)", () => {
  it("spending-by-category bar chart carries a descriptive role=img label", () => {
    expect(src).toMatch(/aria-label=\{`Spending by category bar chart for \$\{monthLabel\}/);
  });
  it("cash flow bar chart carries a role=img label", () => {
    expect(src).toMatch(/aria-label="Cash flow bar chart/);
  });
  it("projection line chart carries a role=img label", () => {
    expect(src).toMatch(/aria-label="Projected balance line chart/);
  });
  it("net worth trend line chart carries a role=img label", () => {
    expect(src).toMatch(/aria-label=\{`Net worth trend line chart — last \$\{trendMonths\}/);
  });
});
