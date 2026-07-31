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
});
