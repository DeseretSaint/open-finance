import { randomUUID } from "@/lib/uuid";
import { apiErrors } from "@/lib/api-error";
import { getDb, type Db } from "@/server/db/registry";

export interface AccountRow {
  id: string;
  user_id: string;
  item_id: string | null;
  plaid_account_id: string | null;
  name: string;
  official_name: string | null;
  type: string | null;
  subtype: string | null;
  mask: string | null;
  current_balance_cents: number | null;
  available_balance_cents: number | null;
  currency: string;
  institution_name: string | null;
  include_in_net_worth: number;
  created_at: string;
}

function now(): string {
  return new Date().toISOString();
}

const ACCOUNT_TYPES = ["depository", "credit", "investment", "loan", "other"] as const;

export function createAccountsService(db: Db = getDb()) {
  return {
    async list(userId: string): Promise<AccountRow[]> {
      return db.all<AccountRow>(
        `SELECT a.*, i.institution_name
           FROM accounts a
           LEFT JOIN plaid_items i ON i.id = a.item_id
          WHERE a.user_id = ?
          ORDER BY a.type, a.name COLLATE NOCASE`,
        userId
      );
    },

    /**
     * Agent-facing list: scoped by token scopes (read:investments only sees
     * investment accounts unless read:banking is also held) AND account allowlist.
     */
    async listForAgent(userId: string, scopes: string[], accountIds: string[] | null): Promise<AccountRow[]> {
      const conditions: string[] = ["a.user_id = ?"];
      const params: unknown[] = [userId];
      const seeBanking = scopes.includes("read:banking");
      const seeInvestments = scopes.includes("read:investments");
      if (!seeBanking && seeInvestments) {
        conditions.push("a.type = 'investment'");
      } else if (seeBanking && !seeInvestments) {
        conditions.push("(a.type IS NULL OR a.type != 'investment')");
      } else if (!seeBanking && !seeInvestments) {
        conditions.push("0 = 1"); // no account scopes at all
      }
      if (accountIds !== null) {
        if (accountIds.length === 0) {
          conditions.push("0 = 1");
        } else {
          conditions.push(`a.id IN (${accountIds.map(() => "?").join(", ")})`);
          params.push(...accountIds);
        }
      }
      return db.all<AccountRow>(
        `SELECT a.*, i.institution_name
           FROM accounts a
           LEFT JOIN plaid_items i ON i.id = a.item_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY a.type, a.name COLLATE NOCASE`,
        ...params
      );
    },

    async get(userId: string, id: string): Promise<AccountRow> {
      const row = await db.get<AccountRow>(
        `SELECT a.*, i.institution_name
           FROM accounts a
           LEFT JOIN plaid_items i ON i.id = a.item_id
          WHERE a.id = ? AND a.user_id = ?`,
        id,
        userId
      );
      if (!row) throw apiErrors.notFound("Account");
      return row;
    },

    /** Manual account — no Plaid item, fully user-owned. */
    async createManual(
      userId: string,
      input: {
        name: string;
        type?: string;
        subtype?: string | null;
        mask?: string | null;
        currentBalanceCents?: number | null;
        availableBalanceCents?: number | null;
        currency?: string;
      }
    ): Promise<AccountRow> {
      const name = input.name.trim().slice(0, 100);
      if (!name) throw apiErrors.badRequest("Account name cannot be empty.");
      const type = input.type ?? "other";
      if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) {
        throw apiErrors.badRequest(`Account type must be one of: ${ACCOUNT_TYPES.join(", ")}.`);
      }
      if (input.currentBalanceCents !== undefined && input.currentBalanceCents !== null) {
        if (!Number.isInteger(input.currentBalanceCents)) {
          throw apiErrors.badRequest("Current balance must be a whole number of cents.");
        }
      }
      const id = randomUUID();
      await db.run(
        `INSERT INTO accounts
           (id, user_id, item_id, plaid_account_id, name, official_name, type, subtype, mask,
            current_balance_cents, available_balance_cents, currency, created_at)
         VALUES (?, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        userId,
        name,
        type,
        input.subtype?.trim().slice(0, 50) || null,
        input.mask?.trim().slice(0, 4) || null,
        input.currentBalanceCents ?? null,
        input.availableBalanceCents ?? null,
        input.currency?.trim().toUpperCase().slice(0, 3) || "USD",
        now()
      );
      return this.get(userId, id);
    },

    async rename(userId: string, id: string, name: string): Promise<AccountRow> {
      await this.get(userId, id);
      const clean = name.trim().slice(0, 100);
      if (!clean) throw apiErrors.badRequest("Account name cannot be empty.");
      await db.run("UPDATE accounts SET name = ? WHERE id = ?", clean, id);
      return this.get(userId, id);
    },

    /** Only manual accounts (no Plaid item) can be deleted. */
    async remove(userId: string, id: string): Promise<void> {
      const row = await this.get(userId, id);
      if (row.item_id) throw apiErrors.forbidden("Remove the institution to delete its accounts.");
      await db.transaction(async () => {
        await db.run("DELETE FROM transactions WHERE account_id = ?", id);
        await db.run("DELETE FROM balance_history WHERE account_id = ?", id);
        await db.run("DELETE FROM accounts WHERE id = ?", id);
      });
    },

    /** Include/exclude an account from the day-to-day net worth (P24). */
    async setNetWorthInclusion(userId: string, id: string, include: boolean): Promise<AccountRow> {
      await this.get(userId, id);
      await db.run("UPDATE accounts SET include_in_net_worth = ? WHERE id = ?", include ? 1 : 0, id);
      return this.get(userId, id);
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
