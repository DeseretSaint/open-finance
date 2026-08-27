import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Agent-managed dashboard widgets (agent-widgets.tsx remove) and the review
 * category-apply (review-widget.tsx apply) used to have NO onError — a failed
 * delete / category-apply (network/CSRF/validation) failed silently with zero
 * user feedback. These guards fail the build if either mutation loses its error
 * surfacing, or if the widget-remove "Remove" button loses its busy/disabled
 * state (double-clickable mid-request).
 */
const WIDGETS = path.resolve(__dirname, "../src/components/agent-widgets.tsx");
const REVIEW = path.resolve(__dirname, "../src/components/review-widget.tsx");

function mutationBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useMutation(`);
  if (start < 0) throw new Error(`mutation not found: ${name}`);
  let i = src.indexOf("{", start) + 1;
  let depth = 1;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return src.slice(start, i);
}

describe("agent-widgets remove surfaces errors + shows busy state", () => {
  const src = readFileSync(WIDGETS, "utf8");
  const body = mutationBody(src, "remove");

  it("remove has onError -> setErr", () => {
    expect(body).toContain("onError");
    expect(body).toContain("setErr(");
  });

  it("Remove button is disabled + busy while pending", () => {
    expect(src).toMatch(/onClick=\{\(\) => remove\.mutate\(v\.id\)\}/);
    expect(src).toContain("disabled={remove.isPending}");
    expect(src).toContain('"Removing…"');
  });
});

describe("review-widget apply surfaces errors", () => {
  const src = readFileSync(REVIEW, "utf8");
  const body = mutationBody(src, "apply");

  it("apply has onError -> setErr", () => {
    expect(body).toContain("onError");
    expect(body).toContain("setErr(");
  });

  it("renders an error alert paragraph", () => {
    expect(src).toMatch(/\{err && <p className="text-xs font-medium text-danger" role="alert">\{err\}<\/p>\}/);
  });
});
