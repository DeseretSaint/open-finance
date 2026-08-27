import { describe, it, expect } from "vitest";
import { withAllowlist, allowlistAllows } from "@/server/db/allowlist";

describe("withAllowlist", () => {
  it("returns no clause when ctx is null (unrestricted)", () => {
    const r = withAllowlist(null, "id");
    expect(r.clause).toBe("");
    expect(r.params).toEqual([]);
  });

  it("returns no clause when accountIds is null (unrestricted)", () => {
    const r = withAllowlist({ accountIds: null }, "a.id");
    expect(r.clause).toBe("");
    expect(r.params).toEqual([]);
  });

  it("returns a blocking clause for an empty allowlist", () => {
    const r = withAllowlist({ accountIds: [] }, "id");
    expect(r.clause).toContain("0 = 1");
    expect(r.params).toEqual([]);
  });

  it("builds a bound IN clause for valid accounts", () => {
    const r = withAllowlist({ accountIds: ["a1", "a2"] }, "a.id");
    expect(r.clause).toBe(" AND a.id IN (?, ?)");
    expect(r.params).toEqual(["a1", "a2"]);
  });

  it("accepts a bare identifier column (id)", () => {
    const r = withAllowlist({ accountIds: ["x"] }, "id");
    expect(r.clause).toBe(" AND id IN (?)");
  });

  it("rejects an injection-bearing column identifier", () => {
    expect(() => withAllowlist({ accountIds: ["x"] }, "id); DROP TABLE accounts; --")).toThrow(
      /invalid column identifier/,
    );
  });

  it("rejects a column starting with a digit", () => {
    expect(() => withAllowlist({ accountIds: ["x"] }, "1id")).toThrow(/invalid column identifier/);
  });

  it("rejects an empty column", () => {
    expect(() => withAllowlist({ accountIds: ["x"] }, "")).toThrow(/invalid column identifier/);
  });
});

describe("allowlistAllows", () => {
  it("allows everything when unrestricted", () => {
    expect(allowlistAllows(null, "any")).toBe(true);
    expect(allowlistAllows({ accountIds: null }, "any")).toBe(true);
  });

  it("allows only listed accounts", () => {
    const ctx = { accountIds: ["a1"] };
    expect(allowlistAllows(ctx, "a1")).toBe(true);
    expect(allowlistAllows(ctx, "a2")).toBe(false);
  });
});
