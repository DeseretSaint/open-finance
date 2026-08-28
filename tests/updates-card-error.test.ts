import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("updates card fetch error handling", () => {
  const src = read("src/components/updates-card.tsx");

  it("surfaces a /api/updates fetch failure with a retry (run-175)", () => {
    // gated on isError && !data so a background refetch error never blanks the buttons
    expect(src).toContain("status.isError && !status.data");
    // calm alert + retry wired to refetch
    expect(src).toContain('role="alert"');
    expect(src).toContain("Couldn&apos;t load update status.");
    expect(src).toContain("onClick={() => status.refetch()}");
    expect(src).toContain('{status.isFetching ? "Retrying…" : "Try again"}');
  });
});
