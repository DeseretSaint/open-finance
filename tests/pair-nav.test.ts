import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pair page (mobile phone pairing, P8a §10.4) fresh-eyes UX gap (run 174):
 * scan mode (camera) was a one-way street — the ONLY escape back to manual
 * type-entry was camera failure auto-switching the mode. Type mode already had
 * a "Scan QR instead" toggle, so the path was asymmetric: a user with a working
 * camera who wanted to type the code by hand was stuck. Added a "Type code
 * instead" button in the scan-mode block (mirrors the existing type→scan toggle).
 */

describe("pair page scan/type navigation symmetry", () => {
  const src = readFileSync(join(process.cwd(), "src/app/pair/page.tsx"), "utf8");

  it("scan mode offers a way back to manual type-entry", () => {
    // the scan-mode block must render a 'Type code instead' toggle
    expect(src).toMatch(/\{\!importMode && mode === "scan"[\s\S]*?Type code instead/);
  });

  it("type mode still offers a way back to scanning", () => {
    expect(src).toMatch(/\{\!importMode && mode === "type"[\s\S]*?Scan QR instead/);
  });

  it("both toggles call setMode with the opposite mode", () => {
    expect(src).toMatch(/onClick=\{\(\) => setMode\("type"\)\}/);
    expect(src).toMatch(/onClick=\{\(\) => setMode\("scan"\)\}/);
  });
});
