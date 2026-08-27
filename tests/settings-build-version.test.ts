import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Settings page header used to hardcode "Build 0.3.7" — a stale string
// that never tracked the real package version (v0.3.46+). It must read the
// build-inlined NEXT_PUBLIC_APP_VERSION env var instead (same source the
// page's footer line and the solo updates service already use).
const src = readFileSync(
  join(process.cwd(), "src/app/(app)/settings/page.tsx"),
  "utf8",
);

describe("settings build-version label", () => {
  it("reads NEXT_PUBLIC_APP_VERSION for the Build label", () => {
    expect(src).toMatch(/Build \{process\.env\.NEXT_PUBLIC_APP_VERSION/);
  });

  it("has no hardcoded stale build string", () => {
    expect(src).not.toContain("Build 0.3.7");
  });
});
