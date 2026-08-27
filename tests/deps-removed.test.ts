import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Run-61 dep-surface audit removed 6 dead deps (0 source importers).
// These guards keep them from silently creeping back into package.json
// or being imported from source.
const REMOVED = ["cmdk", "qrcode", "@types/qrcode", "archiver", "supertest", "@playwright/test"];

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry === "tools") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("removed dead deps stay gone", () => {
  it("package.json does not declare any removed dep", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    for (const name of REMOVED) expect(declared).not.toContain(name);
  });

  it("no source file imports a removed dep", () => {
    const files = walk(join(ROOT, "src")).concat(walk(join(ROOT, "scripts"), []), walk(join(ROOT, "migrations"), []), walk(join(ROOT, "tests"), []));
    const importRe = new RegExp(
      `(from|import|require\\()\\s*['"](${REMOVED.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(/|['"])`,
    );
    const hits = files.filter((f) => importRe.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("playwright (kept) is still declared — used by scripts/screenshots.mjs + scripts/mobile-audit.mjs", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.devDependencies ?? {})).toContain("playwright");
  });
});
