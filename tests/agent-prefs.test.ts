import { describe, expect, it } from "vitest";
import { createAgentPrefsService } from "@/server/domain/agent-prefs";
import { createTestDb, seedUser } from "./helpers";

describe("agent prefs (smart categorization)", () => {
  it("defaults to autoCategorize = false", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const prefs = await createAgentPrefsService(db).get(user.id);
    expect(prefs.autoCategorize).toBe(false);
  });

  it("updates and round-trips the toggle", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { autoCategorize: true });
    expect((await svc.get(user.id)).autoCategorize).toBe(true);
    await svc.update(user.id, { autoCategorize: false });
    expect((await svc.get(user.id)).autoCategorize).toBe(false);
  });

  it("is per-user (isolation)", async () => {
    const db = createTestDb();
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    await createAgentPrefsService(db).update(u1.id, { autoCategorize: true });
    expect((await createAgentPrefsService(db).get(u2.id)).autoCategorize).toBe(false);
  });
});
