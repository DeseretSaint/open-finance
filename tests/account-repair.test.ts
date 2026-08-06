import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";

/**
 * Regression: real (non-demo) accounts must never show demo-origin data, and
 * linked credit/loan balances must be stored negative (owed). The repair runs
 * idempotently on every accounts load.
 */
describe("account-repair", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    db = createTestDb();
  });

  async function seedUser(isDemo: number): Promise<string> {
    const id = `u_${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO users (id, username, display_name, is_demo, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      id, `user_${id}`, "U", isDemo, now, now
    );
    return id;
  }

  it("normalizes linked credit/loan balances to negative", async () => {
    const { repairAccountRows } = await import("@/server/domain/account-repair");
    const userId = await seedUser(0);
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, current_balance_cents, available_balance_cents, currency, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      "a1", userId, "item1", "Robinhood", "credit", 35096, 1200, "USD", new Date().toISOString()
    );
    await repairAccountRows(db, userId);
    const row = await db.get<{ current_balance_cents: number; available_balance_cents: number }>(
      "SELECT current_balance_cents, available_balance_cents FROM accounts WHERE id = ?", "a1"
    );
    expect(row?.current_balance_cents).toBe(-35096);
    expect(row?.available_balance_cents).toBe(-1200);
  });

  it("does not flip positive depository balances", async () => {
    const { repairAccountRows } = await import("@/server/domain/account-repair");
    const userId = await seedUser(0);
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, current_balance_cents, currency, created_at) VALUES (?,?,?,?,?,?,?,?)",
      "a2", userId, "item2", "Checking", "depository", 341255, "USD", new Date().toISOString()
    );
    await repairAccountRows(db, userId);
    const row = await db.get<{ current_balance_cents: number }>(
      "SELECT current_balance_cents FROM accounts WHERE id = ?", "a2"
    );
    expect(row?.current_balance_cents).toBe(341255);
  });

  it("purges demo-origin accounts/categories from a real user", async () => {
    const { repairAccountRows } = await import("@/server/domain/account-repair");
    const userId = await seedUser(0);
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, currency, created_at) VALUES (?,?,NULL,?,?,?,?)",
      "demo-acct", userId, "Everyday Checking", "depository", "USD", new Date().toISOString()
    );
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, currency, created_at) VALUES (?,?,NULL,?,?,?,?)",
      "real-acct", userId, "My Real Bank", "depository", "USD", new Date().toISOString()
    );
    await db.run(
      "INSERT INTO categories (id, user_id, name, is_system, created_at) VALUES (?,?,?,0,?)",
      "demo-cat", userId, "Groceries", new Date().toISOString()
    );
    await db.run(
      "INSERT INTO categories (id, user_id, name, is_system, created_at) VALUES (?,?,?,0,?)",
      "real-cat", userId, "My Category", new Date().toISOString()
    );
    await repairAccountRows(db, userId);
    const remaining = await db.all<{ name: string }>("SELECT name FROM accounts WHERE user_id = ?", userId);
    const names = remaining.map((r) => r.name);
    expect(names).not.toContain("Everyday Checking");
    expect(names).toContain("My Real Bank");
    const cats = await db.all<{ name: string }>("SELECT name FROM categories WHERE user_id = ?", userId);
    const catNames = cats.map((c) => c.name);
    expect(catNames).not.toContain("Groceries");
    expect(catNames).toContain("My Category");
  });

  it("is idempotent and does not delete demo accounts for a demo user", async () => {
    const { repairAccountRows } = await import("@/server/domain/account-repair");
    const userId = await seedUser(1);
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, currency, created_at) VALUES (?,?,NULL,?,?,?,?)",
      "demo-acct2", userId, "Everyday Checking", "depository", "USD", new Date().toISOString()
    );
    await repairAccountRows(db, userId);
    await repairAccountRows(db, userId);
    const remaining = await db.all<{ name: string }>("SELECT name FROM accounts WHERE user_id = ?", userId);
    expect(remaining.map((r) => r.name)).toContain("Everyday Checking");
  });
});
