import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Agent permission-request UX (make Grant/Deny understandable): each pending
 * request must explain WHAT DATA the requested scope grants and WHY (which tool
 * asked + when), so a human can decide with context instead of a raw scope badge.
 * The page is a client component and can't be rendered in node without a DOM, so
 * these are source-level guards (matches the reports-trend-chart/onboarding-demo pattern).
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/agents/page.tsx"), "utf8");

const SCOPES = [
  "read:summary", "read:banking", "read:investments", "read:budgets",
  "read:planning", "read:reports", "transactions:edit", "budgets:write",
  "planning:write", "categories:write", "settings:write", "sync:run", "dev:ui",
];

describe("agent permission-request UX is understandable", () => {
  it("maps every scope to a plain-language data description", () => {
    expect(src).toMatch(/const SCOPE_INFO:/);
    for (const s of SCOPES) {
      expect(src).toContain(`"${s}"`);
    }
  });

  it("shows the human-readable scope description next to each Grant/Deny request", () => {
    expect(src).toContain("SCOPE_INFO[r.scope]");
  });

  it("explains who is asking and when (tool + requested time)", () => {
    expect(src).toContain("Wants to use:");
  });
});
