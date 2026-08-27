import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("transactions date-range filter", () => {
  it("wires From/To date pickers into the list query", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    // both picker states exist
    expect(src).toMatch(/const \[from, setFrom\] = useState\(""\);/);
    expect(src).toMatch(/const \[to, setTo\] = useState\(""\);/);
    // pickers are rendered with aria-labels
    expect(src).toContain('ariaLabel="From date"');
    expect(src).toContain('ariaLabel="To date"');
    // query params include the date window
    expect(src).toContain('if (from) p.set("from", from);');
    expect(src).toContain('if (to) p.set("to", to);');
    // memo deps include from + to
    expect(src).toMatch(/\[\s*debouncedQ,\s*accountId,\s*categoryId,\s*pendingOnly,\s*from,\s*to,\s*limit\s*\]/);
  });

  it("Clear filters resets both date bounds", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    // the empty-state branch now covers the date range
    expect(src).toContain("q || accountId || categoryId || pendingOnly || from || to ?");
    // the Clear filters handler clears from + to
    expect(src).toMatch(/setPendingOnly\(false\);\s*setFrom\(""\);\s*setTo\(""\);/);
    // a dedicated Clear dates button resets them too
    expect(src).toContain('aria-label="Clear date range"');
  });
});
