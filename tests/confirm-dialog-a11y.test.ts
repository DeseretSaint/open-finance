import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/components/ui/confirm-dialog.tsx"), "utf8");

describe("ConfirmDialog a11y + M3 sheet parity", () => {
  it("names the dialog from its visible heading (aria-labelledby, not a duplicated aria-label)", () => {
    expect(src).toContain("aria-labelledby={titleId}");
    expect(src).toContain("id={titleId}");
    expect(src).not.toContain("aria-label={title}");
  });

  it("associates the consequence message with the alertdialog via aria-describedby", () => {
    expect(src).toContain("aria-describedby={message ? descId : undefined}");
    expect(src).toContain("id={descId}");
  });

  it("derives per-instance ids from useId so two mounted dialogs never share DOM ids", () => {
    expect(src).toContain('import { useId } from "react"');
    expect(src).toContain("const baseId = useId();");
    expect(src).toContain("`${baseId}-confirm-title`");
    expect(src).toContain("`${baseId}-confirm-desc`");
    expect(src).not.toContain('"confirm-dialog-title"');
    expect(src).not.toContain('"confirm-dialog-desc"');
  });

  it("uses the M3 cornerExtraLarge 28dp top radius and the 640dp sheet cap", () => {
    expect(src).toContain("rounded-t-[28px]");
    expect(src).not.toContain("rounded-t-3xl");
    expect(src).toContain("max-w-[640px]");
  });
});
