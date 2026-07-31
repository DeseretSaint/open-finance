import { describe, expect, it } from "vitest";
import { allowlistAllows, withAllowlist } from "@/server/db/allowlist";

describe("withAllowlist", () => {
  it("returns no clause when allowlist is null (unrestricted)", () => {
    const { clause, params } = withAllowlist({ accountIds: null });
    expect(clause).toBe("");
    expect(params).toHaveLength(0);
  });

  it("returns no clause when ctx is missing", () => {
    expect(withAllowlist(undefined).clause).toBe("");
    expect(withAllowlist(null).clause).toBe("");
  });

  it("builds an IN clause for a non-empty allowlist", () => {
    const { clause, params } = withAllowlist({ accountIds: ["a", "b"] });
    expect(clause).toBe(" AND account_id IN (?, ?)");
    expect(params).toEqual(["a", "b"]);
  });

  it("uses a custom column", () => {
    const { clause } = withAllowlist({ accountIds: ["a"] }, "user_id");
    expect(clause).toContain("user_id IN");
  });

  it("denies everything for an empty allowlist (no parameterization abuse)", () => {
    const { clause, params } = withAllowlist({ accountIds: [] });
    expect(clause).toContain("0 = 1");
    expect(params).toHaveLength(0);
  });
});

describe("allowlistAllows", () => {
  it("allows when unrestricted", () => {
    expect(allowlistAllows({ accountIds: null }, "anything")).toBe(true);
    expect(allowlistAllows(undefined, "anything")).toBe(true);
  });

  it("allows only listed ids", () => {
    const ctx = { accountIds: ["a", "b"] };
    expect(allowlistAllows(ctx, "a")).toBe(true);
    expect(allowlistAllows(ctx, "c")).toBe(false);
  });
});
