import { randomUUID } from "node:crypto";
import { decrypt } from "@/lib/crypto";
import { apiErrors } from "@/lib/api";
import { getDb, type Db } from "@/server/db/adapter";
import type { PlaidClient, PlaidCreds, PlaidEnvironment } from "./adapter";
import { realPlaidClient } from "./real";
import { createCategoriesService } from "@/server/domain/categories";
import { createIngestService } from "@/server/domain/ingest";

function now(): string {
  return new Date().toISOString();
}

function today(): string {
  return now().slice(0, 10);
}

export interface SyncResult {
  itemId: string;
  institutionName: string | null;
  added: number;
  modified: number;
  removed: number;
  ok: boolean;
  error?: string;
}

export function createSyncService(db: Db = getDb(), clientFactory: (creds: PlaidCreds) => PlaidClient = () => realPlaidClient) {
  function aad(userId: string, recordId: string): string {
    return `${userId}:plaid:${recordId}`;
  }

  async function syncItem(userId: string, itemRowId: string): Promise<SyncResult> {
    const item = await db.get<{
      id: string;
      plaid_item_id: string | null;
      access_token_enc: string;
      cursor: string | null;
      environment: PlaidEnvironment;
      institution_name: string | null;
    }>(
      "SELECT id, plaid_item_id, access_token_enc, cursor, environment, institution_name FROM plaid_items WHERE id = ? AND user_id = ?",
      itemRowId,
      userId
    );
    if (!item) throw apiErrors.notFound("Item");

    const credsRow = await db.get<{ id: string; client_id_enc: string; secret_enc: string }>(
      "SELECT id, client_id_enc, secret_enc FROM plaid_credentials WHERE user_id = ? AND environment = ?",
      userId,
      item.environment
    );
    if (!credsRow) throw apiErrors.notFound("Plaid credentials");

    const creds: PlaidCreds = {
      clientId: decrypt(credsRow.client_id_enc, aad(userId, credsRow.id)),
      secret: decrypt(credsRow.secret_enc, aad(userId, credsRow.id)),
      environment: item.environment,
    };
    const client = clientFactory(creds);
    const accessToken = decrypt(item.access_token_enc, aad(userId, item.id));

    const accountRows = await db.all<{ id: string; plaid_account_id: string | null; type: string | null; type_override: number; hidden: number }>(
      "SELECT id, plaid_account_id, type, type_override, hidden FROM accounts WHERE item_id = ?",
      itemRowId
    );
    const plaidToRow = new Map<string, string>();
    const plaidMeta = new Map<string, { type: string | null; typeOverride: number }>();
    for (const a of accountRows) {
      if (a.plaid_account_id && a.hidden === 0) {
        plaidToRow.set(a.plaid_account_id, a.id);
        plaidMeta.set(a.plaid_account_id, { type: a.type, typeOverride: a.type_override });
      }
    }

    const ingest = createIngestService(db);
    const categories = createCategoriesService(db);

    let cursor = item.cursor ?? null;
    let added = 0;
    let modified = 0;
    let removed = 0;
    let hasMore = true;
    let guard = 0;

    while (hasMore && guard < 20) {
      guard++;
      const res = await client.syncTransactions(creds, accessToken, cursor);

      for (const t of res.added) {
        const rowId = plaidToRow.get(t.accountId);
        if (!rowId) continue;
        const cat = await categories.match(userId, t.categoryPath, t.personalFinanceCategory);
        await ingest.upsert(
          {
            plaidId: t.id,
            accountRowId: rowId,
            // Plaid sign: positive = money out (debit) → store negative (expense).
            amountCents: -t.amountCents,
            date: t.date,
            authorizedDate: t.authorizedDate,
            name: t.name,
            merchantName: t.merchantName,
            categoryPath: t.categoryPath,
            personalFinanceCategory: t.personalFinanceCategory,
            pending: t.pending,
          },
          cat?.id ?? null
        );
        added++;
      }
      for (const t of res.modified) {
        const rowId = plaidToRow.get(t.accountId);
        if (!rowId) continue;
        const cat = await categories.match(userId, t.categoryPath, t.personalFinanceCategory);
        await ingest.upsert(
          {
            plaidId: t.id,
            accountRowId: rowId,
            // Plaid sign: positive = money out (debit) → store negative (expense).
            amountCents: -t.amountCents,
            date: t.date,
            authorizedDate: t.authorizedDate,
            name: t.name,
            merchantName: t.merchantName,
            categoryPath: t.categoryPath,
            personalFinanceCategory: t.personalFinanceCategory,
            pending: t.pending,
          },
          cat?.id ?? null
        );
        modified++;
      }
      for (const r of res.removed) {
        await ingest.remove(r.transactionId);
        removed++;
      }

      cursor = res.nextCursor;
      hasMore = res.hasMore;
    }

    // Refresh balances + one balance_history point per account.
    const freshAccounts = await client.getAccounts(creds, accessToken);
    for (const a of freshAccounts) {
      const rowId = plaidToRow.get(a.id);
      if (!rowId) continue;
      const balance = a.currentBalanceCents ?? a.availableBalanceCents ?? 0;
      await db.run(
      "UPDATE accounts SET current_balance_cents = ?, available_balance_cents = ?, currency = ? WHERE id = ?",
      a.currentBalanceCents,
      a.availableBalanceCents,
      a.currency,
      rowId
      );
      await db.run(
        `INSERT INTO balance_history (id, account_id, date, balance_cents) VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
        randomUUID(),
        rowId,
        today(),
        balance
      );
    }

    await db.run(
      "UPDATE plaid_items SET cursor = ?, last_sync_at = ?, status = 'active' WHERE id = ?",
      cursor,
      now(),
      itemRowId
    );

    return { itemId: itemRowId, institutionName: item.institution_name, added, modified, removed, ok: true };
  }

  return {
    /** Sync one item; marks the item 'error' and reports a friendly message on failure. */
    async syncOne(userId: string, itemRowId: string): Promise<SyncResult> {
      try {
        return await syncItem(userId, itemRowId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sync failed.";
        await db.run("UPDATE plaid_items SET status = 'error' WHERE id = ?", itemRowId).catch(() => undefined);
        return { itemId: itemRowId, institutionName: null, added: 0, modified: 0, removed: 0, ok: false, error: message };
      }
    },

    /** Sync every item for the user; never throws. */
    async syncAll(userId: string): Promise<SyncResult[]> {
      const items = await db.all<{ id: string }>("SELECT id FROM plaid_items WHERE user_id = ?", userId);
      const results: SyncResult[] = [];
      for (const item of items) {
        results.push(await this.syncOne(userId, item.id));
      }
      return results;
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
