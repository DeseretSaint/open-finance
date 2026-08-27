import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// PIN fields are numeric device PINs, not account passwords. Without autoComplete="off",
// browsers/password-managers hijack them with save/autofill prompts (real mobile UX bug).
const wizard = readFileSync("src/components/onboarding-wizard.tsx", "utf8");
const settings = readFileSync("src/app/(app)/settings/page.tsx", "utf8");

function pinInputs(src: string): string[] {
  // grab each <Input ... /> block that is a numeric PIN field
  return [...src.matchAll(/<Input\b[^>]*type="password"[^>]*inputMode="numeric"[^>]*\/?>/g)].map((m) => m[0]);
}

describe("PIN field autocomplete", () => {
  it("onboarding wizard numeric PIN inputs opt out of password-manager autofill", () => {
    const pins = pinInputs(wizard);
    expect(pins.length).toBeGreaterThanOrEqual(2);
    for (const p of pins) expect(p).toContain('autoComplete="off"');
  });

  it("settings numeric PIN inputs opt out of password-manager autofill", () => {
    const pins = pinInputs(settings);
    expect(pins.length).toBeGreaterThanOrEqual(3);
    for (const p of pins) expect(p).toContain('autoComplete="off"');
  });

  it("real account-password fields keep password-manager behavior (no autoComplete=off)", () => {
    // settings current/new password inputs are real passwords — must NOT be opted out
    const currentPw = settings.match(/placeholder="Current password"[^>]*\/?>/);
    const newPw = settings.match(/placeholder="New password"[^>]*\/?>/);
    if (currentPw) expect(currentPw[0]).not.toContain('autoComplete="off"');
    if (newPw) expect(newPw[0]).not.toContain('autoComplete="off"');
  });
});
