import { describe, expect, it } from "vitest";
import { createIngestService } from "@/server/domain/ingest";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

function txn(over: Partial<Parameters<ReturnType<typeof createIngestService>["upsert"]>[0]> = {}) {
  return {
    plaidId: "plaid-1",
    accountRowId: "acc",
    amountCents: -5000,
    date: "2026-01-15",
    authorizedDate: "2026-01-14",
    name: "Starbucks",
    merchantName: "Starbucks",
    categoryPath: "Food and Drink|Restaurants",
    personalFinanceCategory: "Food and Drink|Restaurants",
    pending: false,
    ...over,
  };
}

describe("ingest", () => {
  it("inserts a new transaction", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createIngestService(db);
    await svc.upsert(txn({ accountRowId: acc }), null);

    const rows = await db.all<{ id: string; source: string }>("SELECT id, source FROM transactions");
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("plaid");
  });

  it("updates the same row when a pending transaction posts", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createIngestService(db);
    await svc.upsert(txn({ accountRowId: acc, pending: true, amountCents: 100 }), null);
    await svc.upsert(txn({ accountRowId: acc, pending: false, amountCents: 125 }), null);

    const rows = await db.all<{ amount_cents: number; pending: number }>("SELECT amount_cents, pending FROM transactions");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(125);
    expect(rows[0].pending).toBe(0);
  });

  it("keeps a user-assigned category across ingest updates", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createIngestService(db);
    await svc.upsert(txn({ accountRowId: acc }), null);
    await db.run("UPDATE transactions SET user_category_id = 'user-cat' WHERE plaid_transaction_id = ?", "plaid-1");
    await svc.upsert(txn({ accountRowId: acc, amountCents: 999 }), "system-cat");
    const row = await db.get<{ user_category_id: string | null }>(
      "SELECT user_category_id FROM transactions WHERE plaid_transaction_id = ?",
      "plaid-1"
    );
    expect(row?.user_category_id).toBe("user-cat");
  });

  it("removes a transaction by Plaid id", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    const svc = createIngestService(db);
    await svc.upsert(txn({ accountRowId: acc }), null);
    await svc.remove("plaid-1");
    const rows = await db.all("SELECT id FROM transactions");
    expect(rows).toHaveLength(0);
  });

  it("never touches manual rows (no plaid_transaction_id)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const acc = await seedManualAccount(db, user.id);
    await db.run(
      "INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at) VALUES ('m1', ?, 100, '2026-01-01', 'Manual', 'manual', '2026-01-01T00:00:00.000Z')",
      acc
    );
    const svc = createIngestService(db);
    await svc.upsert(txn({ accountRowId: acc }), null);
    await svc.remove("does-not-exist");
    const rows = await db.all<{ id: string }>("SELECT id FROM transactions");
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.id === "m1")).toBe(true);
  });
});
