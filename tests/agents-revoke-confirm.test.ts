import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "src/app/(app)/agents/page.tsx"), "utf8");

describe("agent token revoke confirmation", () => {
  it("Revoke button routes to setConfirmRevoke, not revoke.mutate directly", () => {
    const btn = SRC.match(/<Button[^>]*onClick=\{\(\) => setConfirmRevoke\(\{ id: t\.id, name: t\.name \}\)\}[^>]*>\s*Revoke\s*<\/Button>/);
    expect(btn).not.toBeNull();
    expect(SRC).not.toMatch(/onClick=\{\(\) => revoke\.mutate\(t\.id\)\}/);
  });

  it("confirmRevoke state holds the pending token id + name", () => {
    expect(SRC).toMatch(/useState<\{ id: string; name: string \} \| null>\(null\)/);
  });

  it("renders a ConfirmDialog for single-token revoke with the token name in the message", () => {
    expect(SRC).toContain('title="Revoke this token?"');
    expect(SRC).toMatch(/confirmRevoke\?\.name/);
    expect(SRC).toContain("will lose access immediately. This cannot be undone.");
  });

  it("dialog confirm wires revoke.mutate(confirmRevoke.id) and busy tracks revoke.isPending", () => {
    expect(SRC).toMatch(/onConfirm=\{\(\) => \{\s*if \(confirmRevoke\) revoke\.mutate\(confirmRevoke\.id\);/);
    expect(SRC).toMatch(/busy=\{revoke\.isPending\}/);
  });

  it("dialog closes on cancel and after a successful revoke", () => {
    expect(SRC).toMatch(/onCancel=\{\(\) => setConfirmRevoke\(null\)\}/);
    expect(SRC).toMatch(/setMsg\("Token revoked\."\);\s*setConfirmRevoke\(null\);/);
  });
});
