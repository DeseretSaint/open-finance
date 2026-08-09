import { describe, expect, it } from "vitest";
import { createTransactionsService } from "@/server/domain/transactions";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

async function seed(db: ReturnType<typeof createTestDb>) {
  const user = await seedUser(db);
  const acc = await seedManualAccount(db, user.id, "Checking");
  const acc2 = await seedManualAccount(db, user.id, "Savings");
  const svc = createTransactionsService(db);
  const t1 = await svc.createManual(user.id, {
    accountId: acc,
    amountCents: -2000,
    date: "2026-02-01",
    name: "Paycheck",
  });
  const t2 = await svc.createManual(user.id, {
    accountId: acc,
    amountCents: 850,
    date: "2026-02-05",
    name: "Starbucks",
  });
  const t3 = await svc.createManual(user.id, {
    accountId: acc2,
    amountCents: 1200,
    date: "2026-01-20",
    name: "Rent",
  });
  return { user, acc, acc2, svc, t1, t2, t3 };
}

describe("transactions", () => {
  it("lists all transactions newest first", async () => {
    const { svc, user } = await seed(createTestDb());
    const { rows, total } = await svc.list(user.id, { limit: 50, offset: 0 });
    expect(total).toBe(3);
    expect(rows[0].name).toBe("Starbucks"); // 2026-02-05
  });

  it("filters by account", async () => {
    const { svc, user, acc } = await seed(createTestDb());
    const { rows } = await svc.list(user.id, { limit: 50, offset: 0, accountId: acc });
    expect(rows).toHaveLength(2);
  });

  it("filters by date range", async () => {
    const { svc, user } = await seed(createTestDb());
    const { rows } = await svc.list(user.id, { limit: 50, offset: 0, from: "2026-02-01", to: "2026-02-28" });
    expect(rows).toHaveLength(2);
  });

  it("filters pendingOnly to pending transactions", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createTransactionsService(db);
    await svc.createManual(user.id, { accountId: acc, amountCents: -2000, date: "2026-02-01", name: "Paycheck" });
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, pending, source, created_at)
       VALUES ('pend-1', ?, 'plaid-pend', 850, '2026-02-06', 'Pending Coffee', 1, 'plaid', '2026-02-06T00:00:00.000Z')`,
      acc
    );
    const all = await svc.list(user.id, { limit: 50, offset: 0 });
    expect(all.total).toBe(2);
    const pending = await svc.list(user.id, { limit: 50, offset: 0, pendingOnly: true });
    expect(pending.total).toBe(1);
    expect(pending.rows[0].name).toBe("Pending Coffee");
    expect(pending.rows[0].pending).toBe(1);
  });

  it("searches by name", async () => {
    const { svc, user } = await seed(createTestDb());
    const { rows } = await svc.list(user.id, { limit: 50, offset: 0, q: "star" });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Starbucks");
  });

  it("paginates", async () => {
    const { svc, user } = await seed(createTestDb());
    const page1 = await svc.list(user.id, { limit: 2, offset: 0 });
    const page2 = await svc.list(user.id, { limit: 2, offset: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(1);
  });

  it("blocks creating a transaction on another user's account", async () => {
    const db = createTestDb();
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    const acc = await seedManualAccount(db, u1.id);
    const svc = createTransactionsService(db);
    await expect(
      svc.createManual(u2.id, { accountId: acc, amountCents: 100, date: "2026-01-01", name: "Sneak" })
    ).rejects.toThrow();
  });

  it("updates category/note/exclude on any transaction", async () => {
    const { svc, user, t1 } = await seed(createTestDb());
    const updated = await svc.update(user.id, t1.id, {
      userNote: "bonus",
      excludeFromBudgets: true,
    });
    expect(updated.user_note).toBe("bonus");
    expect(updated.exclude_from_budgets).toBe(1);
  });

  it("updates amount/date/name only on manual transactions", async () => {
    const { svc, user, t2 } = await seed(createTestDb());
    const updated = await svc.update(user.id, t2.id, { amountCents: 900, name: "Local Coffee" });
    expect(updated.amount_cents).toBe(900);
    expect(updated.name).toBe("Local Coffee");
  });

  it("refuses to delete a plaid-sourced transaction", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, source, created_at)
       VALUES ('p1', ?, 'plaid-9', 500, '2026-01-01', 'Synced', 'plaid', '2026-01-01T00:00:00.000Z')`,
      acc
    );
    const svc = createTransactionsService(db);
    await expect(svc.removeManual(user.id, "p1")).rejects.toThrow();
  });

  it("deletes manual transactions", async () => {
    const { svc, user, t3 } = await seed(createTestDb());
    await svc.removeManual(user.id, t3.id);
    const { total } = await svc.list(user.id, { limit: 50, offset: 0 });
    expect(total).toBe(2);
  });

  it("rejects other users' reads", async () => {
    const db = createTestDb();
    const u1 = await seedUser(db, "alice");
    const u2 = await seedUser(db, "bob");
    const acc = await seedManualAccount(db, u1.id);
    const svc = createTransactionsService(db);
    const t = await svc.createManual(u1.id, { accountId: acc, amountCents: 100, date: "2026-01-01", name: "Mine" });
    await expect(svc.get(u2.id, t.id)).rejects.toThrow();
  });

  it("review filter surfaces Plaid-sourced, uncategorized transactions only", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createTransactionsService(db);
    // Plaid-sourced, uncategorized -> should appear in review
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, source, created_at)
       VALUES ('pl-1', ?, 'plaid-1', -550, '2026-02-10', 'Grocery Store', 'plaid', '2026-02-10T00:00:00.000Z')`,
      acc
    );
    // Manual-sourced, uncategorized -> should NOT appear (human entered it)
    await svc.createManual(user.id, { accountId: acc, amountCents: -300, date: "2026-02-11", name: "Cash" });
    // Plaid-sourced, already categorized -> should NOT appear
    const cat = await db.run(`INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-1', ?, 'Food', '2026-01-01T00:00:00.000Z')`, user.id);
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, user_category_id, source, created_at)
       VALUES ('pl-2', ?, 'plaid-2', -700, '2026-02-12', 'Restaurant', 'cat-1', 'plaid', '2026-02-12T00:00:00.000Z')`,
      acc
    );
    const review = await svc.list(user.id, { limit: 50, offset: 0, review: true });
    expect(review.total).toBe(1);
    expect(review.rows[0].id).toBe("pl-1");
  });

  it("review filter excludes internal transfers and pending rows", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createTransactionsService(db);
    // Posted, non-transfer Plaid uncategorized -> appears
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, source, created_at)
       VALUES ('pl-1', ?, 'plaid-1', -550, '2026-02-10', 'Grocery Store', 'plaid', '2026-02-10T00:00:00.000Z')`,
      acc
    );
    // Internal transfer (card payment between own accounts) -> excluded from review
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, source, is_transfer, created_at)
       VALUES ('tx-1', ?, 'plaid-2', -200, '2026-02-10', 'Card Payment', 'plaid', 1, '2026-02-10T00:00:00.000Z')`,
      acc
    );
    // Pending Plaid row -> excluded from review
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, source, pending, created_at)
       VALUES ('pd-1', ?, 'plaid-3', -999, '2026-02-10', 'Pending Sub', 'plaid', 1, '2026-02-10T00:00:00.000Z')`,
      acc
    );
    const review = await svc.list(user.id, { limit: 50, offset: 0, review: true });
    expect(review.total).toBe(1);
    expect(review.rows[0].id).toBe("pl-1");
  });

  it("batchCategorize applies one category to many review items", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createTransactionsService(db);
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, source, created_at)
       VALUES ('pl-1', ?, 'plaid-1', -550, '2026-02-10', 'Grocery', 'plaid', '2026-02-10T00:00:00.000Z')`,
      acc
    );
    await db.run(
      `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, name, source, created_at)
       VALUES ('pl-2', ?, 'plaid-2', -700, '2026-02-12', 'Restaurant', 'plaid', '2026-02-12T00:00:00.000Z')`,
      acc
    );
    const cat = await db.run(`INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-1', ?, 'Food', '2026-01-01T00:00:00.000Z')`, user.id);
    const updated = await svc.batchCategorize(user.id, ["pl-1", "pl-2", "does-not-exist"], "cat-1");
    expect(updated).toBe(2); // only the 2 real, reviewable rows
    const review = await svc.list(user.id, { limit: 50, offset: 0, review: true });
    expect(review.total).toBe(0);
    const after = await svc.list(user.id, { limit: 50, offset: 0 });
    expect(after.rows.find((r) => r.id === "pl-1")!.user_category_id).toBe("cat-1");
  });
});
