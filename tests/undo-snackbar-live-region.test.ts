import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/ui/undo-snackbar.tsx", "utf8");

describe("UndoSnackbar live region", () => {
  it("keeps the aria-live region mounted (no early return on !open)", () => {
    expect(src).not.toMatch(/if\s*\(\s*!open\s*\)\s*return null/);
  });

  it("gates only the inner bar on open", () => {
    expect(src).toContain("{!open ? null : (");
  });

  it("still declares the polite status region", () => {
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
  });
});
