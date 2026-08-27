import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("transactions category filter", () => {
  it("exposes a category filter control wired to the categoryId query param", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    // filter control present
    expect(src).toContain('ariaLabel="Filter by category"');
    expect(src).toContain('placeholder="All categories"');
    // state + query wiring
    expect(src).toContain("const [categoryId, setCategoryId] = useState");
    expect(src).toContain('if (categoryId) p.set("categoryId", categoryId);');
    expect(src).toMatch(/\[\s*q,\s*accountId,\s*categoryId,\s*pendingOnly,\s*limit\s*\]/);
    // clear-filters branch clears the new filter too
    expect(src).toContain('{q || accountId || categoryId || pendingOnly ? (');
    expect(src).toContain("setCategoryId(\"\");");
  });

  it("backend transactions route accepts categoryId", () => {
    const route = read("src/app/api/transactions/route.ts");
    expect(route).toContain("categoryId: z.string().optional()");
  });
});
