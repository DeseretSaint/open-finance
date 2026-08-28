import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const src = readFileSync(join(root, "src/app/register/page.tsx"), "utf8");

describe("register solo recovery-code copy affordance", () => {
  it("offers a copy button that writes the one-time code to the clipboard", () => {
    // handler writes the recovery code via the Clipboard API
    expect(src).toContain("await navigator.clipboard.writeText(recoveryCode);");
    // a dedicated button wired to it, with an accessible label
    expect(src).toContain('onClick={copyRecovery} aria-label="Copy recovery code"');
  });

  it("confirms the copy with a transient status instead of staying silent", () => {
    // busy/confirmation state flips the label + shows a status line
    expect(src).toContain('{copied ? "Copied!" : "Copy code"}');
    expect(src).toContain('{copied ? "Saved to clipboard" : "Tap to copy it somewhere safe"}');
    expect(src).toContain('role={copied ? "status" : undefined}');
  });
});
