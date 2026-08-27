import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("dashboard summary fetch error handling", () => {
  it("surfaces a summary fetch failure instead of an infinite skeleton", () => {
    const src = read("src/app/(app)/dashboard/page.tsx");
    // the summary query destructures error + refetch (not just data/isLoading)
    expect(src).toMatch(
      /const \{ data, isLoading, error, refetch, isFetching \} = useQuery\(\{\s*queryKey: \["summary", includePending\]/
    );
    // a dedicated error branch (only when there is no data to show) renders an alert + retry
    expect(src).toContain('Couldn&apos;t load your dashboard');
    expect(src).toContain('role="alert"');
    // retry button wired to refetch() and disabled while fetching
    expect(src).toContain("onClick={() => refetch()}");
    expect(src).toContain('disabled={isFetching}');
    expect(src).toContain('{isFetching ? "Retrying…" : "Try again"}');
    // the error branch is gated on no-data so a background refetch-error never blanks the page
    expect(src).toContain("if (error && !data) {");
  });
});
