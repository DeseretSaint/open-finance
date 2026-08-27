import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("password visibility toggle", () => {
  it("PasswordInput renders a show/hide toggle with aria semantics", () => {
    const src = read("src/components/ui/password-input.tsx");
    expect(src).toContain('type={visible ? "text" : "password"}');
    expect(src).toContain('aria-label={visible ? "Hide password" : "Show password"}');
    expect(src).toContain("aria-pressed={visible}");
    expect(src).toContain('type="button"');
  });

  it("login password uses PasswordInput", () => {
    const src = read("src/app/login/page.tsx");
    expect(src).toContain('import { PasswordInput } from "@/components/ui/password-input"');
    expect(src).toMatch(/<PasswordInput\s+id="login-password"/);
    // device PIN pad stays masked (no toggle)
    expect(src).toMatch(/id="login-pin"[\s\S]{0,80}type="password"/);
  });

  it("register password uses PasswordInput", () => {
    const src = read("src/app/register/page.tsx");
    expect(src).toContain('import { PasswordInput } from "@/components/ui/password-input"');
    expect(src).toMatch(/<PasswordInput\s+id="reg-password"/);
  });

  it("pair hub-password uses PasswordInput; phone PIN stays masked", () => {
    const src = read("src/app/pair/page.tsx");
    expect(src).toContain('import { PasswordInput } from "@/components/ui/password-input"');
    expect(src).toMatch(/<PasswordInput value=\{importPassword\}/);
    expect(src).toMatch(/<Input type="password" inputMode="numeric" value=\{importPin\}/);
  });

  it("settings passwords + Plaid secret use PasswordInput; PIN fields stay masked", () => {
    const src = read("src/app/(app)/settings/page.tsx");
    expect(src).toContain('import { PasswordInput } from "@/components/ui/password-input"');
    expect(src).toMatch(/<PasswordInput aria-label=\{"Current password"\}/);
    expect(src).toMatch(/<PasswordInput aria-label=\{"New password"\}/);
    expect(src).toMatch(/<PasswordInput aria-label=\{"Plaid secret"\}/);
    expect(src).toMatch(/<PasswordInput aria-label=\{"Account password"\}/);
    // PIN pads (New PIN, Unlock PIN, Phone device PIN) stay masked
    expect(src).toMatch(/aria-label=\{"New PIN"\}[\s\S]{0,60}type="password"/);
    expect(src).toMatch(/aria-label=\{"Unlock PIN"\}[\s\S]{0,60}type="password"/);
  });

  it("onboarding Plaid secret uses PasswordInput; PIN pads stay masked", () => {
    const src = read("src/components/onboarding-wizard.tsx");
    expect(src).toContain('import { PasswordInput } from "@/components/ui/password-input"');
    expect(src).toMatch(/<PasswordInput aria-label=\{"Plaid secret"\}/);
    expect(src).toMatch(/aria-label=\{"New PIN"\}[\s\S]{0,60}type="password"/);
    expect(src).toMatch(/aria-label=\{"Confirm PIN"\}[\s\S]{0,60}type="password"/);
  });
});
