import type { Db } from "@/server/db/types";

/**
 * Cross-source transaction dedupe. The app can receive the same real-world
 * transaction through more than one path: Plaid sync, bank CSV import, and
 * phone import. CSV import already dedupes against every existing row in the
 * account, but Plaid ingest keys only on plaid_transaction_id — so a Plaid
 * delivery of a transaction the user previously imported via CSV would insert
 * a duplicate. These helpers let ingest find and ADOPT the imported row
 * instead. Webview-safe: no node:* imports (phone-solo imports this).
 */

/**
 * Name normalization shared by every dedupe path: trim, collapse internal
 * whitespace runs, lowercase. Bank CSV descriptions and Plaid names for the
 * same merchant often differ only in spacing/case ("STARBUCKS  #123" vs
 * "Starbucks #123"), so whitespace-insensitive matching is required for the
 * cross-source collision check to actually fire.
 */
export function dedupeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Find an existing imported row that represents the same transaction as an
 * incoming Plaid row: same account, date, amount, and normalized name, with
 * no Plaid id yet. Only CSV / phone-import rows are eligible — manual rows
 * are the user's explicit entries and are never touched by ingest.
 */
export async function findImportedDuplicate(
  db: Db,
  accountRowId: string,
  txn: { date: string; amountCents: number; name: string }
): Promise<{ id: string; source: string } | undefined> {
  // The (account, date, amount) candidate set is tiny; compare normalized
  // names in JS so both sides use the exact same dedupeName() function.
  const candidates = await db.all<{ id: string; source: string; name: string }>(
    `SELECT id, source, name FROM transactions
      WHERE account_id = ? AND date = ? AND amount_cents = ?
        AND plaid_transaction_id IS NULL
        AND source IN ('csv', 'phone-import')`,
    accountRowId,
    txn.date,
    txn.amountCents
  );
  const want = dedupeName(txn.name);
  return candidates.find((c) => dedupeName(c.name) === want);
}
