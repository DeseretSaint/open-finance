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
    // memo deps reference debouncedQ, not q (from/to were added for date-range)
    expect(src).toMatch(/\[\s*debouncedQ,\s*accountId,\s*categoryId,\s*pendingOnly,\s*from,\s*to\s*\]/);
  });

  it("Clear filters resets the debounced search immediately", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    // the Clear filters handler must clear both q AND debouncedQ so the
    // search drops instantly instead of lingering for the 300ms debounce
    expect(src).toMatch(/setQ\(""\);\s*setDebouncedQ\(""\);/);
    // it lives inside the "No transactions match your filters" empty-state branch
    expect(src).toContain("No transactions match your filters.");
  });

  it("search box uses semantic search semantics (Q36)", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    // it is a real search field, not a bare text box (native searchbox role)
    expect(src).toContain('type="search"');
    // the filter bar is labelled as a search region for assistive tech
    expect(src).toContain('<div className="flex flex-wrap items-center gap-3" role="search">');
    // the input is ~30ch wide (min-w-60 = 15rem) per the typeahead width guidance
    expect(src).toContain('className="relative min-w-60 flex-1"');
    // the input is linked to the results region it filters
    expect(src).toContain('aria-controls="tx-list"');
    // the input keeps its accessible name
    expect(src).toContain('aria-label="Search transactions"');
    // the results container carries the matching id
    expect(src).toContain('<div id="tx-list" className="divide-y divide-border">');
  });
});
