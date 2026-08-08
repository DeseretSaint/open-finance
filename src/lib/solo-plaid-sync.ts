"use client";

/**
 * Solo Plaid sync (P23) — webview-safe. In solo mode the native PlaidProxy
 * plugin does the REST calls and items live in localStorage; this module
 * pushes the linked accounts + transaction history into the local cap-sqlite
 * DB so the Accounts tab and Activity log populate right after linking.
 *
 * No node:* imports — runs in the Android webview bundle.
 */

import type { Db } from "@/server/db/types";
import { randomUUID } from "@/lib/uuid";
import { createCategoriesService } from "@/server/domain/categories";
import { markLinkedTransfers } from "@/server/domain/transfers";

export interface SoloSyncAccount {
  id: string; // plaid account id
  name: string;
  type: string | null;
  mask: string | null;
}

export interface SoloPlaidTxn {
  id: string;
  accountId: string;
  amountCents: number; // Plaid sign: positive = money out (debit)
  date: string;
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  categoryPath: string | null;
  personalFinanceCategory: string | null;
  pending: boolean;
}

export interface SoloNativeClient {
  syncTransactions(opts: {
    clientId: string;
    secret: string;
    environment: string;
    accessToken: string;
    cursor: string | null;
  }): Promise<{ added: SoloPlaidTxn[]; modified: SoloPlaidTxn[]; removed: Array<string | { transactionId: string }>; nextCursor: string | null }>;
}

export interface SoloSyncInput {
  db: Db;
  userId: string;
  itemId: string; // localStorage item id (plaid item id)
  institutionName: string | null;
  environment: string;
  creds: { clientId: string; secret: string; environment: string };
  accountDetails?: Array<{ id: string; currentBalanceCents: number | null; availableBalanceCents: number | null; currency: string }>;
  accessToken: string;
  accounts: SoloSyncAccount[];
  client: SoloNativeClient;
  cursor: string | null;
}

export interface SoloSyncResult {
  added: number;
  modified: number;
  removed: number;
  /** Oldest transaction date Plaid returned this sync (YYYY-MM-DD) — tells the
   *  user the true history floor (Plaid only returns from link time forward). */
  oldestDate: string | null;
  nextCursor: string | null;
  ok: boolean;
  error?: string;
}

/**
 * Upsert accounts + sync transactions for one solo item. Never throws — the
 * caller decides how to surface failures.
 */
