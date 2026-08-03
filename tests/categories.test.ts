import { describe, expect, it } from "vitest";
import { createCategoriesService } from "@/server/domain/categories";
import { createTestDb, seedUser } from "./helpers";

describe("categories", () => {
  it("creates and lists user categories", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCategoriesService(db);
    await svc.create(user.id, { name: "Groceries", color: "#10B981", plaidPaths: "Food and Drink|Groceries" });
    const list = await svc.list(user.id);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Groceries");
  });

  it("rejects duplicate names", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCategoriesService(db);
    await svc.create(user.id, { name: "Groceries" });
    await expect(svc.create(user.id, { name: "groceries" })).rejects.toThrow();
  });

  it("ensures system categories idempotently", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCategoriesService(db);
    await svc.ensureSystem(user.id);
    await svc.ensureSystem(user.id);
    const list = await svc.list(user.id);
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(list.filter((c) => c.is_system).length).toBe(list.length);
  });

  it("blocks editing/deleting system categories", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCategoriesService(db);
    await svc.ensureSystem(user.id);
    const system = (await svc.list(user.id))[0];
    await expect(svc.update(user.id, system.id, { name: "Hacked" })).rejects.toThrow();
    await expect(svc.remove(user.id, system.id)).rejects.toThrow();
  });

  describe("match (longest prefix)", () => {
    it("matches exact personal-finance category", async () => {
      const db = createTestDb();
      const user = await seedUser(db);
      const svc = createCategoriesService(db);
      await svc.create(user.id, { name: "Restaurants", plaidPaths: "Food and Drink|Restaurants" });
      await svc.create(user.id, { name: "Food", plaidPaths: "Food and Drink" });
      const hit = await svc.match(user.id, "Food and Drink|Restaurants", "Food and Drink|Restaurants");
      expect(hit?.name).toBe("Restaurants");
    });

    it("matches longest category_path prefix", async () => {
      const db = createTestDb();
      const user = await seedUser(db);
      const svc = createCategoriesService(db);
      await svc.create(user.id, { name: "Food", plaidPaths: "Food and Drink" });
      await svc.create(user.id, { name: "Groceries", plaidPaths: "Food and Drink|Groceries" });
      const hit = await svc.match(user.id, "Food and Drink|Groceries|Supermarkets", null);
      expect(hit?.name).toBe("Groceries");
    });

    it("returns null when nothing matches", async () => {
      const db = createTestDb();
      const user = await seedUser(db);
      const svc = createCategoriesService(db);
      await svc.create(user.id, { name: "Groceries", plaidPaths: "Food and Drink|Groceries" });
      expect(await svc.match(user.id, "Travel|Airlines", null)).toBeNull();
      expect(await svc.match(user.id, null, null)).toBeNull();
    });
  });
});
