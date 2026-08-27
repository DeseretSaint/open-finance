import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Net-worth trend chart guards (run-9 step 5): the reports page must surface
 * the balance_history series that sync/solo-sync/createManual/seed now write
 * (runs 19/21/29). The endpoint /api/reports/net-worth/trend was live-verified
 * in runs 21/29; these source-level guards lock the frontend wiring (the page
 * is a client component and can't be rendered in node without a full DOM).
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/reports/page.tsx"), "utf8");

describe("reports page net-worth trend chart", () => {
  it("queries the trend endpoint (6 months, includeExcluded-aware)", () => {
    expect(src).toContain("/api/reports/net-worth/trend?months=6");
    expect(src).toContain('["reports", "net-worth-trend", includeExcluded]');
    expect(src).toContain('includeExcluded ? "&includeExcluded=1" : ""');
  });

  it("does not send includePending to the trend endpoint (points are sync-time snapshots)", () => {
    const urlLine = src.slice(
      src.indexOf("/api/reports/net-worth/trend?months=6"),
      src.indexOf("/api/reports/net-worth/trend?months=6") + 90
    );
    expect(urlLine).not.toContain("includePending");
  });

  it("renders Net / Assets / Liabilities lines with the design tokens", () => {
    expect(src).toContain('dataKey="Net" stroke="var(--accent)"');
    expect(src).toContain('dataKey="Assets" stroke="var(--success)"');
    expect(src).toContain('dataKey="Liabilities" stroke="var(--danger)"');
  });

  it("maps cents to dollars for all three series", () => {
    expect(src).toContain("Net: r.netCents / 100");
    expect(src).toContain("Assets: r.assetsCents / 100");
    expect(src).toContain("Liabilities: r.liabilitiesCents / 100");
  });

  it("shows next-action guidance when there is no balance history", () => {
    expect(src).toContain("No balance history yet — sync a bank or add an account to start tracking.");
  });

  it("places the trend card AFTER the net-worth stat cards", () => {
    const cards = src.indexOf("<CardLabel>Net worth</CardLabel>");
    const chart = src.indexOf("Net worth trend — last 6 months");
    expect(cards).toBeGreaterThan(-1);
    expect(chart).toBeGreaterThan(cards);
  });
});
