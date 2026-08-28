import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, seedUser } from "./helpers";

describe("foreign key enforcement (adapter + migration pragma)", () => {
  it("rejects an orphan budget_categories insert (no parent category)", async () => {
    const db = createTestDb();
    const u = await seedUser(db, "fk-alice");
    const budgetId = randomUUID();
    await db.run(
      "INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      budgetId,
      u.id,
      "Food",
      10000,
      "monthly",
      new Date().toISOString()
    );
    // With foreign_keys OFF this "succeeds" (orphan); with it ON it must throw.
    await expect(
      db.run(
        "INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)",
        budgetId,
        randomUUID() // no such category
      )
    ).rejects.toThrow();
    const rows = await db.all("SELECT * FROM budget_categories");
    expect(rows).toHaveLength(0);
  });

  it("cascades a category delete into budget_categories", async () => {
    const db = createTestDb();
    const u = await seedUser(db, "fk-bob");
    const catId = randomUUID();
    await db.run(
      "INSERT INTO categories (id, user_id, name, color, is_system, created_at) VALUES (?, ?, ?, NULL, 0, ?)",
      catId,
      u.id,
      "Groceries",
      new Date().toISOString()
    );
    const budgetId = randomUUID();
    await db.run(
      "INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      budgetId,
      u.id,
      "Food",
      10000,
      "monthly",
      new Date().toISOString()
    );
    await db.run(
      "INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)",
      budgetId,
      catId
    );
    await db.run("DELETE FROM categories WHERE id = ?", catId);
    const rows = await db.all("SELECT * FROM budget_categories");
    expect(rows).toHaveLength(0);
  });
});
