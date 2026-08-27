import type { Db } from "@/server/db/registry";

const PAYMENT_WORDS = /\b(payment|pay card|credit card|autopay|autopayment|transfer|online payment|bill pay|thank you|card pmt|cc payment)\b/i;
const TRANSFER_CATEGORY = /(^|[|:_ -])(transfer|transfer_in|transfer_out|payment)([|:_ -]|$)/i;
const MAX_POSTING_GAP_DAYS = 7;

interface Candidate {
  id: string;
  account_id: string;
  amount_cents: number;
  date: string;
  name: string;
  category_path: string | null;
  personal_finance_category: string | null;
  type: string | null;
}

function dayDistance(a: string, b: string): number {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.POSITIVE_INFINITY;
  return Math.abs(left - right) / 86_400_000;
}

function hasTransferSignal(row: Pick<Candidate, "name" | "category_path" | "personal_finance_category">): boolean {
  return PAYMENT_WORDS.test(row.name) || TRANSFER_CATEGORY.test(row.category_path ?? "") || TRANSFER_CATEGORY.test(row.personal_finance_category ?? "");
}

/**
 * Marks linked-account card payments as internal transfers. The debit and
 * credit can post several days apart because banks settle them asynchronously.
 * Unpaired card payments and ordinary cash withdrawals remain expenses.
 */
export async function markLinkedTransfers(db: Db, userId: string, dates?: string[]): Promise<number> {
  const dateClause = dates && dates.length > 0 ? ` AND t.date IN (${dates.map(() => "?").join(",")})` : "";
  const params: unknown[] = [userId, ...(dates ?? [])];
  const rows = await db.all<Candidate>(
    `SELECT t.id, t.account_id, t.amount_cents, t.date, t.name,
            t.category_path, t.personal_finance_category, a.type
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE a.user_id = ? AND a.deleted_at IS NULL AND t.is_transfer = 0
        AND t.pending = 0 AND t.amount_cents != 0${dateClause}`,
    ...params
  );
  const used = new Set<string>();
  let marked = 0;

  for (const out of rows) {
    if (used.has(out.id) || out.amount_cents >= 0 || !(out.type === "depository" || out.type === "investment")) continue;
    const match = rows.find(
      (candidate) =>
        !used.has(candidate.id) &&
        candidate.id !== out.id &&
        candidate.amount_cents === -out.amount_cents &&
        candidate.account_id !== out.account_id &&
        (candidate.type === "credit" || candidate.type === "loan") &&
        dayDistance(out.date, candidate.date) <= MAX_POSTING_GAP_DAYS &&
        (hasTransferSignal(out) || hasTransferSignal(candidate))
    );
    if (!match) continue;
    await db.run("UPDATE transactions SET is_transfer = 1, exclude_from_budgets = 1 WHERE id IN (?, ?)", out.id, match.id);
    used.add(out.id);
    used.add(match.id);
    marked += 2;
  }
  return marked;
}


