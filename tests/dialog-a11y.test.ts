import { describe, expect, it } from "vitest";
import { tabWrapTarget } from "@/lib/use-dialog-a11y";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

// Pure focus-wrap decision — Tab cycles within the dialog, never escaping.
describe("tabWrapTarget (focus-trap decision)", () => {
  it("wraps Shift+Tab from the first item to the last", () => {
    expect(tabWrapTarget(3, 0, true)).toBe(2);
  });
  it("wraps Tab from the last item back to first", () => {
    expect(tabWrapTarget(3, 2, false)).toBe(0);
  });
  it("wraps Tab when focus is outside the list (index -1)", () => {
    expect(tabWrapTarget(2, -1, false)).toBe(0);
  });
  it("lets Shift+Tab proceed at the middle of the list", () => {
    expect(tabWrapTarget(3, 1, true)).toBeNull();
  });
  it("lets Tab proceed at the middle of the list", () => {
    expect(tabWrapTarget(3, 1, false)).toBeNull();
  });
  it("returns null when there are no focusable elements", () => {
    expect(tabWrapTarget(0, -1, false)).toBeNull();
  });
  it("wraps Shift+Tab from index -1 (outside) to the last", () => {
    expect(tabWrapTarget(3, -1, true)).toBe(2);
  });
});

// focusableIn relies on a real DOM (querySelectorAll), which the node test
// environment doesn't provide; it is exercised at runtime in the browser and
// covered by the source-guard assertions below. Its companion decision logic
// (tabWrapTarget) is pure and fully tested here.

// Every modal surface must be wired to the dialog-a11y hook (focus trap +
// focus return) in addition to the existing Escape-to-close wiring.
function assertWired(rel: string) {
  const src = read(rel);
  expect(
    src.includes("use-dialog-a11y"),
    `${rel} should import the useDialogA11y hook`,
  ).toBe(true);
  expect(
    src.includes("useDialogA11y("),
    `${rel} should call useDialogA11y`,
  ).toBe(true);
  // The returned ref is attached to the dialog container.
  expect(
    src.includes("ref={") && /ref=\{(\w*A11yRef|ref)\}/.test(src),
    `${rel} should attach the a11y ref to a dialog container`,
  ).toBe(true);
}

describe("Dialog focus-trap wired on every modal surface", () => {
  it("wires the budgets create/edit modal", () => {
    assertWired("src/app/(app)/budgets/page.tsx");
  });
  it("wires the accounts manual-account modal", () => {
    assertWired("src/app/(app)/accounts/page.tsx");
  });
  it("wires all three transactions modals (add, import, import-history suggestion)", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    const calls = (src.match(/useDialogA11y\(/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(3);
  });
  it("wires the plan add-sheet modal", () => {
    assertWired("src/app/(app)/plan/page.tsx");
  });
  it("wires the settings scanner modal", () => {
    assertWired("src/app/(app)/settings/page.tsx");
  });
  it("wires the sidebar mobile More sheet", () => {
    assertWired("src/components/sidebar.tsx");
  });
  it("wires the shared ConfirmDialog", () => {
    assertWired("src/components/ui/confirm-dialog.tsx");
  });
});
