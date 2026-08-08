import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PlaidClient, PlaidSyncResult } from "@/server/plaid/adapter";
import { createSyncService } from "@/server/plaid/sync";
import { encrypt } from "@/lib/crypto";
import { createTestDb, seedUser } from "./helpers";

/** Fake client: first page returns added+removed, second page completes the sync. */
function fakeClient(pages: PlaidSyncResult[]): PlaidClient {
  let call = 0;
  return {
    async createLinkToken() {
      return "link-token";
    },
    async exchangePublicToken() {
      return { accessToken: "access", itemId: "item" };
    },
    async getAccounts() {
      return [
        {
          id: "pa-1",
          name: "Checking",
          officialName: null,
          type: "depository",
          subtype: "checking",
          mask: "0001",
          currentBalanceCents: 500000,
          availableBalanceCents: 490000,
          currency: "USD",
        },
      ];
    },
    async syncTransactions(_creds, _token, _cursor) {
      void _creds;
      void _token;
      void _cursor;
      const res = pages[Math.min(call, pages.length - 1)];
      call++;
      return res;
    },
    async getTransactions() {
      return [];
    },
    async removeItem() {},
    async testCredentials() {
      return { ok: true };
    },
  };
}

async function seedItem(db: ReturnType<typeof createTestDb>, userId: string): Promise<string> {
  const now = new Date().toISOString();
  const credsId = randomUUID();
  await db.run(
    "INSERT INTO plaid_credentials (id, user_id, client_id_enc, secret_enc, environment, updated_at) VALUES (?, ?, ?, ?, 'sandbox', ?)",
    credsId,
    userId,
    encrypt("client", `${userId}:plaid:${credsId}`),
    encrypt("secret", `${userId}:plaid:${credsId}`),
    now
  );
  const itemId = randomUUID();
  await db.run(
    `INSERT INTO plaid_items (id, user_id, plaid_item_id, institution_id, institution_name, environment, access_token_enc, status, created_at)
     VALUES (?, ?, 'plaid-item-1', 'ins_1', 'Fake Bank', 'sandbox', ?, 'active', ?)`,
    itemId,
    userId,
    encrypt("access-token", `${userId}:plaid:${itemId}`),
    now
  );
  await db.run(
    `INSERT INTO accounts (id, user_id, item_id, plaid_account_id, name, type, currency, created_at)
     VALUES (?, ?, ?, 'pa-1', 'Checking', 'depository', 'USD', ?)`,
    randomUUID(),
    userId,
    itemId,
    now
  );
  return itemId;
}

describe("sync service", () => {
  it("ingests added/modified/removed across pages and persists the cursor", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const itemId = await seedItem(db, user.id);
    const client = fakeClient([
      {
        added: [
          {
            id: "tx-1",
            accountId: "pa-1",
            amountCents: 850,
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
        nextCursor: "cursor-1",
        hasMore: true,
      },
      {
        added: [],
        modified: [],
        removed: [{ transactionId: "old-tx" }],
        nextCursor: "cursor-2",
        hasMore: false,
      },
    ]);

    const svc = createSyncService(db, () => client);
    const result = await svc.syncOne(user.id, itemId);

    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);

    const item = await db.get<{ cursor: string | null; last_sync_at: string | null }>(
      "SELECT cursor, last_sync_at FROM plaid_items WHERE id = ?",
      itemId
    );
    expect(item?.cursor).toBe("cursor-2");
    expect(item?.last_sync_at).toBeTruthy();

    const txns = await db.all<{ id: string; plaid_transaction_id: string }>("SELECT id, plaid_transaction_id FROM transactions");
    expect(txns).toHaveLength(1);
    expect(txns[0].plaid_transaction_id).toBe("tx-1");

    const history = await db.all("SELECT * FROM balance_history");
    expect(history).toHaveLength(1);
    expect((history[0] as { balance_cents: number }).balance_cents).toBe(500000);

    const account = await db.get<{ current_balance_cents: number | null }>(
      "SELECT current_balance_cents FROM accounts WHERE item_id = ?",
      itemId
    );
    expect(account?.current_balance_cents).toBe(500000);
  });

  it("applies category matching during ingest", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const itemId = await seedItem(db, user.id);
    await db.run(
      "INSERT INTO categories (id, user_id, name, color, plaid_paths, is_system, created_at) VALUES (?, ?, 'Restaurants', '#10B981', 'Food and Drink|Restaurants', 0, ?)",
      randomUUID(),
      user.id,
      new Date().toISOString()
    );
    const client = fakeClient([
      {
        added: [
          {
            id: "tx-2",
            accountId: "pa-1",
            amountCents: 1000,
            date: "2026-07-02",
            authorizedDate: null,
            name: "Chipotle",
            merchantName: "Chipotle",
            categoryPath: "Food and Drink|Restaurants",
            personalFinanceCategory: "Food and Drink|Restaurants",
            pending: false,
          },
        ],
        modified: [],
        removed: [],
        nextCursor: "c",
        hasMore: false,
      },
    ]);
    const svc = createSyncService(db, () => client);
    await svc.syncOne(user.id, itemId);
    const row = await db.get<{ user_category_id: string | null }>(
      "SELECT user_category_id FROM transactions WHERE plaid_transaction_id = 'tx-2'"
    );
    expect(row?.user_category_id).toBeTruthy();
  });

  it("marks the item errored and reports a friendly message on failure", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const itemId = await seedItem(db, user.id);
    const broken: PlaidClient = {
      async createLinkToken() {
        return "";
      },
      async exchangePublicToken() {
        return { accessToken: "", itemId: "" };
      },
      async getAccounts() {
        throw new Error("boom");
      },
      async syncTransactions() {
        throw new Error("boom");
      },
      async getTransactions() {
        return [];
      },
      async removeItem() {},
      async testCredentials() {
        return { ok: false, message: "nope" };
      },
    };
    const svc = createSyncService(db, () => broken);
    const result = await svc.syncOne(user.id, itemId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("boom");
    const item = await db.get<{ status: string }>("SELECT status FROM plaid_items WHERE id = ?", itemId);
    expect(item?.status).toBe("error");
  });

  it("syncAll covers every item and never throws", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const itemId = await seedItem(db, user.id);
    const client = fakeClient([
      {
        added: [],
        modified: [],
        removed: [],
        nextCursor: "c",
        hasMore: false,
      },
    ]);
    const svc = createSyncService(db, () => client);
    const results = await svc.syncAll(user.id);
    expect(results).toHaveLength(1);
    expect(results[0].itemId).toBe(itemId);
    expect(results[0].ok).toBe(true);
  });
});
