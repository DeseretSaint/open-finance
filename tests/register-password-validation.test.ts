import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Register password inline validation UX: a password that violates the
 * server-side policy (src/server/auth/password.ts validatePasswordPolicy) is
 * caught inline — with an aria-visible alert — and blocks submit, instead of
 * round-tripping to a generic 400. Mirrors the budget/transaction/account
 * amount-validation pattern. The page is a client component (can't render in
 * node without a DOM), so these are source-level guards.
 */
const src = readFileSync(
  path.resolve(__dirname, "../src/app/register/page.tsx"),
  "utf8"
);

describe("register password validation UX", () => {
  it("mirrors the server policy for too-long / same-as-username / common", () => {
    expect(src).toContain("Password must be at most 72 bytes.");
    expect(src).toContain("Password cannot be the same as your username.");
    expect(src).toContain("That password is too common — choose a unique one.");
  });

  it("blocks submit while the password is invalid", () => {
    expect(src).toContain(
      'disabled={busy || (!solo && (!username || !password || !!passwordError))}'
    );
  });

  it("marks the password input invalid when there is an error", () => {
    expect(src).toContain("aria-invalid={!!passwordError}");
  });

  it("surfaces the error as an accessible alert", () => {
    expect(src).toContain('role="alert" className="mt-1.5 text-xs text-danger">{passwordError}');
  });
});
