import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("transactions search debounce", () => {
  it("debounces the search term before issuing a query", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    // a debounced value exists and is seeded from q
    expect(src).toMatch(/const \[debouncedQ, setDebouncedQ\] = useState\(q\)/);
    // a 300ms setTimeout debounce keyed on q
    expect(src).toMatch(/setTimeout\(\(\) => setDebouncedQ\(q\), 300\)/);
    // the query params use the debounced value, not the raw q
    expect(src).toContain('if (debouncedQ.trim()) p.set("q", debouncedQ.trim());');
    // the input itself stays responsive to the immediate q value
    expect(src).toContain("value={q}");
    expect(src).toContain('onChange={(e) => setQ(e.target.value)}');
    // memo deps reference debouncedQ, not q
    expect(src).toMatch(/\[\s*debouncedQ,\s*accountId,\s*categoryId,\s*pendingOnly,\s*limit\s*\]/);
  });

  it("Clear filters resets the debounced search immediately", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    // the Clear filters handler must clear both q AND debouncedQ so the
    // search drops instantly instead of lingering for the 300ms debounce
    expect(src).toMatch(/setQ\(""\);\s*setDebouncedQ\(""\);/);
    // it lives inside the "No transactions match your filters" empty-state branch
    expect(src).toContain("No transactions match your filters.");
  });
});
