import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("settings sub-card fetch error handling", () => {
  const src = read("src/app/(app)/settings/page.tsx");

  it("defines a reusable SubcardQueryError that only shows when the query errored and has no data", () => {
    expect(src).toContain("function SubcardQueryError(");
    // gated on isError && !data so a background refetch error never blanks the card
    expect(src).toContain("if (!q.isError || q.data) return null;");
    // calm alert + retry wired to refetch
    expect(src).toContain('role="alert"');
    expect(src).toContain("Couldn&apos;t load {what}.");
    expect(src).toContain("onClick={() => q.refetch()}");
    expect(src).toContain('{q.isFetching ? "Retrying…" : "Try again"}');
  });

  it("surfaces fetch failures on the sub-cards that previously had no error UI", () => {
    // Notifications & security (2 queries), Categories, Paydays, Hub (diagnostics + detect)
    expect(src).toContain('<SubcardQueryError q={prefs} what="notification preferences" />');
    expect(src).toContain('<SubcardQueryError q={lock} what="device lock status" />');
    expect(src).toContain('<SubcardQueryError q={categories} what="categories" />');
    expect(src).toContain('<SubcardQueryError q={paydays} what="paydays" />');
    expect(src).toContain('<SubcardQueryError q={diagnostics} what="hub diagnostics" />');
    expect(src).toContain('<SubcardQueryError q={detect} what="hub detection" />');
  });
});
