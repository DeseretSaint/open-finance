import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const snack = readFileSync("src/components/ui/undo-snackbar.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

describe("undo snackbar placement (M3: above the bottom nav, non-blocking)", () => {
  it("uses the .of-snackbar offset class instead of bottom-0", () => {
    expect(snack).toContain("of-snackbar");
    expect(snack).not.toContain("bottom-0");
  });

  it("does not intercept taps outside the snackbar bar", () => {
    expect(snack).toContain("pointer-events-none");
    expect(snack).toContain("pointer-events-auto");
  });

  it("globals.css clears the mobile tab bar and resets at >=md", () => {
    expect(css).toMatch(/\.of-snackbar\s*\{[^}]*bottom:\s*calc\(56px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/@media \(min-width: 768px\) \{\s*\.of-snackbar\s*\{\s*bottom:\s*1rem/);
  });
});
