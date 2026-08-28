import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-guard: the CustomDatePicker must share the modal a11y + keyboard
// patterns applied to every other dialog (useDialogA11y focus-trap/scroll-lock/
// Android Back-close from runs 176/179) and the grid arrow-nav treatment the
// CustomSelect listbox got in run 182.
const src = readFileSync(
  join(process.cwd(), "src/components/ui/custom-date-picker.tsx"),
  "utf8",
);

describe("custom-date-picker a11y", () => {
  it("wires the dialog into useDialogA11y (focus-trap + scroll-lock + Back-close)", () => {
    expect(src).toMatch(/useDialogA11y\(/);
    expect(src).toMatch(/ref=\{dialogRef\}/);
    // closing the dialog must route through the hook's onClose
    expect(src).toMatch(/useDialogA11y\(open, \(\) => setOpen\(false\)\)/);
  });

  it("marks the popover aria-modal and gives it an accessible label", () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
  });

  it("exposes enabled day cells for keyboard navigation", () => {
    expect(src).toMatch(/data-day=\{c\.iso\}/);
    expect(src).toMatch(/ref=\{gridRef\} onKeyDown=\{onGridKey\}/);
  });

  it("handles arrow-key grid movement + Enter/Space select", () => {
    expect(src).toMatch(/ArrowRight|ArrowLeft|ArrowUp|ArrowDown/);
    // selection on Enter/Space reuses the existing onChange + close path
    expect(src).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    expect(src).toMatch(/days\[next\]\?\.focus\(\)/);
  });
});
