import { describe, expect, it } from "vitest";
import { createAgentPrefsService, capScopes } from "@/server/domain/agent-prefs";
import { createTestDb, seedUser } from "./helpers";

describe("agent prefs (per-tab access tiers)", () => {
  it("defaults: activity tab only, no write, no global, backlog 1", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const prefs = await createAgentPrefsService(db).get(user.id);
    expect(prefs.tabs).toEqual(["activity"]);
    expect(prefs.tabsWrite).toEqual([]);
    expect(prefs.autoCategorize).toBe(false);
    expect(prefs.categorizeBacklogMonths).toBe(1);
    expect(prefs.global).toBe(false);
    expect(prefs.globalWrite).toBe(false);
    // Default caps: activity read only.
    expect(capScopes(prefs)).toEqual(["read:banking"]);
  });

  it("granular tabs: budgets + activity grant exactly those reads", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { tabs: ["activity", "budgets"] });
    const caps = capScopes(await svc.get(user.id));
    expect(caps).toContain("read:banking");
    expect(caps).toContain("read:budgets");
    expect(caps).not.toContain("read:summary");
    expect(caps).not.toContain("read:reports");
    expect(caps).not.toContain("read:planning");
  });

  it("accounts tab read includes investments (they live under Accounts)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { tabs: ["accounts"] });
    const caps = capScopes(await svc.get(user.id));
    expect(caps).toContain("read:banking");
    expect(caps).toContain("read:investments");
    expect(caps).not.toContain("read:summary");
  });

  it("every tab has a write scope", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, {
      tabs: ["dashboard", "accounts", "activity", "budgets"],
      tabsWrite: ["dashboard", "accounts", "activity", "budgets"],
    });
    const caps = capScopes(await svc.get(user.id));
    expect(caps).toContain("settings:write"); // dashboard
    expect(caps).toContain("sync:run"); // accounts
    expect(caps).toContain("transactions:edit"); // activity
    expect(caps).toContain("budgets:write"); // budgets
  });

  it("per-tab write: budgets write grants budgets:write, activity write grants transactions:edit", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { tabs: ["activity", "budgets"], tabsWrite: ["budgets"] });
    const caps = capScopes(await svc.get(user.id));
    expect(caps).toContain("read:banking");
    expect(caps).toContain("read:budgets");
    expect(caps).toContain("budgets:write");
    expect(caps).not.toContain("transactions:edit");

    await svc.update(user.id, { tabsWrite: ["budgets", "activity"] });
    const caps2 = capScopes(await svc.get(user.id));
    expect(caps2).toContain("transactions:edit");
    expect(caps2).toContain("budgets:write");
  });

  it("smart categorization adds activity write but not global reads", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { autoCategorize: true });
    const prefs = await svc.get(user.id);
    expect(prefs.autoCategorize).toBe(true);
    const caps = capScopes(prefs);
    expect(caps).toContain("transactions:edit");
    expect(caps).not.toContain("read:summary");
    expect(caps).not.toContain("read:budgets");
  });

  it("categorize backlog persists and clamps to allowed values", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { categorizeBacklogMonths: 12 });
    expect((await svc.get(user.id)).categorizeBacklogMonths).toBe(12);
    // Direct garbage write is clamped back to default.
    await db.run("UPDATE user_settings SET agent_categorize_backlog_months = 5 WHERE user_id = ?", user.id);
    expect((await svc.get(user.id)).categorizeBacklogMonths).toBe(1);
  });

  it("global grants read AND write everywhere", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { tabs: ["activity"], global: true });
    const caps = capScopes(await svc.get(user.id));
    expect(caps).toContain("read:summary");
    expect(caps).toContain("read:investments");
    expect(caps).toContain("read:budgets");
    expect(caps).toContain("budgets:write");
    expect(caps).toContain("categories:write");
    expect(caps).toContain("transactions:edit");
    expect(caps).toContain("settings:write");
    expect(caps).toContain("sync:run");
  });

  it("drops unknown tab keys and keeps at least one tab", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await db.run("UPDATE user_settings SET agent_tabs = ? WHERE user_id = ?", JSON.stringify(["nope", "activity"]), user.id);
    const prefs = await svc.get(user.id);
    expect(prefs.tabs).toEqual(["activity"]);
  });

  it("is per-user (isolation)", async () => {
    const db = createTestDb();
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    await createAgentPrefsService(db).update(u1.id, { global: true });
    expect((await createAgentPrefsService(db).get(u2.id)).global).toBe(false);
  });
});
