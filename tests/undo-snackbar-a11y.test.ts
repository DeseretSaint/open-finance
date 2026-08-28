import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/components/ui/undo-snackbar.tsx"),
  "utf8",
);

describe("UndoSnackbar accessibility (WCAG 2.2.1 + M3)", () => {
  it("pauses the auto-dismiss timer on hover and focus", () => {
    expect(src).toContain("onMouseEnter={() => setPaused(true)}");
    expect(src).toContain("onMouseLeave={() => setPaused(false)}");
    expect(src).toContain("onFocus={() => setPaused(true)}");
    expect(src).toContain("onBlur={() => setPaused(false)}");
  });

  it("skips the dismiss timeout while paused and resets paused on close", () => {
    expect(src).toContain("if (!open || paused) return;");
    expect(src).toContain("if (!open) setPaused(false);");
  });

  it("gives the Undo action a >=44px touch target", () => {
    expect(src).toMatch(/min-h-11 min-w-11[^"]*shrink-0/);
  });
});
