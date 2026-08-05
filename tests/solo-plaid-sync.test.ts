import { describe, expect, it } from "vitest";
import { syncSoloItem, type SoloPlaidTxn, type SoloNativeClient } from "@/lib/solo-plaid-sync";
import type { PlaidClient } from "@/server/plaid/adapter";
import { createTestDb, seedUser } from "./helpers";

function fakeClient(added: SoloPlaidTxn[], cursor: string | null = null) {
  return {
    syncTransactions: async () => ({
      added,
      modified: [] as SoloPlaidTxn[],
      removed: [] as string[],
      nextCursor: cursor,
    }),
  } as SoloNativeClient;
}

describe("solo plaid sync (webview-safe import)", () => {
  it("creates accounts + transactions on first link (Plaid sign flipped)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const client = fakeClient([
      {
        id: "txn-1",
        accountId: "acct-1",
        amountCents: 1999, // Plaid: positive = money out
        date: "2026-07-28",
        authorizedDate: "2026-07-28",
        name: "Netflix",
        merchantName: null,
        categoryPath: "Entertainment",
        personalFinanceCategory: null,
        pending: false,
      },
      {
        id: "txn-2",
        accountId: "acct-1",
        amountCents: -250000, // Plaid: negative = money in (income)
        date: "2026-07-01",
        authorizedDate: null,
        name: "Paycheck",
        merchantName: null,
        categoryPath: "Income",
        personalFinanceCategory: null,
        pending: false,
      },
    ]);

    const result = await syncSoloItem({
      db,
      userId: user.id,
      itemId: "item-1",
      institutionName: "Test Bank",
      environment: "sandbox",
      creds: { clientId: "c", secret: "s", environment: "sandbox" },
      accessToken: "access-1",
      accounts: [{ id: "acct-1", name: "Checking", type: "depository", mask: "1234" }],
      client,
      cursor: null,
    });

    expect(result.ok).toBe(true);
    expect(result.added).toBe(2);

    const accounts = await db.all("SELECT name, plaid_account_id FROM accounts WHERE user_id = ?", user.id);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].plaid_account_id).toBe("acct-1");

    const txns = await db.all(
      "SELECT t.name, t.amount_cents, t.source FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = ?",
      user.id
    );
    expect(txns).toHaveLength(2);
    const byName = Object.fromEntries(txns.map((t) => [t.name, t]));
    // Sign flipped: Plaid debit 1999 → stored -1999; Plaid credit -250000 → stored +250000.
    expect(byName["Netflix"].amount_cents).toBe(-1999);
    expect(byName["Paycheck"].amount_cents).toBe(250000);
    expect(txns.every((t) => t.source === "plaid")).toBe(true);
  });

  it("re-sync upserts by plaid_transaction_id instead of duplicating", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const txn: SoloPlaidTxn = {
      id: "txn-1",
      accountId: "acct-1",
      amountCents: 1999,
      date: "2026-07-28",
      authorizedDate: null,
      name: "Netflix",
      merchantName: null,
      categoryPath: null,
      personalFinanceCategory: null,
      pending: false,
    };
    const input = {
      db,
      userId: user.id,
      itemId: "item-1",
      institutionName: null,
      environment: "sandbox",
      creds: { clientId: "c", secret: "s", environment: "sandbox" },
      accessToken: "access-1",
      accounts: [{ id: "acct-1", name: "Checking", type: "depository", mask: null }],
      client: fakeClient([txn]),
      cursor: null,
    };
    await syncSoloItem(input);
    await syncSoloItem({ ...input, client: fakeClient([{ ...txn, amountCents: 2500 }]) });

    const rows = await db.all(
      "SELECT t.name, t.amount_cents FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = ?",
      user.id
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(-2500);
  });

  it("never throws — returns ok:false with a message on failure", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const result = await syncSoloItem({
      db,
      userId: user.id,
      itemId: "item-1",
      institutionName: null,
      environment: "sandbox",
      creds: { clientId: "c", secret: "s", environment: "sandbox" },
      accessToken: "access-1",
      accounts: [],
      client: {
        syncTransactions: async () => {
          throw new Error("boom");
        },
      } as SoloNativeClient,
      cursor: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});

describe("createSoloSyncClient adapter (v0.3.11 regression)", () => {
  it("passes accessToken/cursor positionally so the native proxy stops rejecting with 'missing accessToken'", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    // The native PlaidClient signature is (creds, accessToken, cursor) —
    // positional. syncSoloItem calls client.syncTransactions({...}) with ONE
    // object. Before the adapter, `as never` hid the mismatch and accessToken
    // arrived undefined → every sync imported zero transactions.
    let seenAccessToken: string | null = null;
    let seenCursor: string | null = "never";
    const nativeLike = {
      syncTransactions: async (
        _creds: { clientId: string; secret: string; environment: string },
        accessToken: string,
        cursor: string | null
      ) => {
        seenAccessToken = accessToken;
        seenCursor = cursor;
        return {
          added: [
            {
              id: "txn-1",
              accountId: "acct-1",
              amountCents: 1999,
              date: "2026-07-28",
              authorizedDate: null,
              name: "Netflix",
              merchantName: null,
              categoryPath: null,
              personalFinanceCategory: null,
              pending: false,
            },
          ],
          modified: [],
          removed: [],
          nextCursor: "cursor-2",
          hasMore: false,
        };
      },
    } as unknown as PlaidClient;

    const { createSoloSyncClient } = await import("@/server/plaid/native");
    const result = await syncSoloItem({
      db,
      userId: user.id,
      itemId: "item-1",
      institutionName: null,
      environment: "sandbox",
      creds: { clientId: "c", secret: "s", environment: "sandbox" },
      accessToken: "access-1",
      accounts: [{ id: "acct-1", name: "Checking", type: "depository", mask: null }],
      client: createSoloSyncClient(nativeLike),
      cursor: null,
    });

    expect(seenAccessToken).toBe("access-1");
    expect(seenCursor).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
  });
});
