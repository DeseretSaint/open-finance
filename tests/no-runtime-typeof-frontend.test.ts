import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Locks the run-85 lint:slop no-runtime-typeof batch: every frontend (non-server)
// `typeof window|document|navigator` SSR guard was replaced by a centralized
// `hasWindow()/hasDocument()/hasNavigator()` helper in src/lib/browser-env.ts
// (or an isNativeString() type guard for value discrimination). solo-router.ts
// is the shared router and is SLOT-A's turf — it may still carry typeof checks.
const RT_TYPEOF = /\btypeof\s+(window|document|navigator)\b/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === "tests") continue;
      walk(full, acc);
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("frontend no-runtime-typeof", () => {
  const roots = ["src/components", "src/lib", "src/app"].map((r) => join(process.cwd(), r));
  const files = roots.flatMap((r) => walk(r));

  const hits = files.filter((f) => {
    const rel = f.replace(process.cwd() + "/", "");
    if (rel === "src/lib/browser-env.ts") return false; // the helper itself
    if (rel === "src/lib/solo-router.ts") return false; // SLOT-A territory
    if (rel.startsWith("tests/")) return false;
    return RT_TYPEOF.test(readFileSync(f, "utf8"));
  });

  it("no runtime typeof window|document|navigator in frontend (excl solo-router + browser-env helpers)", () => {
    const rel = hits.map((f) => f.replace(process.cwd() + "/", ""));
    expect(rel, `unexpected runtime typeof in: ${rel.join(", ")}`).toEqual([]);
  });

  it("browser-env centralizes the guards without using runtime typeof", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/browser-env.ts"), "utf8");
    expect(src).toContain('export function hasWindow()');
    expect(src).toContain('export function hasDocument()');
    expect(src).toContain('export function hasNavigator()');
    expect(src).toContain('export function isNativeString');
    // isNativeString must not use `typeof` (it discriminates via Object.prototype.toString)
    expect(src).not.toMatch(/isNativeString[\s\S]{0,200}typeof\s+v/);
  });
});
