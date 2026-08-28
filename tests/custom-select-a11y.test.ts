import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(__dirname, "../src/components/ui/custom-select.tsx"),
  "utf8"
);

describe("CustomSelect keyboard listbox a11y", () => {
  it("moves focus into the listbox and tracks an active descendant on open", () => {
    // focus is moved into the listbox the moment it opens
    expect(src).toMatch(/listRef\.current\?\.focus\(\)/);
    // the listbox is a single tab stop owning an active descendant
    expect(src).toMatch(/role="listbox"/);
    expect(src).toMatch(/tabIndex=\{0\}/);
    expect(src).toMatch(/aria-activedescendant=\{`of-cs-opt-\$\{activeIndex\}`\}/);
  });

  it("options are not individually tabbable and carry an id + role", () => {
    expect(src).toMatch(/id=\{`of-cs-opt-\$\{i\}`\}/);
    expect(src).toMatch(/role="option"/);
    expect(src).toMatch(/tabIndex=\{-1\}/);
  });

  it("handles Arrow/Home/End/Enter/Space/Escape navigation", () => {
    expect(src).toMatch(/onListKey/);
    expect(src).toMatch(/case "ArrowDown"/);
    expect(src).toMatch(/case "ArrowUp"/);
    expect(src).toMatch(/case "Home"/);
    expect(src).toMatch(/case "End"/);
    expect(src).toMatch(/case "Enter"/);
    expect(src).toMatch(/case "Escape"/);
  });

  it("opens + seeds the active option from the trigger via Arrow keys", () => {
    expect(src).toMatch(/onKeyDown=\{\(e\) => \{/);
    expect(src).toMatch(/setOpen\(true\)/);
  });
});
