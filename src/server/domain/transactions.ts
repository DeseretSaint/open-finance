import { randomUUID } from "@/lib/uuid";
import { apiErrors } from "@/lib/api-error";
import { getDb, type Db } from "@/server/db/registry";

export interface TransactionRow {
  id: string;
  account_id: string;
  account_name: string;
  plaid_transaction_id: string | null;
  amount_cents: number;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  category_path: string | null;
  personal_finance_category: string | null;
  is_transfer: number;
  pending: number;
  user_category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  user_note: string | null;
  exclude_from_budgets: number;
  source: string;
  created_at: string;
}

export interface TransactionFilters {
  accountId?: string;
  accountIds?: string[] | null; // agent allowlist
  from?: string;
  to?: string;
  categoryId?: string | null; // null = uncategorized only (agent smart categorization)
  review?: boolean; // true = "needs your review": Plaid pulled but never confirmed by a human
  q?: string;
  pendingOnly?: boolean;
  limit: number;
  offset: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function now(): string {
  return new Date().toISOString();
}

export function createTransactionsService(db: Db = getDb()) {
  return {
    async list(userId: string, f: TransactionFilters): Promise<{ rows: TransactionRow[]; total: number }> {
      const where: string[] = ["a.user_id = ?", "a.deleted_at IS NULL"];
      const params: unknown[] = [userId];
      if (f.accountId) {
        where.push("t.account_id = ?");
        params.push(f.accountId);
      }
      if (f.accountIds !== undefined && f.accountIds !== null) {
        if (f.accountIds.length === 0) {
          where.push("0 = 1");
        } else {
          where.push(`t.account_id IN (${f.accountIds.map(() => "?").join(", ")})`);
          params.push(...f.accountIds);
        }
      }
      if (f.from) {
        if (!DATE_RE.test(f.from)) throw apiErrors.badRequest("from must be YYYY-MM-DD");
        where.push("t.date >= ?");
        params.push(f.from);
      }
      if (f.to) {
        if (!DATE_RE.test(f.to)) throw apiErrors.badRequest("to must be YYYY-MM-DD");
        where.push("t.date <= ?");
        params.push(f.to);
      }
      if (f.categoryId === null) {
        // Uncategorized: explicit null filter (used by the agent smart-categorization flow).
        where.push("t.user_category_id IS NULL");
      } else if (f.categoryId) {
        where.push("t.user_category_id = ?");
        params.push(f.categoryId);
      }
      if (f.review) {
        // "Needs your review": pulled by Plaid/agent but never confirmed with a
        // human-set category. Internal transfers (is_transfer) are money moved
        // between the user's own accounts (already excluded from budgets) and
        // pending rows aren't posted yet — neither needs a human category, so
        // both are excluded from the review queue count.
        where.push("t.user_category_id IS NULL AND t.source != 'manual' AND t.is_transfer = 0 AND t.pending = 0");
      }
      if (f.q) {
        where.push("(t.name LIKE ? OR t.merchant_name LIKE ? OR t.category_path LIKE ?)");
        const like = `%${f.q}%`;
        params.push(like, like, like);
      }
      if (f.pendingOnly) {
        where.push("t.pending = 1");
      }
      const whereSql = where.join(" AND ");

      const totalRow = await db.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE ${whereSql}`,
        ...params
      );
      const rows = await db.all<TransactionRow>(
        `SELECT t.*, a.name AS account_name, c.name AS category_name, c.color AS category_color
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.user_category_id
          WHERE ${whereSql}
          ORDER BY t.date DESC, t.created_at DESC
          LIMIT ? OFFSET ?`,
        ...params,
        f.limit,
        f.offset
      );
      return { rows, total: totalRow?.c ?? 0 };
    },

    async get(userId: string, id: string): Promise<TransactionRow> {
      const row = await db.get<TransactionRow>(
        `SELECT t.*, a.name AS account_name, c.name AS category_name, c.color AS category_color
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.user_category_id
          WHERE t.id = ? AND a.user_id = ? AND a.deleted_at IS NULL`,
        id,
        userId
      );
      if (!row) throw apiErrors.notFound("Transaction");
      return row;
    },

    async createManual(
      userId: string,
      input: {
        accountId: string;
        amountCents: number;
        date: string;
        name: string;
        userCategoryId?: string | null;
        userNote?: string | null;
        excludeFromBudgets?: boolean;
      }
    ): Promise<TransactionRow> {
      const account = await db.get<{ id: string }>(
        "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
        input.accountId,
        userId
      );
      if (!account) throw apiErrors.notFound("Account");
      if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
        throw apiErrors.badRequest("Amount must be a non-zero whole number of cents.");
      }
      if (!DATE_RE.test(input.date)) throw apiErrors.badRequest("Date must be YYYY-MM-DD.");
      const name = input.name.trim().slice(0, 200);
      if (!name) throw apiErrors.badRequest("Transaction name cannot be empty.");
      if (input.userCategoryId) {
        const cat = await db.get("SELECT id FROM categories WHERE id = ? AND user_id = ?", input.userCategoryId, userId);
        if (!cat) throw apiErrors.badRequest("That category does not exist.");
      }
      const id = randomUUID();
      await db.run(
        `INSERT INTO transactions
          (id, account_id, plaid_transaction_id, amount_cents, date, authorized_date, name,
            merchant_name, category_path, personal_finance_category, pending, user_category_id,
            user_note, exclude_from_budgets, source, created_at)
         VALUES (?, ?, NULL, ?, ?, NULL, ?, NULL, NULL, NULL, 0, ?, ?, ?, 'manual', ?)`,
        id,
        input.accountId,
        input.amountCents,
        input.date,
        name,
        input.userCategoryId ?? null,
        input.userNote?.trim().slice(0, 500) || null,
        input.excludeFromBudgets ? 1 : 0,
        now()
      );
      return this.get(userId, id);
    },

    /**
     * Plaid-sourced rows: category / note / exclude only.
     * Manual rows: any editable field.
     */
    async update(
      userId: string,
      id: string,
      input: {
        userCategoryId?: string | null;
        userNote?: string | null;
        excludeFromBudgets?: boolean;
        name?: string;
        amountCents?: number;
        date?: string;
        accountId?: string;
      }
    ): Promise<TransactionRow> {
      const row = await this.get(userId, id);
      const isManual = row.source === "manual";

      if (input.userCategoryId !== undefined) {
        if (input.userCategoryId) {
          const cat = await db.get("SELECT id FROM categories WHERE id = ? AND user_id = ?", input.userCategoryId, userId);
          if (!cat) throw apiErrors.badRequest("That category does not exist.");
        }
        await db.run("UPDATE transactions SET user_category_id = ? WHERE id = ?", input.userCategoryId, id);
      }
      if (input.userNote !== undefined) {
        await db.run("UPDATE transactions SET user_note = ? WHERE id = ?", input.userNote?.trim().slice(0, 500) || null, id);
      }
      if (input.excludeFromBudgets !== undefined) {
        await db.run("UPDATE transactions SET exclude_from_budgets = ? WHERE id = ?", input.excludeFromBudgets ? 1 : 0, id);
      }
      if (isManual) {
        if (input.name !== undefined) {
          const name = input.name.trim().slice(0, 200);
          if (!name) throw apiErrors.badRequest("Transaction name cannot be empty.");
          await db.run("UPDATE transactions SET name = ? WHERE id = ?", name, id);
        }
        if (input.amountCents !== undefined) {
          if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
            throw apiErrors.badRequest("Amount must be a non-zero whole number of cents.");
          }
          await db.run("UPDATE transactions SET amount_cents = ? WHERE id = ?", input.amountCents, id);
        }
        if (input.date !== undefined) {
          if (!DATE_RE.test(input.date)) throw apiErrors.badRequest("Date must be YYYY-MM-DD.");
          await db.run("UPDATE transactions SET date = ? WHERE id = ?", input.date, id);
        }
        if (input.accountId !== undefined) {
          const account = await db.get("SELECT id FROM accounts WHERE id = ? AND user_id = ?", input.accountId, userId);
          if (!account) throw apiErrors.notFound("Account");
          await db.run("UPDATE transactions SET account_id = ? WHERE id = ?", input.accountId, id);
        }
      }
      return this.get(userId, id);
    },

    async removeManual(userId: string, id: string): Promise<void> {
      const row = await this.get(userId, id);
      if (row.source !== "manual") throw apiErrors.forbidden("Plaid-sourced transactions cannot be deleted.");
      await db.run("DELETE FROM transactions WHERE id = ?", id);
    },

    /** Batch-confirm categories for the "review" queue (one-tap review). Only applies to the
     *  user's own transactions; validates each id and the target category (or clears it). */
    async batchCategorize(userId: string, ids: string[], userCategoryId: string | null): Promise<number> {
      const cleanIds = ids.map((i) => i.trim()).filter(Boolean).filter((v, idx, arr) => arr.indexOf(v) === idx);
      if (cleanIds.length === 0) throw apiErrors.badRequest("No transaction ids provided.");
      if (cleanIds.length > 200) throw apiErrors.badRequest("Too many transactions at once (max 200).");
      if (userCategoryId) {
        const cat = await db.get("SELECT id FROM categories WHERE id = ? AND user_id = ?", userCategoryId, userId);
        if (!cat) throw apiErrors.badRequest("That category does not exist.");
      }
      const placeholders = cleanIds.map(() => "?").join(", ");
      // Only touch transactions that still need review (Plaid-sourced, uncategorized).
      // Ids are user-scoped by the caller (the review queue already filters to this user).
      const res = await db.run(
        `UPDATE transactions SET user_category_id = ? WHERE id IN (${placeholders}) AND user_category_id IS NULL AND source != 'manual'`,
        userCategoryId,
        ...cleanIds,
      );
      return res.changes ?? 0;
    },
  };
}

export type TransactionsService = ReturnType<typeof createTransactionsService>;
