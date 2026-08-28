import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-guard: the "Budget time frame" control is an ARIA tablist
// (role=tablist / role=tab / aria-selected) but had no keyboard navigation or
// roving tabindex — unlike the CustomSelect listbox (run 182) and date/time
// pickers (runs 184/187) which already follow the WAI-ARIA APG pattern. This
// guards that the tabs are arrow-key navigable with only the active tab in the
// tab sequence.
const src = readFileSync(
  join(process.cwd(), "src/app/(app)/budgets/page.tsx"),
  "utf8",
);

describe("budgets frame tablist a11y", () => {
  it("uses a roving tabindex (only the active tab sits in the tab sequence)", () => {
    // pill tabs
    expect(src).toMatch(/tabIndex=\{frame === kind \? 0 : -1\}/);
    // custom tab
    expect(src).toMatch(/tabIndex=\{frame === "custom" \? 0 : -1\}/);
  });

  it("wires arrow-key / Home / End navigation onto the tabs", () => {
    // pill buttons call onFrameKeyDown with their index
    expect(src).toMatch(/onKeyDown=\{\(e\) => onFrameKeyDown\(e, i\)\}/);
    // custom button calls it with the last index
    expect(src).toMatch(/onFrameKeyDown\(e, FRAME_PILLS\.length\)/);
    // handler handles the full APG key set
    expect(src).toMatch(/e\.key === "ArrowRight" \|\| e\.key === "ArrowDown"/);
    expect(src).toMatch(/e\.key === "ArrowLeft" \|\| e\.key === "ArrowUp"/);
    expect(src).toMatch(/e\.key === "Home"/);
    expect(src).toMatch(/e\.key === "End"/);
  });

  it("keeps focus on the newly-selected tab", () => {
    expect(src).toMatch(/frameTabRefs\.current\[next\]\?\.focus\(\)/);
    // both tab groups register their refs into the same roving array
    expect(src).toMatch(/frameTabRefs\.current\[i\] = el/);
    expect(src).toMatch(/frameTabRefs\.current\[FRAME_PILLS\.length\] = el/);
  });
});
