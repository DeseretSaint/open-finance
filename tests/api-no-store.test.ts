import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * API responses carry financial data (transactions, accounts, the backup
 * download) and must never be persisted by browsers or intermediate proxies.
 * next.config.ts applies a global `Cache-Control: no-store` to /api/*; this
 * source guard keeps that header from being dropped in a config refactor.
 */
const src = fs.readFileSync(
  path.join(__dirname, "..", "next.config.ts"),
  "utf8",
);

describe("api no-store cache-control", () => {
  it("applies Cache-Control no-store to /api/*", () => {
    expect(src).toContain('source: "/api/:path*"');
    expect(src).toMatch(/key:\s*"Cache-Control",\s*value:\s*"no-store"/);
  });
});
