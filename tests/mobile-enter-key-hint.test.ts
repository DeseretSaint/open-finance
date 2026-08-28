import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Native-mobile money-entry surfaces: the on-screen keyboard's action key must
// read "Done" (enterKeyHint="done") so a single tap submits the form instead of
// showing the default "return". Mirrors the calm-fintech mobile-first pattern.
describe("money-entry + PIN inputs use enterKeyHint=done", () => {
  const cases: Array<[string, string]> = [
    ["device-lock PIN", "src/components/device-lock-gate.tsx"],
    ["budget amount", "src/app/(app)/budgets/page.tsx"],
    ["transaction add amount", "src/app/(app)/transactions/page.tsx"],
    ["transaction edit amount", "src/app/(app)/transactions/page.tsx"],
    ["account balance", "src/app/(app)/accounts/page.tsx"],
  ];
  for (const [name, file] of cases) {
    it(`${name} (${file})`, () => {
      const src = read(file);
      expect(src).toContain('enterKeyHint="done"');
    });
  }

  it("device-lock PIN pairs enterKeyHint with the numeric inputMode", () => {
    const src = read("src/components/device-lock-gate.tsx");
    expect(src).toContain('inputMode="numeric"');
    expect(src).toContain('enterKeyHint="done"');
  });
});
