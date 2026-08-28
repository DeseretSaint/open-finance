import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

const read = (p: string) => readFileSync(p, "utf8");
const componentFiles = walk(join(root, "src", "app")).concat(walk(join(root, "src", "components")));

describe("motion tokens honor M3 (Q12)", () => {
  it("defines M3 motion tokens and a reduced-motion override in globals.css", () => {
    const css = read(join(root, "src", "app", "globals.css"));
    expect(css).toMatch(/--of-motion-fast:\s*\d+ms/);
    expect(css).toMatch(/--of-motion-med:\s*\d+ms/);
    expect(css).toMatch(/--of-motion-slow:\s*\d+ms/);
    // reduced-motion must calm animations/transitions (accessibility contract)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("never uses transition-all (M3 forbids catch-all transitions)", () => {
    const offenders = componentFiles.filter((f) => /\btransition-all\b/.test(read(f)));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("switch knobs animate transform, not left (M3: no position transitions)", () => {
    const tx = read(join(root, "src/app/(app)/settings/page.tsx"));
    expect(tx).not.toMatch(/transition-all[^"]*left-\[22px\]/);
    expect(tx).toMatch(/transition-transform/);
    expect(tx).toMatch(/translate-x-\[20px\]/);
    const tr = read(join(root, "src/app/(app)/transactions/page.tsx"));
    expect(tr).toMatch(/transition-transform/);
    expect(tr).toMatch(/translate-x-\[14px\]/);
  });
});
