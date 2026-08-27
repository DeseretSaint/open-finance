import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as mobileStorage from "@/lib/mobile-storage";
import * as dbRegistry from "@/server/db/registry";
import * as manualMeta from "@/server/domain/agent-manual-meta";
import * as dates from "@/server/domain/dates";
import * as transfers from "@/server/domain/transfers";

/**
 * Dead-code sweep (2026-08-26): the exports below had ZERO references across
 * src/tests/migrations/scripts/tools and were deleted. This guard asserts they
 * stay gone — if one is genuinely needed again, restore it deliberately and
 * update this list; don't let dead exports creep back in.
 *
 * NOT covered here (kept pending owner review — agent-facing authz surface):
 * USER_ONLY_ROUTES, mcpToolsWithoutScopeOrEndpoint (route-registry),
 * hasScope, insufficientScope (agent-auth).
 */
const REMOVED: Array<[name: string, mod: Record<string, unknown>]> = [
  ["getStoredSessionToken", mobileStorage],
  ["clearStoredSessionToken", mobileStorage],
  ["isReconnectDeepLink", mobileStorage],
  ["resetDbProvider", dbRegistry],
  ["MANUAL_DOMAIN_LABELS", manualMeta],
  ["nowISO", dates],
  ["transferPaymentPattern", transfers],
  ["transferCategoryPattern", transfers],
  ["transferPostingWindowDays", transfers],
];

describe("dead exports stay removed", () => {
  for (const [name, mod] of REMOVED) {
    it(`${name} is no longer exported`, () => {
      expect(name in mod).toBe(false);
    });
  }

  it("customOptions is no longer exported (custom-select.tsx is JSX — checked via source)", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/components/ui/custom-select.tsx"), "utf8");
    expect(src).not.toMatch(/export\s+function\s+customOptions\b/);
  });

  it("hasNativeBiometrics is no longer exported (biometric.ts's native plugin import is not node-resolvable — checked via source)", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/lib/biometric.ts"), "utf8");
    expect(src).not.toMatch(/export\s+function\s+hasNativeBiometrics\b/);
  });
});
