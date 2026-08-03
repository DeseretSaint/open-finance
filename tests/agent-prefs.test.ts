import { describe, expect, it } from "vitest";
import { createAgentPrefsService, capScopes } from "@/server/domain/agent-prefs";
import { createTestDb, seedUser } from "./helpers";

describe("agent prefs (access tiers)", () => {
  it("defaults: activity read only, no write, no global", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const prefs = await createAgentPrefsService(db).get(user.id);
    expect(prefs.autoCategorize).toBe(false);
    expect(prefs.global).toBe(false);
    expect(prefs.globalWrite).toBe(false);
    // Default caps: only activity read.
    expect(capScopes(prefs)).toEqual(["read:banking"]);
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

  it("global adds all reads; globalWrite adds writes", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { global: true });
    const readCaps = capScopes(await svc.get(user.id));
    expect(readCaps).toContain("read:summary");
    expect(readCaps).toContain("read:reports");
    expect(readCaps).not.toContain("budgets:write");

    await svc.update(user.id, { globalWrite: true });
    const writeCaps = capScopes(await svc.get(user.id));
    expect(writeCaps).toContain("budgets:write");
    expect(writeCaps).toContain("categories:write");
    expect(writeCaps).toContain("transactions:edit");
  });

  it("is per-user (isolation)", async () => {
    const db = createTestDb();
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    await createAgentPrefsService(db).update(u1.id, { global: true });
    expect((await createAgentPrefsService(db).get(u2.id)).global).toBe(false);
  });
});
