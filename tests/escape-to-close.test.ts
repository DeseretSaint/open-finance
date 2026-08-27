import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every modal / dialog surface must be dismissible with the Escape key
// (WAI-ARIA dialog pattern). This guards that regression — a shared
// `useEscapeToClose` hook is imported and actually called in each surface.
const root = join(process.cwd());

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assertWired(rel: string, label: string) {
  const src = read(rel);
  expect(
    src.includes("use-escape-to-close"),
    `${rel} should import the useEscapeToClose hook`,
  ).toBe(true);
  expect(
    src.includes("useEscapeToClose("),
    `${rel} (${label}) should call useEscapeToClose`,
  ).toBe(true);
}

describe("Escape-to-close on every modal surface", () => {
  it("wires the budgets create/edit modal", () => {
    assertWired("src/app/(app)/budgets/page.tsx", "budgets");
  });

  it("wires the accounts manual-account modal", () => {
    assertWired("src/app/(app)/accounts/page.tsx", "accounts");
  });

  it("wires all three transactions modals (add, import, import-history suggestion)", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    const calls = (src.match(/useEscapeToClose\(/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("wires the plan add sheet + paydays sheet", () => {
    const src = read("src/app/(app)/plan/page.tsx");
    const calls = (src.match(/useEscapeToClose\(/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("wires the settings add-category + plaid-help modals", () => {
    const src = read("src/app/(app)/settings/page.tsx");
    const calls = (src.match(/useEscapeToClose\(/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("wires the sidebar mobile 'More' sheet", () => {
    assertWired("src/components/sidebar.tsx", "sidebar more sheet");
  });

  it("wires the shared ConfirmDialog (respects busy guard)", () => {
    const src = read("src/components/ui/confirm-dialog.tsx");
    expect(src).toContain("use-escape-to-close");
    expect(src).toContain("useEscapeToClose(() => { if (!busy) onCancel(); }, open);");
  });
});
