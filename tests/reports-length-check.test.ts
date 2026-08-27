import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `barData.length > 0 && barData.some(...)` is a useless length check — `.some()`
// already returns false on an empty array. Regression guard for the lint:slop
// `unicorn/no-useless-length-check` fix (run 79).
const reports = readFileSync(
  join(process.cwd(), "src/app/(app)/reports/page.tsx"),
  "utf8"
);

describe("reports hasCashflow — no useless length check", () => {
  it("hasCashflow is computed with .some() only", () => {
    expect(reports).toMatch(
      /const hasCashflow = barData\.some\(\(r\) => r\.Income !== 0 \|\| r\.Expenses !== 0 \|\| r\.Net !== 0\);/
    );
  });

  it("hasCashflow no longer carries the redundant length > 0 guard", () => {
    expect(reports).not.toMatch(/hasCashflow = barData\.length > 0/);
  });
});
