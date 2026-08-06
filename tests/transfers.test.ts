import { describe, expect, it } from "vitest";
import { markLinkedTransfers } from "@/server/domain/transfers";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";
import { randomUUID } from "node:crypto";

describe("linked account transfers", () => {
  it("marks linked credit-card payments and leaves them out of totals", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const bank = await seedManualAccount(db, user.id, "Checking", "depository");
    const card = await seedManualAccount(db, user.id, "Credit Card", "credit");
    const now = new Date().toISOString();
    const date = "2026-08-05";
    for (const [account, amount, name] of [[bank, -50000, "Credit Card Payment"], [card, 50000, "Payment - Thank You"]] as const) {
      await db.run(
        `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at) VALUES (?, ?, ?, ?, ?, 'plaid', ?)`,
        randomUUID(), account, amount, date, name, now
      );
    }
    expect(await markLinkedTransfers(db, user.id)).toBe(2);
    const rows = await db.all<{ is_transfer: number }>("SELECT is_transfer FROM transactions ORDER BY name");
    expect(rows.every((r) => r.is_transfer === 1)).toBe(true);
  });

  it("does not classify an unpaired card payment as a transfer", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const bank = await seedManualAccount(db, user.id, "Checking", "depository");
    await db.run(
      `INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at) VALUES (?, ?, ?, ?, ?, 'plaid', ?)`,
      randomUUID(), bank, -50000, "2026-08-05", "Credit Card Payment", new Date().toISOString()
    );
    expect(await markLinkedTransfers(db, user.id)).toBe(0);
  });
});

