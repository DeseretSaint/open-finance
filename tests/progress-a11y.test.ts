import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Progress a11y (WAI-ARIA progressbar)", () => {
  it("Progress renders role=progressbar with aria-valuenow/min/max + label", () => {
    const src = read("src/components/ui/badge.tsx");
    expect(src).toContain('role="progressbar"');
    expect(src).toContain("aria-valuemin={0}");
    expect(src).toContain("aria-valuemax={100}");
    expect(src).toContain("aria-valuenow={Math.round(value * 100)}");
    expect(src).toContain('aria-label={label ?? "Progress"}');
    // the visual fill div is decorative once the container carries the semantics
    expect(src).toContain('aria-hidden="true"');
  });

  it("budgets page passes a per-budget label", () => {
    const src = read("src/app/(app)/budgets/page.tsx");
    expect(src).toContain("<Progress value={b.pct} label={`${b.name} budget usage`} />");
  });

  it("dashboard budgets card passes a per-budget label", () => {
    const src = read("src/app/(app)/dashboard/page.tsx");
    expect(src).toContain("<Progress value={b.pct} label={`${b.name} budget usage`} />");
  });

  it("plan goals pass a per-goal label", () => {
    const src = read("src/app/(app)/plan/page.tsx");
    expect(src).toContain("<Progress value={g.pct} label={`${g.name} goal progress`} />");
  });

  it("agent progress widgets pass a per-widget label", () => {
    const src = read("src/components/agent-widgets.tsx");
    expect(src).toContain("<Progress value={pct} label={`${w.title} usage`} />");
  });

  it("no unlabeled <Progress value=... /> call sites remain", () => {
    const files = [
      "src/app/(app)/budgets/page.tsx",
      "src/app/(app)/dashboard/page.tsx",
      "src/app/(app)/plan/page.tsx",
      "src/components/agent-widgets.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/<Progress value=\{[^}]+\} \/>/);
    }
  });
});
