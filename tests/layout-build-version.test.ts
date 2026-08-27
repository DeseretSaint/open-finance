import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The root layout's cache/SW-bust inline script used to hardcode B="0.3.15"
// — a stale string that never tracked the real package version, so upgrades
// never cleared stale caches or re-registered the service worker. It must
// read the build-inlined NEXT_PUBLIC_APP_VERSION env var instead (same
// source the Settings Build label and the solo updates service use).
const src = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("layout cache-bust build version", () => {
  it("reads NEXT_PUBLIC_APP_VERSION for the of-build cache-bust key", () => {
    expect(src).toMatch(/var B="\$\{process\.env\.NEXT_PUBLIC_APP_VERSION/);
  });

  it("has no hardcoded stale build string", () => {
    expect(src).not.toContain('B="0.3.15"');
  });
});
