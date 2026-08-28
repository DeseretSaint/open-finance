import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("agent-widgets fetch error handling", () => {
  const src = read("src/components/agent-widgets.tsx");

  it("does not silently hide the widgets when the custom-views fetch fails", () => {
    // fetchFailed gated on isError && !data (background refetch errors never blank rendered content)
    expect(src).toContain("const fetchFailed = views.isError && !views.data;");
    // the empty-list early-return must NOT fire on a fetch failure
    expect(src).toContain("if (list.length === 0 && !fetchFailed) return null;");
  });

  it("surfaces the failure with a calm alert + retry wired to refetch", () => {
    expect(src).toContain("if (fetchFailed) {");
    expect(src).toContain('role="alert"');
    expect(src).toContain("Couldn&apos;t load your widgets");
    expect(src).toContain("onClick={() => views.refetch()}");
    expect(src).toContain('{views.isFetching ? "Retrying…" : "Try again"}');
  });
});
