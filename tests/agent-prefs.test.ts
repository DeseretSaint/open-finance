import { describe, expect, it } from "vitest";
import { createAgentPrefsService, capScopes } from "@/server/domain/agent-prefs";
import { createTestDb, seedUser } from "./helpers";

describe("agent prefs (per-tab access tiers)", () => {
  it("defaults: activity tab only, no write, no global", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const prefs = await createAgentPrefsService(db).get(user.id);
    expect(prefs.tabs).toEqual(["activity"]);
    expect(prefs.autoCategorize).toBe(false);
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

  it("global overrides tabs with all reads; globalWrite adds writes", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    // Even with a narrow tab list, global wins.
    await svc.update(user.id, { tabs: ["activity"], global: true });
    const readCaps = capScopes(await svc.get(user.id));
    expect(readCaps).toContain("read:summary");
    expect(readCaps).toContain("read:reports");
    expect(readCaps).toContain("read:investments");
    expect(readCaps).not.toContain("budgets:write");

    await svc.update(user.id, { globalWrite: true });
    const writeCaps = capScopes(await svc.get(user.id));
    expect(writeCaps).toContain("budgets:write");
    expect(writeCaps).toContain("categories:write");
    expect(writeCaps).toContain("transactions:edit");
  });

  it("drops unknown tab keys and keeps at least one tab", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    // Persist garbage directly to simulate a bad write.
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
