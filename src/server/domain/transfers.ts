import type { Db } from "@/server/db/registry";

const PAYMENT_WORDS = /\b(payment|pay card|credit card|autopay|autopayment|transfer|online payment|bill pay|thank you)\b/i;

interface Candidate {
  id: string;
  account_id: string;
  amount_cents: number;
  date: string;
  name: string;
  type: string | null;
}

/**
 * Marks linked-account card payments as internal transfers. It deliberately
 * requires a same-day equal/opposite pair across a cash account and a credit
 * account plus payment/transfer language. Unlinked card payments have no
 * matching pair and remain ordinary expenses.
 */
export async function markLinkedTransfers(db: Db, userId: string, dates?: string[]): Promise<number> {
  const dateClause = dates && dates.length > 0 ? ` AND t.date IN (${dates.map(() => "?").join(",")})` : "";
  const params: unknown[] = [userId, ...(dates ?? [])];
  const rows = await db.all<Candidate>(
    `SELECT t.id, t.account_id, t.amount_cents, t.date, t.name, a.type
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE a.user_id = ? AND a.deleted_at IS NULL AND t.is_transfer = 0
        AND t.pending = 0 AND t.amount_cents != 0${dateClause}`,
    ...params
  );
  const byKey = new Map<string, Candidate[]>();
  for (const row of rows) {
    const key = `${row.date}:${Math.abs(row.amount_cents)}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  let marked = 0;
  for (const group of byKey.values()) {
    for (const out of group) {
      if (out.amount_cents >= 0 || !PAYMENT_WORDS.test(out.name)) continue;
      const match = group.find(
        (candidate) =>
          candidate.id !== out.id &&
          candidate.amount_cents === -out.amount_cents &&
          candidate.account_id !== out.account_id &&
          (candidate.type === "credit" || candidate.type === "loan") &&
          (out.type === "depository" || out.type === "investment")
      );
      if (!match) continue;
      await db.run("UPDATE transactions SET is_transfer = 1, exclude_from_budgets = 1 WHERE id IN (?, ?)", out.id, match.id);
      marked += 2;
    }
  }
  return marked;
}

export const transferPaymentPattern = PAYMENT_WORDS;
