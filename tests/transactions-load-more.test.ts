import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("transactions page load-more pagination", () => {
  const src = read("src/app/(app)/transactions/page.tsx");

  it("uses offset-based pagination (server clamps limit to 200, so growing limit never worked)", () => {
    // switched from useQuery to useInfiniteQuery with a cursor offset
    expect(src).toContain("useInfiniteQuery");
    expect(src).toMatch(/offset=\$\{pageParam\}/);
    expect(src).toContain("getNextPageParam");
    // no lingering grow-limit dead button
    expect(src).not.toMatch(/setLimit\(\(l\) => l \+ 200\)/);
  });

  it("wires the Load more button to fetchNextPage with a busy state", () => {
    expect(src).toContain("onClick={() => txQuery.fetchNextPage()}");
    expect(src).toContain("disabled={txQuery.isFetchingNextPage}");
    expect(src).toContain('"Loading…"');
  });
});
