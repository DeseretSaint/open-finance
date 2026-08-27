import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync(join(process.cwd(), "src/components/sidebar.tsx"), "utf8");

describe("mobile More-sheet current-page indicator (a11y)", () => {
  it("exposes aria-current on the active destination inside the More sheet", () => {
    // Each destination carries BOTH the visible link and the AT indicator.
    expect(sidebar).toContain('aria-current={active ? "page" : undefined}');
    // The More-sheet grid link (unique className + renders {blurb}) must set aria-current.
    expect(sidebar).toMatch(
      /href=\{href\}\s*\n\s*aria-current=\{active \? "page" : undefined\}\s*\n\s*className=\{\`flex flex-col gap-1 rounded-xl border/,
    );
  });

  it("keeps aria-current off when the destination is not active", () => {
    // The ternary resolves to undefined (not a literal "page") when inactive.
    expect(sidebar).toContain('aria-current={active ? "page" : undefined}');
    expect(sidebar).not.toContain('aria-current="page"');
  });
});
