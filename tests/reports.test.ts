import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createReportsService } from "@/server/domain/reports";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

async function seedCategory(db: ReturnType<typeof createTestDb>, userId: string, name: string) {
  const id = randomUUID();
  await db.run(
    "INSERT INTO categories (id, user_id, name, color, is_system, created_at) VALUES (?, ?, ?, NULL, 1, ?)",
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

/** Month-start ISO for `offset` months relative to the current month (0 = this month). */
function monthStart(offset: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).toISOString().slice(0, 10);
}

function monthName(offset: number): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1 + offset).padStart(2, "0")}`;
}

describe("reports (P6)", () => {
  it("spendingByCategory sums expenses (negative amounts) by category", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const food = await seedCategory(db, user.id, "Food");
    const thisMonth = monthStart(0);
    const nextMonth = monthStart(1);
    await seedTxn(db, user.id, acc, { date: thisMonth.slice(0, 8) + "01", amountCents: -4000, categoryId: food });
    await seedTxn(db, user.id, acc, { date: thisMonth.slice(0, 8) + "10", amountCents: -2000, categoryId: food });
    await seedTxn(db, user.id, acc, { date: thisMonth.slice(0, 8) + "20", amountCents: -3000, categoryId: null });
    await seedTxn(db, user.id, acc, { date: monthStart(-1).slice(0, 8) + "01", amountCents: -9999, categoryId: food }); // out of range

    const rows = await createReportsService(db).spendingByCategory(user.id, thisMonth, nextMonth);
    expect(rows).toHaveLength(2);
    const foodRow = rows.find((r) => r.categoryName === "Food");
    expect(foodRow?.spentCents).toBe(6000);
    const uncat = rows.find((r) => r.categoryName === "Uncategorized");
    expect(uncat?.spentCents).toBe(3000);
  });

  it("cashflow returns zero-filled months oldest→newest (income positive, expenses negative)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    // Previous month: income +5000, expense -3000 (net +2000)
    const prev = monthStart(-1);
    await seedTxn(db, user.id, acc, { date: prev.slice(0, 8) + "05", amountCents: 5000 });
    await seedTxn(db, user.id, acc, { date: prev.slice(0, 8) + "10", amountCents: -3000 });
    // This month: nothing (zero-filled)

    const rows = await createReportsService(db).cashflow(user.id, 3);
    expect(rows).toHaveLength(3);
    const seededMonth = rows.find((r) => r.month === monthName(-1));
    expect(seededMonth?.incomeCents).toBe(5000);
    expect(seededMonth?.expenseCents).toBe(3000);
    expect(seededMonth?.netCents).toBe(2000);
    const thisMonthRow = rows.find((r) => r.month === monthName(0));
    expect(thisMonthRow?.incomeCents).toBe(0);
    expect(thisMonthRow?.expenseCents).toBe(0);
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
    const prev = monthStart(-1);
    await seedTxn(db, user.id, acc, { date: prev.slice(0, 8) + "10", amountCents: -3000 });
    const trend = await createReportsService(db).spendingTrend(user.id, 3);
    const seededMonth = trend.find((r) => r.month === monthName(-1));
    expect(seededMonth?.spentCents).toBe(3000);
  });
});
