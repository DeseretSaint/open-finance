import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/app/(app)/reports/page.tsx"), "utf8");

// Q28 (verified 2026-08-28): magnitude comparisons must use bar/line, never
// pie/donut/gauge/radar; bar axes MUST start at zero (truncation = distortion);
// labels must be direct, not legends. The "Spending by category" chart was a
// donut (PieChart) — converted to a zero-baseline horizontal BarChart with
// direct Y-axis category labels + per-bar $ amount LabelList.
describe("reports spending-by-category chart honors Q28 (bar, zero baseline, direct labels)", () => {
  it("no longer renders a pie/donut for magnitude", () => {
    expect(src).not.toMatch(/<PieChart>/);
    expect(src).not.toMatch(/<Pie\s/);
  });
  it("uses a horizontal (vertical-layout) BarChart", () => {
    expect(src).toMatch(/<BarChart\s[\s\S]{0,400}?layout="vertical"/);
  });
  it("bars start at a zero baseline (domain [0, auto])", () => {
    expect(src).toMatch(/domain=\{\s*\[0,\s*"auto"\]\s*\}/);
  });
  it("category names are direct axis labels, not a legend list", () => {
    expect(src).toMatch(/type="category"\s+dataKey="name"/);
    expect(src).not.toMatch(/rounded-full"\s+style=\{\{\s*background:\s*CHART_COLORS/);
  });
});
