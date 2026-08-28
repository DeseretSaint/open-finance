import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/ui/undo-snackbar.tsx", "utf8");

describe("UndoSnackbar auto-dismiss timer stability", () => {
  it("timer effect does not depend on callback identities (inline arrows would restart it every parent render)", () => {
    const dep = src.match(/\}, \[open, paused, duration\]\);/);
    expect(dep).not.toBeNull();
    expect(src).not.toMatch(/\}, \[open, paused, duration, onClose\]\);/);
  });

  it("uses refs for onClose/onUndo so the latest callbacks still run", () => {
    expect(src).toContain("onCloseRef");
    expect(src).toContain("onUndoRef");
    expect(src).toContain("setTimeout(() => onCloseRef.current(), duration)");
    expect(src).toContain("onUndoRef.current()");
  });
});