export async function syncSoloItem(input: SoloSyncInput): Promise<SoloSyncResult> {
  const { db, userId, itemId, environment, creds, accessToken, accounts, accountDetails, client } = input;
  try {
    // 1. Upsert accounts (keyed on plaid_account_id).
    for (const a of accounts) {
      const existing = await db.get<{ id: string }>(
        "SELECT id FROM accounts WHERE plaid_account_id = ? AND user_id = ?",
        a.id,
        userId
      );
      if (existing) {
        const existingMeta = await db.get<{ hidden: number; type_override: number; type: string | null }>(
          "SELECT hidden, type_override FROM accounts WHERE id = ?",
          existing.id
        );
        if (existingMeta?.hidden === 1) continue;
        const details = accountDetails?.find((d) => d.id === a.id);
        const override = await db.get<{ name_override: string | null }>("SELECT name_override FROM accounts WHERE id = ?", existing.id);
        // App convention: linked credit/loan balances are stored negative (owed).
        const balanceSign = a.type === "credit" || a.type === "loan" ? -1 : 1;
        // If this sync pass couldn't fetch fresh balances (e.g. the institution
        // returned ITEM_LOGIN_REQUIRED and getAccounts failed), PRESERVE the
        // last-known balance instead of overwriting it with null — otherwise a
        // single failed refresh wipes every balance to $0.
        const stored = await db.get<{ current_balance_cents: number | null; available_balance_cents: number | null; currency: string | null }>(
          "SELECT current_balance_cents, available_balance_cents, currency FROM accounts WHERE id = ?",
          existing.id
        );
        const current = details?.currentBalanceCents == null ? (accountDetails && accountDetails.length > 0 ? null : stored?.current_balance_cents ?? null) : details.currentBalanceCents * balanceSign;
        const available = details?.availableBalanceCents == null ? (accountDetails && accountDetails.length > 0 ? null : stored?.available_balance_cents ?? null) : details.availableBalanceCents * balanceSign;
        const currency = details?.currency ?? stored?.currency ?? "USD";
        await db.run(
          "UPDATE accounts SET name = ?, type = ?, mask = ?, item_id = ?, current_balance_cents = ?, available_balance_cents = ?, currency = ? WHERE id = ? AND hidden = 0",
          override?.name_override ?? a.name,
          existingMeta?.type_override === 1 ? existingMeta.type : a.type,
          a.mask,
          itemId,
          current,
          available,
          currency,
          existing.id
        );
      } else {
        const newSign = a.type === "credit" || a.type === "loan" ? -1 : 1;
        const d = accountDetails?.find((dd) => dd.id === a.id);
        await db.run(
          `INSERT INTO accounts (id, user_id, item_id, plaid_account_id, name, type, mask, current_balance_cents, available_balance_cents, currency, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(),
          userId,
          itemId,
          a.id,
          a.name,
          a.type,
          a.mask,
          d?.currentBalanceCents == null ? null : d.currentBalanceCents * newSign,
          d?.availableBalanceCents == null ? null : d.availableBalanceCents * newSign,
          d?.currency ?? "USD",
          new Date().toISOString()
        );
      }
    }

    // 2. Map plaid account id → row id for ingest.
    const rows = await db.all<{ id: string; plaid_account_id: string | null; hidden: number }>(
      "SELECT id, plaid_account_id, hidden FROM accounts WHERE item_id = ?",
      itemId
    );
    const plaidToRow = new Map<string, string>();
    for (const r of rows) {
      if (r.plaid_account_id && r.hidden === 0) plaidToRow.set(r.plaid_account_id, r.id);
    }

    const categories = createCategoriesService(db);
    // Ensure system categories exist before ingest matching, so transactions
    // get auto-categorized on their first sync even if the user never opened
    // the Categories tab.
    await categories.ensureSystem(userId);

    // 3. Sync transactions via the native proxy (cursor-based).
    const res = await client.syncTransactions({
      clientId: creds.clientId,
      secret: creds.secret,
      environment,
      accessToken,
      cursor: input.cursor ?? null,
    });

    let oldestDate: string | null = null;
    const considerDate = (d: string | null) => {
      if (!d) return;
      if (oldestDate === null || d < oldestDate) oldestDate = d;
    };

    for (const t of res.added) {
      considerDate(t.date);
      const rowId = plaidToRow.get(t.accountId);
      if (!rowId) continue;
      const cat = await categories.match(userId, t.categoryPath, t.personalFinanceCategory);
      // Plaid sign: positive = money out (debit) → store negative (expense).
      await upsertTxn(db, rowId, { ...t, amountCents: -t.amountCents }, cat?.id ?? null);
    }
    for (const t of res.modified) {
      considerDate(t.date);
      const rowId = plaidToRow.get(t.accountId);
      if (!rowId) continue;
      const cat = await categories.match(userId, t.categoryPath, t.personalFinanceCategory);
      await upsertTxn(db, rowId, { ...t, amountCents: -t.amountCents }, cat?.id ?? null);
    }
    for (const removed of res.removed) {
      const plaidId = typeof removed === "string" ? removed : removed.transactionId;
      await db.run("DELETE FROM transactions WHERE plaid_transaction_id = ?", plaidId);
    }

    await markLinkedTransfers(db, userId);

    return {
      added: res.added.length,
      modified: res.modified.length,
      removed: res.removed.length,
      oldestDate,
      nextCursor: res.nextCursor ?? null,
      ok: true,
    };
  } catch (err) {
    return {
      added: 0,
      modified: 0,
      removed: 0,
      oldestDate: null,
      nextCursor: input.cursor ?? null,
      ok: false,
      error: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}

/** Upsert on plaid_transaction_id (pending → posted updates the same row). */
async function upsertTxn(
  db: Db,
  accountRowId: string,
  txn: SoloPlaidTxn & { amountCents: number },
  categoryId: string | null
): Promise<void> {
  const existing = await db.get<{ id: string; pending: number }>(
    "SELECT id, pending FROM transactions WHERE plaid_transaction_id = ?",
    txn.id
  );
  if (existing) {
    await db.run(
      `UPDATE transactions
         SET account_id = ?, amount_cents = ?, date = ?, authorized_date = ?, name = ?,
             merchant_name = ?, category_path = ?, personal_finance_category = ?, pending = ?,
             user_category_id = COALESCE(user_category_id, ?), is_transfer = ?
       WHERE plaid_transaction_id = ?`,
      accountRowId,
      txn.amountCents,
      txn.date,
      txn.authorizedDate,
      txn.name,
      txn.merchantName,
      txn.categoryPath,
      txn.personalFinanceCategory,
      txn.pending ? 1 : 0,
      categoryId,
      0,
      txn.id
    );
    return;
  }
  await db.run(
    `INSERT INTO transactions
       (id, account_id, plaid_transaction_id, amount_cents, date, authorized_date, name,
        merchant_name, category_path, personal_finance_category, pending, user_category_id, is_transfer,
        source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plaid', ?)`,
    randomUUID(),
    accountRowId,
    txn.id,
    txn.amountCents,
    txn.date,
    txn.authorizedDate,
    txn.name,
    txn.merchantName,
    txn.categoryPath,
    txn.personalFinanceCategory,
    txn.pending ? 1 : 0,
    categoryId,
    0,
    new Date().toISOString()
  );
}
