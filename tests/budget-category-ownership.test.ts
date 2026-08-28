import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createBudgetsService } from "@/server/domain/budgets";
import { createTestDb, seedUser } from "./helpers";

async function seedCategory(db: ReturnType<typeof createTestDb>, userId: string, name: string) {
  const id = randomUUID();
  await db.run(
    "INSERT INTO categories (id, user_id, name, color, is_system, created_at) VALUES (?, ?, ?, NULL, 0, ?)",
    id,
    userId,
    name,
    new Date().toISOString()
  );
  return id;
}

describe("budget category ownership validation", () => {
  it("create rejects another user's category id", async () => {
    const db = createTestDb();
    const svc = createBudgetsService(db);
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    const foreignCat = await seedCategory(db, u2.id, "Bob Groceries");
    await expect(
      svc.create(u1.id, { name: "Food", amountCents: 10000, categoryIds: [foreignCat] })
    ).rejects.toThrow("One or more categories do not exist.");
    // No budget row left behind.
    const rows = await db.all("SELECT * FROM budgets WHERE user_id = ?", u1.id);
    expect(rows).toHaveLength(0);
  });

  it("create rejects a nonexistent category id", async () => {
    const db = createTestDb();
    const svc = createBudgetsService(db);
    const u1 = await seedUser(db, "alice");
    await expect(
      svc.create(u1.id, { name: "Food", amountCents: 10000, categoryIds: [randomUUID()] })
    ).rejects.toThrow("One or more categories do not exist.");
  });

  it("create dedupes duplicate category ids instead of hitting the PK", async () => {
    const db = createTestDb();
    const svc = createBudgetsService(db);
    const u1 = await seedUser(db, "alice");
    const cat = await seedCategory(db, u1.id, "Groceries");
    const budget = await svc.create(u1.id, { name: "Food", amountCents: 10000, categoryIds: [cat, cat] });
    const links = await db.all("SELECT * FROM budget_categories WHERE budget_id = ?", budget.id);
    expect(links).toHaveLength(1);
  });

  it("update rejects a foreign category id and preserves the existing set", async () => {
    const db = createTestDb();
    const svc = createBudgetsService(db);
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    const ownCat = await seedCategory(db, u1.id, "Groceries");
    const foreignCat = await seedCategory(db, u2.id, "Bob Stuff");
    const budget = await svc.create(u1.id, { name: "Food", amountCents: 10000, categoryIds: [ownCat] });
    await expect(
      svc.update(u1.id, budget.id, { categoryIds: [foreignCat] })
    ).rejects.toThrow("One or more categories do not exist.");
    // Existing category set untouched by the failed update.
    const links = await db.all<{ category_id: string }>(
      "SELECT category_id FROM budget_categories WHERE budget_id = ?",
      budget.id
    );
    expect(links.map((l) => l.category_id)).toEqual([ownCat]);
  });

  it("update still accepts the owner's own categories", async () => {
    const db = createTestDb();
    const svc = createBudgetsService(db);
    const u1 = await seedUser(db, "alice");
    const catA = await seedCategory(db, u1.id, "Groceries");
    const catB = await seedCategory(db, u1.id, "Dining");
    const budget = await svc.create(u1.id, { name: "Food", amountCents: 10000, categoryIds: [catA] });
    await svc.update(u1.id, budget.id, { categoryIds: [catB] });
    const links = await db.all<{ category_id: string }>(
      "SELECT category_id FROM budget_categories WHERE budget_id = ?",
      budget.id
    );
    expect(links.map((l) => l.category_id)).toEqual([catB]);
  });
});
