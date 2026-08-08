import { describe, expect, it } from "vitest";
import { createTestDb, seedUser } from "./helpers";
import { autoCategorize } from "@/server/domain/categorizer";
import { createCategoriesService } from "@/server/domain/categories";
import { createTransactionsService } from "@/server/domain/transactions";
import { createAccountsService } from "@/server/domain/accounts";

describe("autoCategorize (categorize-now Apply)", () => {
  it("assigns categories by Plaid path, leaves gray areas, respects the backlog window", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await createAccountsService(db).createManual(user.id, { name: "Checking", type: "depository", currentBalanceCents: 0 });
    const cats = createCategoriesService(db);
    const groceries = await cats.create(user.id, { name: "Groceries", color: "#10B981", plaidPaths: "Food and Drink|Groceries" });
    const txns = createTransactionsService(db);

    const today = new Date().toISOString().slice(0, 10);
    const t1 = await txns.createManual(user.id, {
      accountId: acc.id,
      amountCents: -5230,
      date: today,
      name: "Whole Foods",
    });
    const t2 = await txns.createManual(user.id, {
      accountId: acc.id,
      amountCents: -12000,
      date: today,
      name: "Venmo transfer",
    });
    // createManual doesn't take Plaid paths — set them like a sync would.
    await db.run("UPDATE transactions SET category_path = ? WHERE id = ?", "Food and Drink|Groceries|Supermarkets", t1.id);
    await db.run("UPDATE transactions SET category_path = ? WHERE id = ?", "Transfers", t2.id);

    const res = await autoCategorize(db, user.id, 12);
    expect(res.categorized).toBe(1);
    expect(res.leftForAgent).toBe(1);
    expect(res.total).toBe(2);

    const list = await txns.list(user.id, { limit: 10, offset: 0 });
    const groceriesTxn = list.rows.find((t) => t.name === "Whole Foods");
    const transfer = list.rows.find((t) => t.name === "Venmo transfer");
    expect(groceriesTxn?.user_category_id).toBe(groceries.id);
    expect(transfer?.user_category_id).toBeNull();
  });

  it("backlog 0 (moving-forward) categorizes what has come in so far", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await createAccountsService(db).createManual(user.id, { name: "Checking", type: "depository", currentBalanceCents: 0 });
    const cats = createCategoriesService(db);
    await cats.create(user.id, { name: "Groceries", color: "#10B981", plaidPaths: "Food and Drink|Groceries" });
    const txns = createTransactionsService(db);
    const today = new Date().toISOString().slice(0, 10);
    const t = await txns.createManual(user.id, {
      accountId: acc.id,
      amountCents: -900,
      date: today,
      name: "Kroger",
    });
    await db.run("UPDATE transactions SET category_path = ? WHERE id = ?", "Food and Drink|Groceries|Supermarkets", t.id);
    const res = await autoCategorize(db, user.id, 0);
    expect(res.categorized).toBe(1);
    expect(res.backlogMonths).toBe(0);
  });

  it("name-keyword fallback categorizes obvious merchants with no Plaid category data", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await createAccountsService(db).createManual(user.id, { name: "Checking", type: "depository", currentBalanceCents: 0 });
    await createCategoriesService(db).ensureSystem(user.id);
    const txns = createTransactionsService(db);
    const today = new Date().toISOString().slice(0, 10);
    // No category_path / pfc set — the old matcher would punt these to the
    // agent; the name-keyword fallback should resolve the obvious ones.
    await txns.createManual(user.id, { accountId: acc.id, amountCents: -645, date: today, name: "STARBUCKS" });
    await txns.createManual(user.id, { accountId: acc.id, amountCents: -2310, date: today, name: "AMAZON" });
    await txns.createManual(user.id, { accountId: acc.id, amountCents: -999, date: today, name: "POS DEBIT MYSTERY" });

    const res = await autoCategorize(db, user.id, 1);
    expect(res.categorized).toBe(2); // Starbucks + Amazon
    expect(res.leftForAgent).toBe(1); // POS DEBIT MYSTERY

    const list = await txns.list(user.id, { limit: 10, offset: 0 });
    const starbucks = list.rows.find((t) => t.name === "STARBUCKS");
    const mystery = list.rows.find((t) => t.name === "POS DEBIT MYSTERY");
    const foodCat = await createCategoriesService(db).list(user.id);
    const food = foodCat.find((c) => c.name === "Food & Dining");
    expect(starbucks?.user_category_id).toBe(food?.id);
    expect(mystery?.user_category_id).toBeNull();
  });
});
