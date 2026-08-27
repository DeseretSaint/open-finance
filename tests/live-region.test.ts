import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Success/confirmation messages must be announced to screen readers (role="status"
// => aria-live polite); error companions that previously rendered as plain text must
// be role="alert" (aria-live assertive). Regression guard for the run-71/72 a11y fix.
const files: Record<string, string> = {
  agents: join(process.cwd(), "src/app/(app)/agents/page.tsx"),
  onboarding: join(process.cwd(), "src/components/onboarding-wizard.tsx"),
  updates: join(process.cwd(), "src/components/updates-card.tsx"),
  pair: join(process.cwd(), "src/app/pair/page.tsx"),
};

const src = Object.fromEntries(
  Object.entries(files).map(([k, p]) => [k, readFileSync(p, "utf8")])
);

describe("live-region coverage", () => {
  it("agents success + error messages carry live regions", () => {
    const f = src.agents;
    // success: token created / remote-access updated
    expect(f).toMatch(/\{msg && <p role="status"/);
    expect(f).toMatch(/\{manualMsg && <p role="status"/);
    // error companions (create-token + remote-access) => alert
    expect(f).toMatch(/\{err && <p role="alert"/);
  });

  it("onboarding-wizard success + error messages carry live regions", () => {
    const f = src.onboarding;
    // every success <p> is now role=status (msg + Keys saved + linkedCount connected)
    expect(f).toMatch(/\{msg && !linkToken && <p role="status"/);
    expect(f).toMatch(/\{keysSaved && !msg && <p role="status"/);
    expect(f).toMatch(/\{linkedCount > 0 && <p role="status"/);
    // every err <p> is now role=alert (no bare text-danger <p> leftover)
    expect(f).not.toMatch(/\{err && <p className=/);
  });

  it("updates-card success + error messages carry live regions", () => {
    const f = src.updates;
    expect(f).toMatch(/\{msg && <p role="status"/);
    expect(f).toMatch(/\{err && <p role="alert"/);
  });

  it("pair page success + error messages carry live regions", () => {
    const f = src.pair;
    expect(f).toMatch(/\{msg && <p role="status"/);
    expect(f).toMatch(/\{err && <p role="alert"/);
  });
});
