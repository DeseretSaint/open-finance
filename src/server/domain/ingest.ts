import { randomUUID } from "node:crypto";
import { getDb, type Db } from "@/server/db/adapter";

/**
 * Ingest — the correctness contract for Plaid transaction rows.
 * Amount sign convention used by the app: positive = money in (income),
 * negative = money out (expense). Plaid's raw sign is flipped before ingest.
 * Manual rows (source='manual') have NULL
 * plaid_transaction_id and are never touched by ingest.
 */
export interface IngestTxn {
  plaidId: string;
  accountRowId: string;
  amountCents: number;
  date: string;
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  categoryPath: string | null;
  personalFinanceCategory: string | null;
  pending: boolean;
  isTransfer?: boolean;
}

export function createIngestService(db: Db = getDb()) {
  function now(): string {
    return new Date().toISOString();
  }

  return {
    /** Upsert on plaid_transaction_id: pending → posted updates the same row. */
    async upsert(txn: IngestTxn, categoryId: string | null): Promise<void> {
      const existing = await db.get<{ id: string; pending: number }>(
        "SELECT id, pending FROM transactions WHERE plaid_transaction_id = ?",
        txn.plaidId
      );
      if (existing) {
        await db.run(
          `UPDATE transactions
             SET account_id = ?, amount_cents = ?, date = ?, authorized_date = ?, name = ?,
                 merchant_name = ?, category_path = ?, personal_finance_category = ?, pending = ?,
                 user_category_id = COALESCE(user_category_id, ?), is_transfer = ?
           WHERE plaid_transaction_id = ?`,
          txn.accountRowId,
          txn.amountCents,
          txn.date,
          txn.authorizedDate,
          txn.name,
          txn.merchantName,
          txn.categoryPath,
          txn.personalFinanceCategory,
          txn.pending ? 1 : 0,
          categoryId,
          txn.isTransfer ? 1 : 0,
          txn.plaidId
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
        txn.accountRowId,
        txn.plaidId,
        txn.amountCents,
        txn.date,
        txn.authorizedDate,
        txn.name,
        txn.merchantName,
        txn.categoryPath,
        txn.personalFinanceCategory,
        txn.pending ? 1 : 0,
        categoryId,
        txn.isTransfer ? 1 : 0,
        now()
      );
    },

    /** Plaid reported the transaction removed — delete by Plaid id. */
    async remove(plaidId: string): Promise<void> {
      await db.run("DELETE FROM transactions WHERE plaid_transaction_id = ?", plaidId);
    },
  };
}

export type IngestService = ReturnType<typeof createIngestService>;
