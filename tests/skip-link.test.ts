import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const layout = readFileSync(join(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");

describe("skip-to-content link (WCAG 2.4.1)", () => {
  it("renders a Skip to content link as the first focusable element", () => {
    expect(layout).toContain("Skip to content");
    expect(layout).toContain('href="#main-content"');
    // The link must come before the Sidebar so keyboard users hit it first.
    expect(layout.indexOf("Skip to content")).toBeLessThan(layout.indexOf("<Sidebar"));
  });

  it("is visually hidden until focused", () => {
    expect(layout).toContain("sr-only focus:not-sr-only");
  });

  it("targets the main landmark and makes it programmatically focusable", () => {
    expect(layout).toContain('id="main-content"');
    expect(layout).toContain("tabIndex={-1}");
    // main element carries the target id
    expect(layout).toMatch(/<main\s[^>]*id="main-content"/);
  });
});
