import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ConfirmDialog must stay open while the delete/remove mutation is in flight and
 * only close on success — run-130 found budgets closed the dialog (setConfirmDelete(null))
 * inside onConfirm BEFORE the mutation resolved, so the busy spinner never showed and any
 * error was silently swallowed. Same latent bug existed in accounts / transactions / plan /
 * settings. These guards fail the build if any of those dialogs re-close early inside onConfirm.
 */
const paths = {
  accounts: "src/app/(app)/accounts/page.tsx",
  transactions: "src/app/(app)/transactions/page.tsx",
  plan: "src/app/(app)/plan/page.tsx",
  settings: "src/app/(app)/settings/page.tsx",
} as const;

function dialogFragment(src: string, title: string): string {
  const start = src.indexOf(`title="${title}"`);
  if (start < 0) throw new Error(`dialog title not found: ${title}`);
  // ConfirmDialog is a self-closing component; slice to its closing />
  const end = src.indexOf("/>", start);
  if (end < 0) throw new Error(`dialog close not found: ${title}`);
  return src.slice(start, end);
}

function onConfirmBody(fragment: string): string {
  const oc = fragment.indexOf("onConfirm={() => {");
  if (oc < 0) throw new Error("onConfirm not found in fragment");
  let i = fragment.indexOf("{", oc) + 1;
  let depth = 1;
  for (; i < fragment.length && depth > 0; i++) {
    if (fragment[i] === "{") depth++;
    else if (fragment[i] === "}") depth--;
  }
  return fragment.slice(oc, i);
}

describe("confirm dialog stays open through the request", () => {
  it("accounts: remove closes only on success and surfaces errors", () => {
    const src = readFileSync(path.resolve(__dirname, "../", paths.accounts), "utf8");
    // the dialog's onConfirm does NOT close the dialog itself
    const dlg = onConfirmBody(dialogFragment(src, "Remove account?"));
    expect(dlg).not.toContain("setConfirmDelete(null)");
    // the mutation closes on success and sets an error on failure
    expect(src).toMatch(/onSuccess: async \(\) => \{\s*setConfirmDelete\(null\);/);
    expect(src).toMatch(/onError: \(e\) =>\s*setConfirmDelete\(\(c\)/);
  });

  it("transactions: remove closes only on success and surfaces errors", () => {
    const src = readFileSync(path.resolve(__dirname, "../", paths.transactions), "utf8");
    const dlg = onConfirmBody(dialogFragment(src, "Delete transaction?"));
    expect(dlg).not.toContain("setConfirmDelete(null)");
    expect(src).toMatch(/onSuccess: \(\) => \{\s*setConfirmDelete\(null\);\s*invalidate\(\);/);
    expect(src).toMatch(/onError: \(e\) =>\s*setConfirmDelete\(\(c\)/);
  });

  it("plan: all three removes close only on success and surface errors", () => {
    const src = readFileSync(path.resolve(__dirname, "../", paths.plan), "utf8");
    // plan's title is a JSX expression (Delete ${kind}?), not a string literal — match by marker
    const start = src.indexOf("Delete ${confirmDelete.kind}");
    if (start < 0) throw new Error("plan dialog title not found");
    const fragEnd = src.indexOf("/>", start);
    const dlg = onConfirmBody(src.slice(start, fragEnd));
    expect(dlg).not.toContain("setConfirmDelete(null)");
    for (const kind of ["bill", "debt", "goal"]) {
      const m = src.indexOf(`remove${kind[0].toUpperCase()}${kind.slice(1)} = useMutation(`);
      expect(m).toBeGreaterThan(-1);
      // brace-matched slice of the whole mutation object
      let i = src.indexOf("{", m) + 1;
      let depth = 1;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
      }
      const body = src.slice(m, i);
      expect(body).toContain("setConfirmDelete(null)");
      expect(body).toContain("invalidate()");
    }
  });

  it("settings: logout-all and remove-item close only on success", () => {
    const src = readFileSync(path.resolve(__dirname, "../", paths.settings), "utf8");
    const logout = onConfirmBody(dialogFragment(src, "Sign out everywhere?"));
    expect(logout).not.toContain("setConfirmLogoutAll(false)");
    expect(src).toMatch(/onSuccess: \(\) => \{\s*setConfirmLogoutAll\(false\);\s*window\.location\.href = "\/login";/);
    const rm = onConfirmBody(dialogFragment(src, "Remove this bank connection?"));
    expect(rm).not.toContain("setConfirmRemoveItem(null)");
    expect(src).toMatch(/onSuccess: \(\) => \{\s*setConfirmRemoveItem\(null\);/);
  });
});
