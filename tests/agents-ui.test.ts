import { describe, expect, it } from "vitest";
import { capabilitySentence } from "@/components/agent-capabilities";
import { createAgentTokenService } from "@/server/authz/tokens";
import { createPermissionService } from "@/server/authz/permission-requests";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

describe("capability sentence (P7b §6.5.3)", () => {
  const accounts = [
    { id: "a1", name: "Checking", type: "depository" },
    { id: "a2", name: "Savings", type: "depository" },
    { id: "a3", name: "Credit Card", type: "credit" },
    { id: "a4", name: "Brokerage", type: "investment" },
  ];

  it("read-only: names allowed accounts, flags what it cannot see", () => {
    const s = capabilitySentence(["read:summary", "read:banking", "read:budgets"], accounts, null);
    expect(s).toContain("Checking, Savings, Credit Card");
    expect(s).not.toContain("Brokerage");
    expect(s).toContain("cannot");
  });

  it("read-all: includes investments and reports", () => {
    const s = capabilitySentence(
      ["read:summary", "read:banking", "read:investments", "read:budgets", "read:planning", "read:reports"],
      accounts,
      null
    );
    // 4 accounts → first 3 named + "and 1 more" (Brokerage is the 4th)
    expect(s).toContain("and 1 more");
    expect(s).toContain("reports (net worth, cashflow, spending)");
  });

  it("respects the account allowlist", () => {
    const s = capabilitySentence(["read:banking", "read:investments"], accounts, ["a1", "a4"]);
    expect(s).toContain("Checking");
    expect(s).toContain("Brokerage");
    expect(s).not.toContain("Savings");
  });

  it("write scopes appear as 'can …'", () => {
    const s = capabilitySentence(["read:summary", "transactions:edit"], accounts, null);
    expect(s).toContain("can categorize and edit transactions");
  });

  it("no scopes: honest nothing-yet sentence", () => {
    expect(capabilitySentence([], accounts, null)).toContain("cannot see or change anything yet");
  });
});

describe("grant flow marks token custom (P7b §6.5.5)", () => {
  it("grant appends scope and flips preset to custom (modified)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const tokens = createAgentTokenService(db);
    const perms = createPermissionService(db);
    const { agent } = await tokens.create(user.id, { name: "bot", preset: "read-only" });

    const req = await perms.requestScope(agent.id, "read:reports");
    await perms.resolve(user.id, req.id, "granted");

    const list = await tokens.list(user.id);
    expect(list[0].scopes).toContain("read:reports");
    expect(list[0].custom).toBe(true);
  });

  it("deny persists and does not grant", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const tokens = createAgentTokenService(db);
    const perms = createPermissionService(db);
    const { agent } = await tokens.create(user.id, { name: "bot", preset: "read-only" });

    const req = await perms.requestScope(agent.id, "sync:run");
    await perms.resolve(user.id, req.id, "denied");

    const list = await tokens.list(user.id);
    expect(list[0].scopes).not.toContain("sync:run");
  });

  it("account allowlist is stored and returned in the token list", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const checking = await seedManualAccount(db, user.id, "Checking", "depository");
    const tokens = createAgentTokenService(db);
    const { agent } = await tokens.create(user.id, { name: "scoped", preset: "read-only", accountIds: [checking] });
    expect(agent.accountIds).toEqual([checking]);
    const list = await tokens.list(user.id);
    expect(list[0].accountIds).toEqual([checking]);
  });
});
