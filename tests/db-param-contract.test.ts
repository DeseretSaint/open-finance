import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";
import { createAccountsService } from "@/server/domain/accounts";
import { createCategoriesService } from "@/server/domain/categories";
import { createTransactionsService } from "@/server/domain/transactions";

/**
 * Regression: the CapSqliteDb adapter must pass params through as native
 * values (string|number|null), never String()-coerced. String(null) ===
 * "null" corrupts nullable columns. This test documents the CONTRACT the
 * adapter must satisfy (the in-memory test Db is stricter than SQLite about
 * types, so it catches the corruption).
 */
describe("Db adapter param contract (P8b)", () => {
  it("nullable params round-trip as NULL, not the string 'null'", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    const { user } = await solo.bootstrap({ displayName: "Phone", pin: "1234" });

    const accounts = createAccountsService(db);
    const account = await accounts.createManual(user.id, {
      name: "Checking",
      type: "depository",
      // subtype/mask explicitly null — the adapter must not turn these into "null"
      subtype: null,
      mask: null,
      currentBalanceCents: 1000,
    });
    const row = await db.get<{ subtype: string | null; mask: string | null }>(
      "SELECT subtype, mask FROM accounts WHERE id = ?",
      account.id
    );
    expect(row?.subtype).toBeNull();
    expect(row?.mask).toBeNull();

    const cats = createCategoriesService(db);
    const cat = await cats.create(user.id, { name: "Food", color: "#fff" });

    const txns = createTransactionsService(db);
    const txn = await txns.createManual(user.id, {
      accountId: account.id,
      amountCents: -500,
      date: "2026-07-01",
      name: "Lunch",
      userCategoryId: cat.id,
      userNote: null, // nullable — must stay NULL
    });
    const txnRow = await db.get<{ user_note: string | null; user_category_id: string | null }>(
      "SELECT user_note, user_category_id FROM transactions WHERE id = ?",
      txn.id
    );
    expect(txnRow?.user_note).toBeNull();
    expect(txnRow?.user_category_id).toBe(cat.id);
  });
});
