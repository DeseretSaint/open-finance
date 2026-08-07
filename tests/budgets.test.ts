import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createBudgetsService } from "@/server/domain/budgets";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

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

async function seedTxn(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  accountId: string,
  over: { date: string; amountCents: number; categoryId?: string | null; exclude?: boolean; pending?: boolean }
) {
  await db.run(
    `INSERT INTO transactions
       (id, account_id, amount_cents, date, name, user_category_id, exclude_from_budgets, pending, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    randomUUID(),
    accountId,
    over.amountCents,
    over.date,
    "Txn",
    over.categoryId ?? null,
    over.exclude ? 1 : 0,
    over.pending ? 1 : 0,
    new Date().toISOString()
  );
}

/** ISO date `day` days into the month that is `offset` months from now. */
function dateIn(offset: number, day: number): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1 + offset).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("budgets", () => {
  it("computes spend for category-tagged budgets within the month", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const food = await seedCategory(db, user.id, "Food");
    await seedTxn(db, user.id, acc, { date: dateIn(0, 3), amountCents: -4000, categoryId: food });
    await seedTxn(db, user.id, acc, { date: dateIn(0, 20), amountCents: -2500, categoryId: food });
    await seedTxn(db, user.id, acc, { date: dateIn(1, 1), amountCents: -9999, categoryId: food }); // next month
    await seedTxn(db, user.id, acc, { date: dateIn(0, 5), amountCents: -5000, categoryId: null }); // uncategorized

    const svc = createBudgetsService(db);
    const budget = await svc.create(user.id, { name: "Food", amountCents: 10000, categoryIds: [food] });
    const list = await svc.list(user.id, dateIn(0, 15));
    const row = list.find((b) => b.id === budget.id)!;
    expect(row.spentCents).toBe(6500);
    expect(row.remainingCents).toBe(3500);
    expect(row.pct).toBeCloseTo(0.65);
  });

  it("tracks Uncategorized when a budget has no categories", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const food = await seedCategory(db, user.id, "Food");
    await seedTxn(db, user.id, acc, { date: dateIn(0, 10), amountCents: -3000, categoryId: null });
    await seedTxn(db, user.id, acc, { date: dateIn(0, 11), amountCents: -7000, categoryId: food }); // not counted

    const svc = createBudgetsService(db);
    await svc.create(user.id, { name: "Everything Else", amountCents: 5000 });
    const list = await svc.list(user.id, dateIn(0, 15));
    expect(list[0].spentCents).toBe(3000);
  });

  it("excludes budget-excluded transactions; pending included by default, excluded on demand", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const food = await seedCategory(db, user.id, "Food");
    await seedTxn(db, user.id, acc, { date: dateIn(0, 1), amountCents: -1000, categoryId: food, exclude: true });
    await seedTxn(db, user.id, acc, { date: dateIn(0, 2), amountCents: -2000, categoryId: food, pending: true });
    await seedTxn(db, user.id, acc, { date: dateIn(0, 3), amountCents: -3000, categoryId: food });

    const svc = createBudgetsService(db);
    await svc.create(user.id, { name: "Food", amountCents: 10000, categoryIds: [food] });
    // Pending is counted by default (matches accounts/overview) — only the
    // budget-excluded txn is skipped.
    const list = await svc.list(user.id, dateIn(0, 15));
    expect(list[0].spentCents).toBe(5000);
    // Explicit opt-out excludes pending.
    const strict = await svc.list(user.id, dateIn(0, 15), { kind: "period" }, false);
    expect(strict[0].spentCents).toBe(3000);
  });

  it("ignores income (positive amounts) in spend", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const food = await seedCategory(db, user.id, "Food");
    await seedTxn(db, user.id, acc, { date: dateIn(0, 1), amountCents: 5000, categoryId: food });

    const svc = createBudgetsService(db);
    await svc.create(user.id, { name: "Food", amountCents: 10000, categoryIds: [food] });
    const list = await svc.list(user.id, dateIn(0, 15));
    expect(list[0].spentCents).toBe(0);
  });

  it("updates and deletes budgets", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const food = await seedCategory(db, user.id, "Food");
    const svc = createBudgetsService(db);
    const budget = await svc.create(user.id, { name: "Food", amountCents: 5000, categoryIds: [food] });
    const updated = await svc.update(user.id, budget.id, { amountCents: 8000, name: "Groceries" });
    expect(updated.amount_cents).toBe(8000);
    expect(updated.name).toBe("Groceries");
    await svc.remove(user.id, budget.id);
    const list = await svc.list(user.id);
    expect(list).toHaveLength(0);
  });

  it("scopes budgets per user", async () => {
    const db = createTestDb();
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    const svc = createBudgetsService(db);
    const b = await svc.create(u1.id, { name: "Food", amountCents: 5000 });
    await expect(svc.update(u2.id, b.id, { amountCents: 1 })).rejects.toThrow();
  });
});
