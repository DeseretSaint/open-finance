import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("settings page fetch error handling", () => {
  const src = read("src/app/(app)/settings/page.tsx");

  it("collects failed top-level queries gated on no-data so rendered settings are never blanked", () => {
    // me / sessions / creds / items are covered by the failure sweep
    expect(src).toContain("[me, sessions, creds, items]");
    // gated on isError && !data (background refetch errors don't blank settings)
    expect(src).toContain("q.isError && !q.data");
  });

  it("renders an alert banner with a retry button wired to refetch", () => {
    expect(src).toContain('role="alert"');
    expect(src).toContain("Couldn't load your settings");
    expect(src).toContain("onClick={() => settingsFailed.forEach((q) => q.refetch())}");
    expect(src).toContain("disabled={settingsRetrying}");
    expect(src).toContain('{settingsRetrying ? "Retrying…" : "Try again"}');
  });
});
