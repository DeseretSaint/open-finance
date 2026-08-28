import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pre-auth surfaces (login / demo) were never in SLOT-B's error+busy sweep
 * (run-150..170 covered the 8 in-app pages, review-widget, sub-cards, register
 * recovery-copy). Fresh-eyes run found two real gaps:
 *  1. login's biometric "Unlock with biometrics" button was disabled only on its
 *     own `bioBusy`, so a quick tap could fire a concurrent /api/device-lock/biometric
 *     while the PIN `submit` (busy) was already in flight — two simultaneous unlock
 *     calls. Now guarded by `bioBusy || busy`.
 *  2. demo's error text had no role="alert" (inconsistent with every other error
 *     surface); screen readers now announce the demo-unavailable message.
 */

describe("pre-auth busy + a11y guards", () => {
  it("login biometric button is disabled while the PIN submit is in flight", () => {
    const src = readFileSync(join(process.cwd(), "src/app/login/page.tsx"), "utf8");
    expect(src).toMatch(
      /onClick=\{unlockWithBiometric\} disabled=\{bioBusy \|\| busy\}/,
    );
  });

  it("login form exposes aria-busy so assistive tech knows submit is pending", () => {
    const src = readFileSync(join(process.cwd(), "src/app/login/page.tsx"), "utf8");
    expect(src).toContain('<form onSubmit={submit} aria-busy={busy}');
  });

  it("demo error is announced via role=\"alert\"", () => {
    const src = readFileSync(join(process.cwd(), "src/app/demo/page.tsx"), "utf8");
    expect(src).toMatch(/\{error && <p role="alert"[\s\S]*?\{error\}<\/p>\}/);
  });
});
