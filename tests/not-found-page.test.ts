import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("root 404 page (run 100)", () => {
  const src = read("src/app/not-found.tsx");

  it("exists at the app root (Next.js serves it for unmatched routes)", () => {
    expect(src).toContain("export default function NotFound");
  });

  it("is calm-fintech styled with a recovery path to the dashboard", () => {
    expect(src).toContain("Page not found");
    expect(src).toContain("Your data is safe");
    expect(src).toContain('href="/dashboard"');
  });

  it("is static server-rendered (no client JS, no hooks)", () => {
    expect(src).not.toContain('"use client"');
    expect(src).not.toContain("useState");
    expect(src).not.toContain("useEffect");
  });

  it("uses design tokens, not hardcoded colors", () => {
    expect(src).toContain("bg-background");
    expect(src).toContain("bg-surface");
    expect(src).toContain("text-text-muted");
    expect(src).toContain("bg-accent");
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("marks the icon decorative for screen readers", () => {
    expect(src).toContain('aria-hidden="true"');
  });
});
