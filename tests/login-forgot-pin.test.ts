import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/app/login/page.tsx"), "utf8");

describe("login forgot-PIN recovery (solo)", () => {
  it("offers a Forgot your PIN? toggle", () => {
    expect(src).toContain("Forgot your PIN?");
    expect(src).toContain("setShowRecovery((v) => !v)");
  });

  it("posts the recovery code + new PIN to the existing solo recovery endpoint", () => {
    expect(src).toMatch(/api\.post\("\/api\/auth\/recovery",\s*\{\s*recovery_code:\s*recoveryCode\.trim\(\),\s*new_pin:\s*newPin\s*\}\)/);
  });

  it("prefills the PIN field with the new PIN after a successful reset", () => {
    expect(src).toContain("setPin(newPin)");
    expect(src).toContain("PIN reset — sign in with your new PIN.");
  });

  it("gates the reset button on a plausible code + PIN length", () => {
    expect(src).toContain("recoveryCode.trim().length < 8 || newPin.length < 4");
  });

  it("keeps the recovery panel out of the outer form (no nested <form>)", () => {
    // The recovery panel is a <div> with a type="button" reset trigger —
    // a nested <form> inside the login form would be invalid HTML.
    expect(src).not.toMatch(/<form onSubmit=\{submitRecovery\}/);
    expect(src).toContain("onClick={submitRecovery}");
  });

  it("announces the reset result via a live region", () => {
    expect(src).toMatch(/role="status"[\s\S]*?\{recoveryMsg\}/);
  });
});
