import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createReportsService } from "@/server/domain/reports";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

async function seedTxn(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  accountId: string,
  over: { date: string; amountCents: number; categoryId?: string | null }
) {
  await db.run(
    `INSERT INTO transactions
       (id, account_id, amount_cents, date, name, user_category_id, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
    randomUUID(),
    accountId,
    over.amountCents,
    over.date,
    "Txn",
    over.categoryId ?? null,
    new Date().toISOString()
  );
}

async function seedCategory(db: ReturnType<typeof createTestDb>, userId: string, name: string) {
  const id = randomUUID();
  await db.run(
    "INSERT INTO categories (id, user_id, name, color, is_system, created_at) VALUES (?, ?, ?, '#10B981', 0, ?)",
    id,
    userId,
    name,
    new Date().toISOString()
  );
  return id;
}

describe("reports", () => {
  it("sums spending by category over a range", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const food = await seedCategory(db, user.id, "Food");
    await seedTxn(db, user.id, acc, { date: "2026-07-01", amountCents: 4000, categoryId: food });
    await seedTxn(db, user.id, acc, { date: "2026-07-10", amountCents: 2000, categoryId: food });
    await seedTxn(db, user.id, acc, { date: "2026-07-20", amountCents: 3000, categoryId: null });
    await seedTxn(db, user.id, acc, { date: "2026-06-01", amountCents: 9999, categoryId: food }); // out of range

    const rows = await createReportsService(db).spendingByCategory(user.id, "2026-07-01", "2026-08-01");
    expect(rows).toHaveLength(2);
    const foodRow = rows.find((r) => r.categoryName === "Food");
    expect(foodRow?.spentCents).toBe(6000);
    const uncat = rows.find((r) => r.categoryName === "Uncategorized");
    expect(uncat?.spentCents).toBe(3000);
  });

  it("cashflow returns zero-filled months oldest→newest", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    // May 2026: income 5000, expense 3000 (net +2000)
    await seedTxn(db, user.id, acc, { date: "2026-05-05", amountCents: -5000 });
    await seedTxn(db, user.id, acc, { date: "2026-05-10", amountCents: 3000 });
    // June: nothing (zero-filled)

    const rows = await createReportsService(db).cashflow(user.id, 3);
    expect(rows).toHaveLength(3);
    const may = rows.find((r) => r.month === "2026-05");
    expect(may?.incomeCents).toBe(5000);
    expect(may?.expenseCents).toBe(3000);
    expect(may?.netCents).toBe(2000);
    const june = rows.find((r) => r.month === "2026-06");
    expect(june?.incomeCents).toBe(0);
    expect(june?.expenseCents).toBe(0);
  });

  it("computes net worth: assets - liabilities", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const now = new Date().toISOString();
    // Checking +$10,000
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, currency, current_balance_cents, created_at) VALUES (?, ?, NULL, 'Checking', 'depository', 'USD', 1000000, ?)",
      randomUUID(),
      user.id,
      now
    );
    // Credit card -$2,500 (stored negative)
    await db.run(
      "INSERT INTO accounts (id, user_id, item_id, name, type, currency, current_balance_cents, created_at) VALUES (?, ?, NULL, 'Visa', 'credit', 'USD', -250000, ?)",
      randomUUID(),
      user.id,
      now
    );
    const nw = await createReportsService(db).netWorth(user.id);
    expect(nw.assetsCents).toBe(1000000);
    expect(nw.liabilitiesCents).toBe(250000);
    expect(nw.netCents).toBe(750000);
  });

  it("spendingTrend mirrors cashflow expenses", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await seedTxn(db, user.id, acc, { date: "2026-05-10", amountCents: 3000 });
    const trend = await createReportsService(db).spendingTrend(user.id, 3);
    const may = trend.find((r) => r.month === "2026-05");
    expect(may?.spentCents).toBe(3000);
  });
});
