import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-guard: the CustomTimePicker must share the modal a11y patterns applied
// to every other dialog (useDialogA11y focus-trap/scroll-lock/Android Back-close
// from runs 176/179) and the keyboard list-nav the CustomSelect listbox /
// CustomDatePicker grid got (runs 182/184).
const src = readFileSync(
  join(process.cwd(), "src/components/ui/custom-time-picker.tsx"),
  "utf8",
);

describe("custom-time-picker a11y", () => {
  it("wires the dialog into useDialogA11y (focus-trap + scroll-lock + Back-close)", () => {
    expect(src).toMatch(/useDialogA11y\(/);
    expect(src).toMatch(/ref=\{dialogRef\}/);
    // closing the dialog must route through the hook's onClose
    expect(src).toMatch(/useDialogA11y\(open, \(\) => setOpen\(false\)\)/);
  });

  it("marks the popover aria-modal and gives it an accessible label", () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/aria-label="Pick a time"/);
  });

  it("exposes each column for keyboard navigation", () => {
    // three columns (hour / minute / period) wire onKeyDown={onListKey}
    const hits = src.match(/onKeyDown=\{onListKey\}/g);
    expect(hits?.length ?? 0).toBe(3);
  });

  it("handles arrow-key list movement + Home/End", () => {
    expect(src).toMatch(/ArrowDown|ArrowUp/);
    expect(src).toMatch(/Home|End/);
    expect(src).toMatch(/items\[next\]\?\.focus\(\)/);
  });
});
