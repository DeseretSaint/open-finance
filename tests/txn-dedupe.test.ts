import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createCsvImportService } from "@/server/domain/csv-import";
import { createIngestService, type IngestTxn } from "@/server/domain/ingest";
import { createSyncService } from "@/server/plaid/sync";
import type { PlaidClient, PlaidSyncResult } from "@/server/plaid/adapter";
import { syncSoloItem, backfillSoloItem, type SoloNativeClient, type SoloPlaidTxn } from "@/lib/solo-plaid-sync";
import { encrypt } from "@/lib/crypto";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

function plaidTxn(over: Partial<IngestTxn> = {}): IngestTxn {
  return {
    plaidId: "plaid-tx-1",
    accountRowId: "acc",
    amountCents: -645,
    date: "2026-01-15",
    authorizedDate: "2026-01-14",
    name: "STARBUCKS",
    merchantName: "Starbucks",
    categoryPath: "Food and Drink|Restaurants",
    personalFinanceCategory: "Food and Drink|Restaurants",
    pending: false,
    ...over,
  };
}

describe("cross-source dedupe: Plaid sync vs CSV import", () => {
  it("ingest adopts a CSV-imported row instead of duplicating it", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const accountId = await seedManualAccount(db, user.id);
    await createCsvImportService(db).importCsv(
      user.id,
      accountId,
      "Date,Description,Amount\n2026-01-15,STARBUCKS,-6.45\n"
    );
    await createIngestService(db).upsert(plaidTxn({ accountRowId: accountId }), null);

    const rows = await db.all<{ id: string; plaid_transaction_id: string | null; source: string }>(
      "SELECT id, plaid_transaction_id, source FROM transactions WHERE account_id = ?",
      accountId
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].plaid_transaction_id).toBe("plaid-tx-1");
    expect(rows[0].source).toBe("plaid");
  });

  it("keeps the user's category when adopting an imported row", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const accountId = await seedManualAccount(db, user.id);
    await createCsvImportService(db).importCsv(
      user.id,
      accountId,
      "Date,Description,Amount\n2026-01-15,STARBUCKS,-6.45\n"
    );
    await db.run(
      "UPDATE transactions SET user_category_id = 'user-pick' WHERE account_id = ?",
      accountId
    );
    await createIngestService(db).upsert(plaidTxn({ accountRowId: accountId }), "system-cat");

    const row = await db.get<{ user_category_id: string | null; category_path: string | null }>(
      "SELECT user_category_id, category_path FROM transactions WHERE account_id = ?",
      accountId
    );
    expect(row?.user_category_id).toBe("user-pick");
    expect(row?.category_path).toBe("Food and Drink|Restaurants");
  });

  it("never adopts manual rows — the user's explicit entries stay untouched", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const accountId = await seedManualAccount(db, user.id);
    await db.run(
      "INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at) VALUES ('manual-1', ?, -645, '2026-01-15', 'STARBUCKS', 'manual', '2026-01-15T00:00:00.000Z')",
      accountId
    );
    await createIngestService(db).upsert(plaidTxn({ accountRowId: accountId }), null);

    const rows = await db.all<{ id: string; source: string }>(
      "SELECT id, source FROM transactions WHERE account_id = ? ORDER BY source",
      accountId
    );
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.id === "manual-1" && r.source === "manual")).toBe(true);
    expect(rows.some((r) => r.source === "plaid")).toBe(true);
  });

  it("matches names case- and whitespace-insensitively (bank CSV vs Plaid naming)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const accountId = await seedManualAccount(db, user.id);
    await createCsvImportService(db).importCsv(
      user.id,
      accountId,
      "Date,Description,Amount\n2026-01-15,Starbucks  #123,-6.45\n"
    );
    await createIngestService(db).upsert(
      plaidTxn({ accountRowId: accountId, name: "STARBUCKS #123" }),
      null
    );
    const rows = await db.all("SELECT id FROM transactions WHERE account_id = ?", accountId);
    expect(rows).toHaveLength(1);
  });

  it("CSV re-import skips rows that only differ in whitespace/case", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const accountId = await seedManualAccount(db, user.id);
    const svc = createCsvImportService(db);
    await svc.importCsv(user.id, accountId, "Date,Description,Amount\n2026-01-15,Starbucks  #123,-6.45\n");
    const second = await svc.importCsv(
      user.id,
      accountId,
      "Date,Description,Amount\n2026-01-15,STARBUCKS #123,-6.45\n"
    );
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("full sync service: CSV-imported history is adopted when Plaid delivers it", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const now = new Date().toISOString();
    // Linked account (item + plaid_account_id) like a real Plaid connection.
    const credsId = randomUUID();
    await db.run(
      "INSERT INTO plaid_credentials (id, user_id, client_id_enc, secret_enc, environment, updated_at) VALUES (?, ?, ?, ?, 'sandbox', ?)",
      credsId,
      user.id,
      encrypt("client", `${user.id}:plaid:${credsId}`),
      encrypt("secret", `${user.id}:plaid:${credsId}`),
      now
    );
    const itemId = randomUUID();
    await db.run(
      `INSERT INTO plaid_items (id, user_id, plaid_item_id, institution_id, institution_name, environment, access_token_enc, status, created_at)
       VALUES (?, ?, 'plaid-item-1', 'ins_1', 'Fake Bank', 'sandbox', ?, 'active', ?)`,
      itemId,
      user.id,
      encrypt("access-token", `${user.id}:plaid:${itemId}`),
      now
    );
    const accountId = randomUUID();
    await db.run(
      `INSERT INTO accounts (id, user_id, item_id, plaid_account_id, name, type, currency, created_at)
       VALUES (?, ?, ?, 'pa-1', 'Checking', 'depository', 'USD', ?)`,
      accountId,
      user.id,
      itemId,
      now
    );
    // User imports older history from a bank CSV first (the documented flow).
    await createCsvImportService(db).importCsv(
      user.id,
      accountId,
      "Date,Description,Amount\n2026-07-01,STARBUCKS,-8.50\n"
    );
    // Plaid then delivers the same transaction.
    const client: PlaidClient = {
      async createLinkToken() {
        return "";
      },
      async exchangePublicToken() {
        return { accessToken: "", itemId: "" };
      },
      async getAccounts() {
        return [];
      },
      async syncTransactions(): Promise<PlaidSyncResult> {
        return {
          added: [
            {
              id: "tx-dup",
              accountId: "pa-1",
              amountCents: 850, // Plaid sign: positive = money out
              date: "2026-07-01",
              authorizedDate: null,
              name: "Starbucks",
              merchantName: "Starbucks",
              categoryPath: "Food and Drink|Restaurants",
              personalFinanceCategory: "Food and Drink|Restaurants",
              pending: false,
            },
          ],
          modified: [],
          removed: [],
          nextCursor: "c1",
          hasMore: false,
        };
      },
      async getTransactions() {
        return [];
      },
      async removeItem() {},
      async testCredentials() {
        return { ok: true };
      },
    };
    const result = await createSyncService(db, () => client).syncOne(user.id, itemId);
    expect(result.ok).toBe(true);

    const rows = await db.all<{ plaid_transaction_id: string | null; source: string; amount_cents: number }>(
      "SELECT plaid_transaction_id, source, amount_cents FROM transactions WHERE account_id = ?",
      accountId
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].plaid_transaction_id).toBe("tx-dup");
    expect(rows[0].source).toBe("plaid");
    expect(rows[0].amount_cents).toBe(-850);
  });
});

