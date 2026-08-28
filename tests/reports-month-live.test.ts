import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/app/(app)/reports/page.tsx"), "utf8");

describe("reports month navigator announces changes (aria-live)", () => {
  it("wraps the month label in an aria-live polite status region", () => {
    expect(src).toMatch(/aria-live="polite"\s+role="status"/);
  });
  it("the live region contains the monthLabel", () => {
    const m = src.match(/aria-live="polite"[\s\S]{0,200}?\{monthLabel\}/);
    expect(m).not.toBeNull();
  });
});
