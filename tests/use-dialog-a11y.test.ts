import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source guard (node env): the shared dialog a11y hook must lock background
// scroll while open so the underlying page can't drift behind a mobile sheet,
// and must restore the prior overflow on close. This covers all 10 dialogs
// that wire the hook (budgets/accounts/transactions/plan/settings/sidebar).
const src = readFileSync(join(process.cwd(), "src/lib/use-dialog-a11y.ts"), "utf8");

describe("useDialogA11y — background scroll lock (source guard)", () => {
  it("declares a body-scroll-lock helper called by the hook", () => {
    expect(src).toMatch(/useBodyScrollLock\(open\)/);
    expect(src).toMatch(/function useBodyScrollLock\(open:\s*boolean\)/);
  });

  it("sets overflow hidden while open and restores the prior value on close", () => {
    expect(src).toMatch(/document\.body\.style\.overflow\s*=\s*"hidden"/);
    // Restore branch must reassign from the captured previous value.
    expect(src).toMatch(/document\.body\.style\.overflow\s*=\s*prev/);
  });
});

describe("useDialogA11y — Android hardware Back-to-close (source guard, run 179)", () => {
  it("registers a Capacitor backButton listener that closes only the topmost open dialog", () => {
    expect(src).toMatch(/App\.addListener\("backButton"/);
    expect(src).toMatch(/const openDialogs:\s*Array<\(\)\s*=>\s*void>/);
    // The handler closes only the TOPMOST (last-pushed) entry, not all.
    expect(src).toMatch(/const top = openDialogs\[openDialogs\.length - 1\]/);
    expect(src).toMatch(/openDialogs\.pop\(\)/);
  });

  it("registers the listener only while a dialog is open and tears it down when the stack empties", () => {
    // Guarded to native platforms (no-op on plain web) and to open dialogs
    // that passed onClose — so in-app back navigation is never hijacked.
    expect(src).toMatch(/isNativePlatform\(\)/);
    expect(src).toMatch(/if \(!open \|\| !onClose\) return;/);
    expect(src).toMatch(/void ensureBackListener\(\)/);
    expect(src).toMatch(/if \(openDialogs\.length === 0\) removeBackListener\(\)/);
  });

  it("hooks push a stable close closure and drop it on close (no duplicate stack entries)", () => {
    expect(src).toMatch(/const close = \(\) => onCloseRef\.current\?\.\(\)/);
    expect(src).toMatch(/openDialogs\.push\(close\)/);
    expect(src).toMatch(/const i = openDialogs\.indexOf\(close\)/);
  });
});
