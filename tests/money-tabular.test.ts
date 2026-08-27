import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "src/components/money.tsx"), "utf8");

describe("Money tabular-nums", () => {
  it("applies the money class (tabular-nums) in every render branch", () => {
    // unsigned negative, unsigned non-negative, and signed all include "money"
    expect(SRC).toContain('cents < 0 ? "money text-danger" : "money"');
    expect(SRC).toContain(': "money"');
  });

  it("signed mode sets no semantic color (callers own it)", () => {
    // the signed branch must not add text-danger/text-success
    const signedBranch = SRC.match(/: "money";/);
    expect(signedBranch).not.toBeNull();
    expect(SRC).not.toContain('"money text-success"');
  });

  it("globals.css still defines .money as tabular-nums", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.money\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });
});
