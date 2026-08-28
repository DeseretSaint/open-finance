import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("app-shell (layout) fetch error handling", () => {
  it("surfaces an /api/auth/me failure instead of bouncing to /login or hanging", () => {
    const src = read("src/app/(app)/layout.tsx");
    // the me query destructures error + refetch + isFetching
    expect(src).toMatch(
      /const \{ data, isLoading, error, refetch, isFetching \} = useQuery\(\{\s*queryKey: \["me"\]/
    );
    // a dedicated error branch renders an alert + retry
    expect(src).toContain("Couldn&apos;t load your account");
    expect(src).toContain('role="alert"');
    expect(src).toContain("onClick={() => refetch()}");
    expect(src).toContain('disabled={isFetching}');
    expect(src).toContain('{isFetching ? "Retrying…" : "Try again"}');
    // the error branch is gated on no-data so a background refetch-error never blanks the app
    expect(src).toContain("if (error && !data) {");
  });

  it("does not redirect valid sessions to /login on a transient me error", () => {
    const src = read("src/app/(app)/layout.tsx");
    // the redirect guard now also requires !error (so a fetch failure stays put)
    expect(src).toContain("if (!isLoading && !data && !error) router.replace(\"/login\");");
  });

  it("does not re-show the first-run wizard when /api/onboarding fails", () => {
    const src = read("src/app/(app)/layout.tsx");
    // onboarding error is treated as already-completed so an existing user is
    // never kicked back into the setup wizard
    expect(src).toContain("const onboardingCompleted = onboarding.data?.completed === false ? false : true;");
    expect(src).toContain("if (!isDemo && !onboardingCompleted) {");
    // the raw data flag is no longer used directly in the gate
    expect(src).not.toContain("if (!isDemo && !onboarding.data?.completed) {");
  });
});
