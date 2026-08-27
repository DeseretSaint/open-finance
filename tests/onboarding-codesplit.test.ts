import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// OnboardingWizard is first-run only. It must be lazy-loaded (next/dynamic) so
// its demo/sample-data strings stay out of the shared app-shell chunk and don't
// download on every other route. Regression guard for the run-52 bundle-size fix.
const layout = readFileSync(
  join(process.cwd(), "src/app/(app)/layout.tsx"),
  "utf8"
);

describe("OnboardingWizard code-split", () => {
  it("is NOT statically imported into the app shell", () => {
    expect(layout).not.toMatch(
      /import\s*\{\s*OnboardingWizard\s*\}\s*from\s*"@\/components\/onboarding-wizard"/
    );
  });

  it("is lazy-loaded via next/dynamic", () => {
    expect(layout).toMatch(/const OnboardingWizard = dynamic\(/);
    expect(layout).toMatch(
      /import\("@\/components\/onboarding-wizard"\)\.then\(\(m\) => m\.OnboardingWizard\)/
    );
  });
});