describe("cross-source dedupe: solo (phone) sync vs CSV import", () => {
  function soloInput(db: ReturnType<typeof createTestDb>, userId: string, txns: SoloPlaidTxn[]) {
    const client = {
      syncTransactions: async () => ({
        added: txns,
        modified: [] as SoloPlaidTxn[],
        removed: [] as string[],
        nextCursor: null,
      }),
      getTransactions: async () => txns,
    } as SoloNativeClient;
    return {
      db,
      userId,
      itemId: "item-1",
      institutionName: null,
      environment: "sandbox",
      creds: { clientId: "c", secret: "s", environment: "sandbox" },
      accessToken: "access-1",
      accounts: [{ id: "acct-1", name: "Checking", type: "depository", mask: null }],
      client,
      cursor: null,
    };
  }

  async function seedLinkedAccount(db: ReturnType<typeof createTestDb>, userId: string): Promise<string> {
    const id = randomUUID();
    await db.run(
      `INSERT INTO accounts (id, user_id, item_id, plaid_account_id, name, type, currency, created_at)
       VALUES (?, ?, 'item-1', 'acct-1', 'Checking', 'depository', 'USD', ?)`,
      id,
      userId,
      new Date().toISOString()
    );
    return id;
  }

  it("solo sync adopts a CSV-imported row instead of duplicating it", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const accountId = await seedLinkedAccount(db, user.id);
    await createCsvImportService(db).importCsv(
      user.id,
      accountId,
      "Date,Description,Amount\n2026-07-28,NETFLIX,-19.99\n"
    );
    const result = await syncSoloItem(
      soloInput(db, user.id, [
        {
          id: "solo-tx-1",
          accountId: "acct-1",
          amountCents: 1999, // Plaid sign: positive = money out
          date: "2026-07-28",
          authorizedDate: null,
          name: "Netflix",
          merchantName: null,
          categoryPath: null,
          personalFinanceCategory: null,
          pending: false,
        },
      ])
    );
    expect(result.ok).toBe(true);
    const rows = await db.all<{ plaid_transaction_id: string | null; source: string }>(
      "SELECT plaid_transaction_id, source FROM transactions WHERE account_id = ?",
      accountId
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].plaid_transaction_id).toBe("solo-tx-1");
    expect(rows[0].source).toBe("plaid");
  });

  it("backfill counts adopted rows as 0 added (they were already in the app)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const accountId = await seedLinkedAccount(db, user.id);
    await createCsvImportService(db).importCsv(
      user.id,
      accountId,
      "Date,Description,Amount\n2025-09-15,OLD MERCHANT,-59.99\n"
    );
    const result = await backfillSoloItem(
      soloInput(db, user.id, [
        {
          id: "old-tx-1",
          accountId: "acct-1",
          amountCents: 5999,
          date: "2025-09-15",
          authorizedDate: null,
          name: "OLD MERCHANT",
          merchantName: null,
          categoryPath: null,
          personalFinanceCategory: null,
          pending: false,
        },
      ])
    );
    expect(result.ok).toBe(true);
    expect(result.added).toBe(0);
    const rows = await db.all<{ plaid_transaction_id: string | null }>(
      "SELECT plaid_transaction_id FROM transactions WHERE account_id = ?",
      accountId
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].plaid_transaction_id).toBe("old-tx-1");
  });
});
