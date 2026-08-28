import { describe, expect, it } from "vitest";
import { createTransactionsService } from "@/server/domain/transactions";
import { createAccountsService } from "@/server/domain/accounts";
import { MAX_AMOUNT_CENTS } from "@/server/domain/money";
import { createTestDb, seedUser, seedManualAccount } from "./helpers";

describe("money magnitude bounds", () => {
  it("createManual rejects a transaction amount above MAX_AMOUNT_CENTS", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "alice");
    const acct = await seedManualAccount(db, user.id);
    const svc = createTransactionsService(db);
    await expect(
      svc.createManual(user.id, {
        accountId: acct,
        amountCents: MAX_AMOUNT_CENTS + 1,
        date: "2026-01-01",
        name: "Too big",
      })
    ).rejects.toThrow();
    const rows = await db.all("SELECT * FROM transactions WHERE account_id = ?", acct);
    expect(rows).toHaveLength(0);
  });

  it("createManual accepts a normal negative amount", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "alice");
    const acct = await seedManualAccount(db, user.id);
    const svc = createTransactionsService(db);
    const t = await svc.createManual(user.id, {
      accountId: acct,
      amountCents: -5000,
      date: "2026-01-01",
      name: "Coffee",
    });
    expect(t.amount_cents).toBe(-5000);
  });

  it("accounts.createManual rejects a currentBalance above MAX_AMOUNT_CENTS", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "bob");
    const svc = createAccountsService(db);
    await expect(
      svc.createManual(user.id, {
        name: "Fat account",
        currentBalanceCents: -(MAX_AMOUNT_CENTS + 100),
        availableBalanceCents: -(MAX_AMOUNT_CENTS + 100),
      })
    ).rejects.toThrow();
    const rows = await db.all("SELECT * FROM accounts WHERE user_id = ?", user.id);
    expect(rows).toHaveLength(0);
  });

  it("accounts.createManual accepts a normal balance", async () => {
    const db = createTestDb();
    const user = await seedUser(db, "bob");
    const svc = createAccountsService(db);
    const a = await svc.createManual(user.id, {
      name: "Checking",
      currentBalanceCents: 123456,
      availableBalanceCents: 100000,
    });
    expect(a.current_balance_cents).toBe(123456);
  });
});
