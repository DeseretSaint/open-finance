import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("review-widget fetch error handling", () => {
  const src = read("src/components/review-widget.tsx");

  it("does not silently hide the widget when the review-queue fetch fails", () => {
    // fetchFailed gated on isError && !data (background refetch errors never blank rendered content)
    expect(src).toContain("const fetchFailed = review.isError && !review.data;");
    // the invisible-early-return must NOT fire on a fetch failure
    expect(src).toContain("if (!open && count === 0 && !fetchFailed) return null;");
  });

  it("surfaces the failure with a calm alert + retry wired to refetch", () => {
    expect(src).toContain("{fetchFailed && (");
    expect(src).toContain('role="alert"');
    expect(src).toContain("Couldn&apos;t load your review queue.");
    expect(src).toContain("onClick={() => review.refetch()}");
    expect(src).toContain('{review.isFetching ? "Retrying…" : "Try again"}');
    // header line reflects the failure instead of a misleading "All caught up"
    expect(src).toContain('fetchFailed ? "Couldn\'t load your review queue" : count > 0');
  });
});
