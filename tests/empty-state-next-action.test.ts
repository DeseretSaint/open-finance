import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Q11 (verified 2026-08-28, UI/UX Fleet): every core empty state must explain
// WHY it's empty, offer ONE primary CTA, and give a hint. These read the page
// source so the gate stays build-free (mirrors tests/page-headings.test.ts).
describe("core empty states explain WHY + CTA + hint (Q11)", () => {
  it("budgets empty state", () => {
    const src = read("src/app/(app)/budgets/page.tsx");
    expect(src).toContain("No budgets yet");
    expect(src).toContain("track spending and catch overages"); // WHY
    expect(src).toContain("Create your first one"); // CTA
    expect(src).toContain("below"); // hint
  });

  it("accounts empty state", () => {
    const src = read("src/app/(app)/accounts/page.tsx");
    expect(src).toContain("No accounts yet");
    expect(src).toContain("balances and transactions"); // WHY
    expect(src).toContain("Connect a bank"); // CTA
    expect(src).toContain("manual account"); // hint
  });

  it("transactions empty state", () => {
    const src = read("src/app/(app)/transactions/page.tsx");
    expect(src).toContain("No transactions yet");
    expect(src).toContain("Connect a bank"); // CTA
    expect(src).toContain("import a CSV"); // hint
  });
});
