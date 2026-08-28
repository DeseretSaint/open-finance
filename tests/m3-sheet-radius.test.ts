import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");

// Q10 (M3 Android component parity): bottom sheets must use the M3
// cornerExtraLarge = 28dp corner (24dp is stale M2) and a 640dp max-width
// cap (only bites >=600dp windows; full-width on phones). Verified against
// references/m3-android-component-specs.md.
describe("M3 bottom-sheet radius + width cap (Q10)", () => {
  const sheets = [
    join(root, "src/components/sidebar.tsx"), // mobile "More" sheet
    join(root, "src/components/ui/custom-select.tsx"),
    join(root, "src/components/ui/custom-date-picker.tsx"),
    join(root, "src/components/ui/custom-time-picker.tsx"),
  ];

  for (const file of sheets) {
    const src = read(file);
    it(`${file.split("/src/")[1]} uses 28dp corners + 640dp cap`, () => {
      // 28dp corner, not the stale 16/24dp (rounded-t-2xl / rounded-t-3xl)
      expect(src).toMatch(/rounded-t-\[28px\]/);
      expect(src).not.toMatch(/rounded-t-2xl|rounded-t-3xl/);
      // 640dp max-width cap (capped on wide viewports, full-width on phones)
      expect(src).toMatch(/max-w-\[640px\]/);
      expect(src).toMatch(/mx-auto/);
    });
  }
});
