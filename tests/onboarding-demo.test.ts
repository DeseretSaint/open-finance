import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.resolve(__dirname, "../src/components/onboarding-wizard.tsx"), "utf8");

describe("onboarding first-run demo-first path", () => {
  it("offers a demo-first sample-data entry on the welcome step", () => {
    expect(src).toMatch(/Or explore with sample data first/);
  });

  it("tryDemo logs into the seeded demo account via the existing demo endpoint", () => {
    expect(src).toMatch(/async function tryDemo\(\)/);
    expect(src).toMatch(/api\.post\("\/api\/auth\/demo"\)/);
  });

  it("labels the empty-account exit explicitly as Start fresh", () => {
    expect(src).toMatch(/>\s*Start fresh\s*</);
  });
});
