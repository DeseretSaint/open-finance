import { randomUUID } from "@/lib/uuid";
import { apiErrors } from "@/lib/api-error";
import { assertValidCents } from "@/server/domain/money";
import { getDb, type Db } from "@/server/db/registry";
import { addDaysISO, addMonthsISO, monthsBetween, todayISO } from "@/server/domain/dates";

export type BillFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "one-time";

export interface BillRow {
  id: string;
  user_id: string;
  name: string;
  amount_cents: number;
  frequency: BillFrequency;
  due_day: number | null;
  next_due_date: string | null;
  last_paid_amount_cents: number | null;
  category_id: string | null;
  account_id: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillWithNames extends BillRow {
  category_name: string | null;
  account_name: string | null;
}

export interface DebtRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  principal_cents: number;
  apr_bps: number;
  min_payment_cents: number;
  term_months: number | null;
  start_date: string;
  next_due_date: string | null;
  account_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Amortization {
  monthlyPaymentCents: number;
  monthsToPayoff: number | null; // null = never pays off at this payment
  totalInterestCents: number;
  payoffDate: string | null;
}

export interface DebtWithAmortization extends DebtRow {
  amortization: Amortization;
}

export interface GoalRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  category: string;
  target_cents: number;
  target_date: string | null;
  current_cents: number;
  monthly_contribution_cents: number | null;
  contribution_mode: string;
  contribution_interval: string | null;
  contribution_days: string | null;
  account_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalWithProgress extends GoalRow {
  pct: number; // 0..1+ (over target > 1)
  monthsLeft: number | null; // to target date
  requiredMonthlyCents: number | null; // to hit target by date
  projectedCompletionDate: string | null; // at current contribution rate
}

// ── Manual payday schedule (012) ──────────────────────────────────────────
export type PaydayMode = "auto" | "interval" | "days_of_month";
export type PaydayInterval = "weekly" | "biweekly" | "monthly";

export interface PaydaySettings {
  mode: PaydayMode;
  interval: PaydayInterval | null;
  days: number[]; // day-of-month, e.g. [1, 15]
}

export const PAYDAY_MODES: PaydayMode[] = ["auto", "interval", "days_of_month"];
export const PAYDAY_INTERVALS: PaydayInterval[] = ["weekly", "biweekly", "monthly"];

export const CONTRIBUTION_MODES = ["none", "interval", "days_of_month", "agent"] as const;
export type ContributionMode = (typeof CONTRIBUTION_MODES)[number];

function validateContributionMode(mode: string | undefined): ContributionMode {
  // Legacy savings goals don't send a mode → "none" (no plan). Expense goals
  // always send an explicit mode from the UI.
  // SAFETY: cast only widens string for the includes() gate on the next line;
  // any value outside CONTRIBUTION_MODES throws badRequest below.
  const m = (mode ?? "none") as ContributionMode;
  if (!CONTRIBUTION_MODES.includes(m)) throw apiErrors.badRequest("Contribution mode must be none, interval, days_of_month or agent.");
  return m;
}

function normalizeContributionDays(days: number[] | undefined): number[] {
  if (!days || days.length === 0) return [];
  const cleaned = Array.from(new Set(days.map((d) => Math.round(d)))).filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b);
  if (cleaned.length === 0) return [];
  return cleaned;
}

/** Parse a stored JSON day list (e.g. "[1,15]") back into numbers. */
export function parseDayList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((d) => Number.isInteger(d) && d >= 1 && d <= 31).sort((a: number, b: number) => a - b) : [];
  } catch {
    return [];
  }
}

function now(): string {
  return new Date().toISOString();
}

/** Next calendar date with `day` on/after `refDate`, clamped to month end. */
export function nextOccurrenceOfDay(day: number, refDate: string): string {
  const clamped = Math.min(Math.max(1, Math.round(day)), 31);
  const ref = new Date(`${refDate}T00:00:00Z`);
  const lastDayOfRefMonth = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
  const candidate = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), Math.min(clamped, lastDayOfRefMonth)));
  if (candidate < ref) {
    const next = addMonthsISO(candidate.toISOString().slice(0, 10), 1);
    return nextOccurrenceOfDay(clamped, next);
  }
  return candidate.toISOString().slice(0, 10);
}

/** Advance a due date by one frequency period (weekly +7d, monthly +1mo clamped…). */
export function advanceDueDate(frequency: BillFrequency, from: string): string | null {
  switch (frequency) {
    case "weekly":
      return addDaysISO(from, 7);
    case "biweekly":
      return addDaysISO(from, 14);
    case "monthly":
      return addMonthsISO(from, 1);
    case "quarterly":
      return addMonthsISO(from, 3);
    case "yearly":
      return addMonthsISO(from, 12);
    case "one-time":
      return null; // one-time bills end after being paid
  }
}

/** First due date for a bill: explicit nextDueDate wins, else due_day, else frequency default. */
export function initialDueDate(
  frequency: BillFrequency,
  dueDay: number | null,
  nextDueDate: string | null,
  refDate: string = todayISO()
): string | null {
  if (nextDueDate) return nextDueDate;
  if (frequency === "one-time") return nextDueDate ?? null;
  if (dueDay !== null && ["monthly", "quarterly", "yearly"].includes(frequency)) {
    return nextOccurrenceOfDay(dueDay, refDate);
  }
  switch (frequency) {
    case "weekly":
      return addDaysISO(refDate, 7);
    case "biweekly":
      return addDaysISO(refDate, 14);
    case "monthly":
      return addMonthsISO(refDate, 1);
    case "quarterly":
      return addMonthsISO(refDate, 3);
    case "yearly":
      return addMonthsISO(refDate, 12);
    default:
      return null;
  }
}

/**
 * Amortization: monthly payment from term (P·r/(1-(1+r)^-n)), then simulate the
 * payoff to derive months-to-payoff + total interest. When term is absent the
 * minimum payment drives the schedule (0 payment ⇒ never pays off).
 */
export function amortize(
  principalCents: number,
  aprBps: number,
  termMonths: number | null,
  minPaymentCents: number
): Amortization {
  const r = aprBps / 10000 / 12;
  let payment = 0;
  if (termMonths && termMonths > 0) {
    payment = r === 0 ? Math.ceil(principalCents / termMonths) : Math.ceil((principalCents * r) / (1 - Math.pow(1 + r, -termMonths)));
  }
  payment = Math.max(payment, minPaymentCents);

  if (payment <= 0) {
    return { monthlyPaymentCents: 0, monthsToPayoff: null, totalInterestCents: 0, payoffDate: null };
  }

  let balance = principalCents;
  let months = 0;
  let totalInterest = 0;
  const MAX_MONTHS = 1200; // 100-year safety valve
  while (balance > 0 && months < MAX_MONTHS) {
    const interest = Math.round(balance * r);
    totalInterest += interest;
    balance = balance + interest - payment;
    months++;
    if (interest >= payment && balance >= principalCents) {
      // payment never exceeds interest — can't pay down
      return { monthlyPaymentCents: payment, monthsToPayoff: null, totalInterestCents: totalInterest, payoffDate: null };
    }
  }
  if (balance > 0) {
    return { monthlyPaymentCents: payment, monthsToPayoff: null, totalInterestCents: totalInterest, payoffDate: null };
  }
  return {
    monthlyPaymentCents: payment,
    monthsToPayoff: months,
    totalInterestCents: totalInterest,
    payoffDate: addMonthsISO(todayISO(), months),
  };
}

export function createPlanningService(db: Db = getDb()) {
  const BILL_SELECT = `SELECT b.*, c.name AS category_name, a.name AS account_name
     FROM bills b
     LEFT JOIN categories c ON c.id = b.category_id
     LEFT JOIN accounts a ON a.id = b.account_id`;

  /** Raw row from SQLite: active comes back as 0/1. */
  type BillDbRow = Omit<BillWithNames, "active"> & { active: number | boolean };

  function toBillRow(row: BillDbRow): BillWithNames {
    return { ...row, active: row.active === true || row.active === 1 };
  }

  return {
    // ── BILLS ──────────────────────────────────────────────────────────────
    async listBills(userId: string): Promise<BillWithNames[]> {
      const rows = await db.all<BillDbRow>(
        `${BILL_SELECT} WHERE b.user_id = ? ORDER BY b.active DESC, b.next_due_date ASC`,
        userId
      );
      return rows.map(toBillRow);
    },

    async getBill(userId: string, id: string): Promise<BillWithNames> {
      const row = await db.get<BillDbRow>(
        `${BILL_SELECT} WHERE b.id = ? AND b.user_id = ?`,
        id,
        userId
      );
      if (!row) throw apiErrors.notFound("Bill");
      return toBillRow(row);
    },

    async createBill(
      userId: string,
      input: {
        name: string;
        amountCents: number;
        frequency?: BillFrequency;
        dueDay?: number | null;
        nextDueDate?: string | null;
        lastPaidAmountCents?: number | null;
        categoryId?: string | null;
        accountId?: string | null;
        active?: boolean;
        notes?: string | null;
        transactionId?: string | null; // create-from-transaction: prefill name/amount/category
      }
    ): Promise<BillWithNames> {
      let name = input.name.trim().slice(0, 100);
      let amountCents = input.amountCents;
      let categoryId = input.categoryId ?? null;

      if (input.transactionId) {
        const txn = await db.get<{ name: string; amount_cents: number; user_category_id: string | null }>(
          `SELECT t.name, t.amount_cents, t.user_category_id
             FROM transactions t JOIN accounts a ON a.id = t.account_id
            WHERE t.id = ? AND a.user_id = ? AND a.deleted_at IS NULL`,
          input.transactionId,
          userId
        );
        if (!txn) throw apiErrors.notFound("Transaction");
        if (!name) name = txn.name.slice(0, 100);
        if (!amountCents || amountCents === 0) amountCents = Math.abs(txn.amount_cents);
        if (!categoryId) categoryId = txn.user_category_id;
      }

      if (!name) throw apiErrors.badRequest("Bill name cannot be empty.");
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw apiErrors.badRequest("Bill amount must be a positive whole number of cents.");
      }
      assertValidCents(amountCents, "amountCents");
      const frequency = input.frequency ?? "monthly";
      if (!["weekly", "biweekly", "monthly", "quarterly", "yearly", "one-time"].includes(frequency)) {
        throw apiErrors.badRequest("Frequency must be weekly, biweekly, monthly, quarterly, yearly, or one-time.");
      }
      if (input.dueDay !== null && input.dueDay !== undefined && (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31)) {
        throw apiErrors.badRequest("Due day must be between 1 and 31.");
      }
      if (input.nextDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.nextDueDate)) {
        throw apiErrors.badRequest("Next due date must be YYYY-MM-DD.");
      }
      if (frequency === "one-time" && !input.nextDueDate) {
        throw apiErrors.badRequest("One-time bills need a due date.");
      }
      if (categoryId) {
        const cat = await db.get("SELECT id FROM categories WHERE id = ? AND user_id = ?", categoryId, userId);
        if (!cat) throw apiErrors.badRequest("That category does not exist.");
      }
      if (input.accountId) {
        const acc = await db.get("SELECT id FROM accounts WHERE id = ? AND user_id = ?", input.accountId, userId);
        if (!acc) throw apiErrors.badRequest("That account does not exist.");
      }

      const id = randomUUID();
      const ts = now();
      const nextDueDate = initialDueDate(frequency, input.dueDay ?? null, input.nextDueDate ?? null);
      await db.run(
        `INSERT INTO bills (id, user_id, name, amount_cents, frequency, due_day, next_due_date,
                            last_paid_amount_cents, category_id, account_id, active, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        userId,
        name,
        amountCents,
        frequency,
        input.dueDay ?? null,
        nextDueDate,
        input.lastPaidAmountCents ?? null,
        categoryId,
        input.accountId ?? null,
        input.active === false ? 0 : 1,
        input.notes?.trim().slice(0, 500) || null,
        ts,
        ts
      );
      return this.getBill(userId, id);
    },

    async updateBill(
      userId: string,
      id: string,
      input: Partial<{
        name: string;
        amountCents: number;
        frequency: BillFrequency;
        dueDay: number | null;
        nextDueDate: string | null;
        categoryId: string | null;
        accountId: string | null;
        active: boolean;
        notes: string | null;
      }>
    ): Promise<BillWithNames> {
      const row = await this.getBill(userId, id);
      const name = input.name !== undefined ? input.name.trim().slice(0, 100) : row.name;
      if (!name) throw apiErrors.badRequest("Bill name cannot be empty.");
      const amountCents = input.amountCents !== undefined ? input.amountCents : row.amount_cents;
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw apiErrors.badRequest("Bill amount must be positive cents.");
      }
      assertValidCents(amountCents, "amountCents");
      const frequency = input.frequency ?? row.frequency;
      const dueDay = input.dueDay !== undefined ? input.dueDay : row.due_day;
      if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
        throw apiErrors.badRequest("Due day must be between 1 and 31.");
      }
      const nextDueDate = input.nextDueDate !== undefined ? input.nextDueDate : row.next_due_date;
      if (nextDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextDueDate)) {
        throw apiErrors.badRequest("Next due date must be YYYY-MM-DD.");
      }
      if (frequency === "one-time" && !nextDueDate) {
        throw apiErrors.badRequest("One-time bills need a due date.");
      }

      await db.run(
        `UPDATE bills SET name = ?, amount_cents = ?, frequency = ?, due_day = ?, next_due_date = ?,
                          category_id = ?, account_id = ?, active = ?, notes = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`,
        name,
        amountCents,
        frequency,
        dueDay,
        nextDueDate,
        input.categoryId !== undefined ? input.categoryId : row.category_id,
        input.accountId !== undefined ? input.accountId : row.account_id,
        input.active !== undefined ? (input.active ? 1 : 0) : row.active ? 1 : 0,
        input.notes != null ? input.notes.trim().slice(0, 500) || null : row.notes,
        now(),
        id,
        userId
      );
      return this.getBill(userId, id);
    },

    async removeBill(userId: string, id: string): Promise<void> {
      await db.run("DELETE FROM bills WHERE id = ? AND user_id = ?", id, userId);
    },

    /**
     * Mark a bill paid: remembers the amount actually paid (last_paid_amount_cents,
     * so variable bills autofill their next projection) and advances next_due_date
     * by one frequency period. One-time bills deactivate after being paid.
     */
    async payBill(userId: string, id: string, amountCents?: number): Promise<BillWithNames> {
      const row = await this.getBill(userId, id);
      if (!row.active) throw apiErrors.badRequest("Inactive bills cannot be marked paid.");
      const paid = amountCents !== undefined ? amountCents : row.amount_cents;
      if (!Number.isInteger(paid) || paid <= 0) throw apiErrors.badRequest("Paid amount must be positive cents.");
      assertValidCents(paid, "amountCents");

      const nextDue = advanceDueDate(row.frequency, row.next_due_date ?? todayISO());
      await db.run(
        `UPDATE bills SET last_paid_amount_cents = ?, next_due_date = ?, active = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`,
        paid,
        nextDue,
        row.frequency === "one-time" ? 0 : 1,
        now(),
        id,
        userId
      );
      return this.getBill(userId, id);
    },

    // ── DEBTS ──────────────────────────────────────────────────────────────
    async listDebts(userId: string): Promise<DebtWithAmortization[]> {
      const rows = await db.all<DebtRow>("SELECT * FROM debts WHERE user_id = ? ORDER BY principal_cents DESC", userId);
      return rows.map((d) => ({ ...d, amortization: amortize(d.principal_cents, d.apr_bps, d.term_months, d.min_payment_cents) }));
    },

    async getDebt(userId: string, id: string): Promise<DebtWithAmortization> {
      const row = await db.get<DebtRow>("SELECT * FROM debts WHERE id = ? AND user_id = ?", id, userId);
      if (!row) throw apiErrors.notFound("Debt");
      return { ...row, amortization: amortize(row.principal_cents, row.apr_bps, row.term_months, row.min_payment_cents) };
    },

    async createDebt(
      userId: string,
      input: {
        name: string;
        type?: string;
        principalCents: number;
        aprBps?: number;
        minPaymentCents?: number;
        termMonths?: number | null;
        startDate?: string;
        nextDueDate?: string | null;
        accountId?: string | null;
        notes?: string | null;
      }
    ): Promise<DebtWithAmortization> {
      const name = input.name.trim().slice(0, 100);
      if (!name) throw apiErrors.badRequest("Debt name cannot be empty.");
      if (!Number.isInteger(input.principalCents) || input.principalCents <= 0) {
        throw apiErrors.badRequest("Principal must be a positive whole number of cents.");
      }
      assertValidCents(input.principalCents, "principalCents");
      const aprBps = input.aprBps ?? 0;
      if (!Number.isInteger(aprBps) || aprBps < 0) throw apiErrors.badRequest("APR must be a non-negative integer (basis points).");
      const minPaymentCents = input.minPaymentCents ?? 0;
      if (!Number.isInteger(minPaymentCents) || minPaymentCents < 0) throw apiErrors.badRequest("Minimum payment must be non-negative cents.");
      assertValidCents(minPaymentCents, "minPaymentCents");
      if (input.termMonths !== null && input.termMonths !== undefined && (!Number.isInteger(input.termMonths) || input.termMonths < 1)) {
        throw apiErrors.badRequest("Term must be a positive number of months.");
      }
      if (input.accountId) {
        const acc = await db.get("SELECT id FROM accounts WHERE id = ? AND user_id = ?", input.accountId, userId);
        if (!acc) throw apiErrors.badRequest("That account does not exist.");
      }

      const id = randomUUID();
      const ts = now();
      await db.run(
        `INSERT INTO debts (id, user_id, name, type, principal_cents, apr_bps, min_payment_cents,
                            term_months, start_date, next_due_date, account_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        userId,
        name,
        input.type?.trim().slice(0, 50) || "other",
        input.principalCents,
        aprBps,
        minPaymentCents,
        input.termMonths ?? null,
        input.startDate ?? todayISO(),
        input.nextDueDate ?? null,
        input.accountId ?? null,
        input.notes?.trim().slice(0, 500) || null,
        ts,
        ts
      );
      return this.getDebt(userId, id);
    },

    async updateDebt(
      userId: string,
      id: string,
      input: Partial<{
        name: string;
        type: string;
        principalCents: number;
        aprBps: number;
        minPaymentCents: number;
        termMonths: number | null;
        startDate: string;
        nextDueDate: string | null;
        accountId: string | null;
        notes: string | null;
      }>
    ): Promise<DebtWithAmortization> {
      const row = await this.getDebt(userId, id);
      const name = input.name !== undefined ? input.name.trim().slice(0, 100) : row.name;
      if (!name) throw apiErrors.badRequest("Debt name cannot be empty.");
      const principal = input.principalCents !== undefined ? input.principalCents : row.principal_cents;
      if (!Number.isInteger(principal) || principal <= 0) throw apiErrors.badRequest("Principal must be positive cents.");
      assertValidCents(principal, "principalCents");
      const aprBps = input.aprBps !== undefined ? input.aprBps : row.apr_bps;
      if (!Number.isInteger(aprBps) || aprBps < 0) throw apiErrors.badRequest("APR must be non-negative (basis points).");
      const minPayment = input.minPaymentCents !== undefined ? input.minPaymentCents : row.min_payment_cents;
      if (!Number.isInteger(minPayment) || minPayment < 0) throw apiErrors.badRequest("Minimum payment must be non-negative cents.");
      assertValidCents(minPayment, "minPaymentCents");
      const term = input.termMonths !== undefined ? input.termMonths : row.term_months;
      if (term !== null && (!Number.isInteger(term) || term < 1)) throw apiErrors.badRequest("Term must be a positive number of months.");

      await db.run(
        `UPDATE debts SET name = ?, type = ?, principal_cents = ?, apr_bps = ?, min_payment_cents = ?,
                          term_months = ?, start_date = ?, next_due_date = ?, account_id = ?, notes = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`,
        name,
        input.type !== undefined ? input.type.trim().slice(0, 50) || "other" : row.type,
        principal,
        aprBps,
        minPayment,
        term,
        input.startDate ?? row.start_date,
        input.nextDueDate !== undefined ? input.nextDueDate : row.next_due_date,
        input.accountId !== undefined ? input.accountId : row.account_id,
        input.notes != null ? input.notes.trim().slice(0, 500) || null : row.notes,
        now(),
        id,
        userId
      );
      return this.getDebt(userId, id);
    },

    async removeDebt(userId: string, id: string): Promise<void> {
      await db.run("DELETE FROM debts WHERE id = ? AND user_id = ?", id, userId);
    },

    // ── GOALS ──────────────────────────────────────────────────────────────
    async listGoals(userId: string): Promise<GoalWithProgress[]> {
      const rows = await db.all<GoalRow>("SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC", userId);
      return rows.map((g) => this.withProgress(g));
    },

    async getGoal(userId: string, id: string): Promise<GoalWithProgress> {
      const row = await db.get<GoalRow>("SELECT * FROM goals WHERE id = ? AND user_id = ?", id, userId);
      if (!row) throw apiErrors.notFound("Goal");
      return this.withProgress(row);
    },

    withProgress(g: GoalRow): GoalWithProgress {
      const pct = g.target_cents > 0 ? g.current_cents / g.target_cents : g.current_cents > 0 ? 1 : 0;
      const monthsLeft = g.target_date ? Math.max(0, monthsBetween(todayISO(), g.target_date)) : null;
      let requiredMonthlyCents: number | null = null;
      if (g.target_date && monthsLeft !== null && g.current_cents < g.target_cents && monthsLeft > 0) {
        requiredMonthlyCents = Math.ceil((g.target_cents - g.current_cents) / monthsLeft);
      }
      let projectedCompletionDate: string | null = null;
      if (g.monthly_contribution_cents && g.monthly_contribution_cents > 0 && g.current_cents < g.target_cents) {
        const months = Math.ceil((g.target_cents - g.current_cents) / g.monthly_contribution_cents);
        projectedCompletionDate = addMonthsISO(todayISO(), months);
      }
      return { ...g, pct, monthsLeft, requiredMonthlyCents, projectedCompletionDate };
    },

    async createGoal(
      userId: string,
      input: {
        name: string;
        type?: string;
        category?: string;
        targetCents: number;
        targetDate?: string | null;
        currentCents?: number;
        monthlyContributionCents?: number | null;
        contributionMode?: string;
        contributionInterval?: string | null;
        contributionDays?: number[];
        accountId?: string | null;
        notes?: string | null;
      }
    ): Promise<GoalWithProgress> {
      const name = input.name.trim().slice(0, 100);
      if (!name) throw apiErrors.badRequest("Goal name cannot be empty.");
      if (!Number.isInteger(input.targetCents) || input.targetCents <= 0) {
        throw apiErrors.badRequest("Target must be a positive whole number of cents.");
      }
      assertValidCents(input.targetCents, "targetCents");
      const current = input.currentCents ?? 0;
      if (!Number.isInteger(current) || current < 0) throw apiErrors.badRequest("Current amount must be non-negative cents.");
      assertValidCents(current, "currentCents");
      if (input.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) {
        throw apiErrors.badRequest("Target date must be YYYY-MM-DD.");
      }
      if (input.monthlyContributionCents !== null && input.monthlyContributionCents !== undefined &&
          (!Number.isInteger(input.monthlyContributionCents) || input.monthlyContributionCents < 0)) {
        throw apiErrors.badRequest("Monthly contribution must be non-negative cents.");
      }
      if (input.monthlyContributionCents !== null && input.monthlyContributionCents !== undefined) {
        assertValidCents(input.monthlyContributionCents, "monthlyContributionCents");
      }
      if (input.accountId) {
        const acc = await db.get("SELECT id FROM accounts WHERE id = ? AND user_id = ?", input.accountId, userId);
        if (!acc) throw apiErrors.badRequest("That account does not exist.");
      }
      // Contribution plan (012): one-off expenses can set money aside on a
      // schedule — regular intervals, specific days of the month, or agent-managed.
      const contributionMode = validateContributionMode(input.contributionMode);
      const contributionInterval = input.contributionInterval ?? null;
      // SAFETY: the cast narrows only to satisfy includes()'s parameter type;
      // values outside PAYDAY_INTERVALS fail the check and throw below.
      if (contributionMode === "interval" && (!contributionInterval || !PAYDAY_INTERVALS.includes(contributionInterval as PaydayInterval))) {
        throw apiErrors.badRequest("Regular-interval contributions need an interval: weekly, biweekly or monthly.");
      }
      const contributionDays = normalizeContributionDays(input.contributionDays);

      const id = randomUUID();
      const ts = now();
      await db.run(
        `INSERT INTO goals (id, user_id, name, type, category, target_cents, target_date, current_cents,
                            monthly_contribution_cents, contribution_mode, contribution_interval, contribution_days,
                            account_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        userId,
        name,
        input.type?.trim().slice(0, 30) || "savings",
        input.category?.trim().slice(0, 50) || "general",
        input.targetCents,
        input.targetDate ?? null,
        current,
        input.monthlyContributionCents ?? null,
        contributionMode,
        contributionInterval,
        contributionDays.length > 0 ? JSON.stringify(contributionDays) : null,
        input.accountId ?? null,
        input.notes?.trim().slice(0, 500) || null,
        ts,
        ts
      );
      return this.getGoal(userId, id);
    },

    async updateGoal(
      userId: string,
      id: string,
      input: Partial<{
        name: string;
        type: string;
        category: string;
        targetCents: number;
        targetDate: string | null;
        currentCents: number;
        monthlyContributionCents: number | null;
        contributionMode: string;
        contributionInterval: string | null;
        contributionDays: number[];
        accountId: string | null;
        notes: string | null;
      }>
    ): Promise<GoalWithProgress> {
      const row = await this.getGoal(userId, id);
      const name = input.name !== undefined ? input.name.trim().slice(0, 100) : row.name;
      if (!name) throw apiErrors.badRequest("Goal name cannot be empty.");
      const target = input.targetCents !== undefined ? input.targetCents : row.target_cents;
      if (!Number.isInteger(target) || target <= 0) throw apiErrors.badRequest("Target must be positive cents.");
      assertValidCents(target, "targetCents");
      const current = input.currentCents !== undefined ? input.currentCents : row.current_cents;
      if (!Number.isInteger(current) || current < 0) throw apiErrors.badRequest("Current amount must be non-negative cents.");
      assertValidCents(current, "currentCents");
      const targetDate = input.targetDate !== undefined ? input.targetDate : row.target_date;
      if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw apiErrors.badRequest("Target date must be YYYY-MM-DD.");
      const contribution = input.monthlyContributionCents !== undefined ? input.monthlyContributionCents : row.monthly_contribution_cents;
      if (contribution !== null && (!Number.isInteger(contribution) || contribution < 0)) {
        throw apiErrors.badRequest("Monthly contribution must be non-negative cents.");
      }
      if (contribution !== null) assertValidCents(contribution, "monthlyContributionCents");
      const contributionMode = input.contributionMode !== undefined ? validateContributionMode(input.contributionMode) : row.contribution_mode;
      const contributionInterval = input.contributionInterval !== undefined ? input.contributionInterval : row.contribution_interval;
      // SAFETY: the cast narrows only to satisfy includes()'s parameter type;
      // values outside PAYDAY_INTERVALS fail the check and throw below.
      if (contributionMode === "interval" && (!contributionInterval || !PAYDAY_INTERVALS.includes(contributionInterval as PaydayInterval))) {
        throw apiErrors.badRequest("Regular-interval contributions need an interval: weekly, biweekly or monthly.");
      }
      const contributionDays = input.contributionDays !== undefined ? normalizeContributionDays(input.contributionDays) : parseDayList(row.contribution_days);

      await db.run(
        `UPDATE goals SET name = ?, type = ?, category = ?, target_cents = ?, target_date = ?, current_cents = ?,
                          monthly_contribution_cents = ?, contribution_mode = ?, contribution_interval = ?, contribution_days = ?,
                          account_id = ?, notes = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`,
        name,
        input.type !== undefined ? input.type.trim().slice(0, 30) || "savings" : row.type,
        input.category !== undefined ? input.category.trim().slice(0, 50) || "general" : row.category,
        target,
        targetDate,
        current,
        contribution,
        contributionMode,
        contributionInterval,
        contributionDays.length > 0 ? JSON.stringify(contributionDays) : null,
        input.accountId !== undefined ? input.accountId : row.account_id,
        input.notes != null ? input.notes.trim().slice(0, 500) || null : row.notes,
        now(),
        id,
        userId
      );
      return this.getGoal(userId, id);
    },

    async removeGoal(userId: string, id: string): Promise<void> {
      await db.run("DELETE FROM goals WHERE id = ? AND user_id = ?", id, userId);
    },

    // ── MANUAL PAYDAYS (012) ──────────────────────────────────────────────
    /** Read the user's payday schedule. Defaults to auto (detect from income). */
    async getPaydays(userId: string): Promise<PaydaySettings> {
      const row = await db.get<{ payday_mode: string; payday_interval: string | null; payday_days: string | null }>(
        "SELECT payday_mode, payday_interval, payday_days FROM user_settings WHERE user_id = ?",
        userId
      );
      if (!row) return { mode: "auto", interval: null, days: [] };
      // SAFETY: `as string[]` widens the readonly tuple so includes() accepts
      // the raw DB string; `as PaydayMode` applies only when that check
      // passed — anything else falls back to "auto".
      const mode = (PAYDAY_MODES as string[]).includes(row.payday_mode) ? (row.payday_mode as PaydayMode) : "auto";
      // SAFETY: same read-side validation — the cast applies only when the
      // includes() gate passes, otherwise interval is null.
      const interval = row.payday_interval && (PAYDAY_INTERVALS as string[]).includes(row.payday_interval)
        ? (row.payday_interval as PaydayInterval)
        : null;
      return { mode, interval, days: parseDayList(row.payday_days) };
    },

    async setPaydays(userId: string, input: { mode?: string; interval?: string | null; days?: number[] }): Promise<PaydaySettings> {
      const current = await this.getPaydays(userId);
      // SAFETY: cast only widens string for the includes() gate on the next
      // line; any value outside PAYDAY_MODES throws badRequest.
      const mode = input.mode !== undefined ? input.mode as PaydayMode : current.mode;
      if (!PAYDAY_MODES.includes(mode)) throw apiErrors.badRequest("Payday mode must be auto, interval or days_of_month.");
      // SAFETY: the cast narrows only to satisfy includes()'s parameter type;
      // values outside PAYDAY_INTERVALS fail the check and throw below.
      if (mode === "interval" && (!input.interval || !PAYDAY_INTERVALS.includes(input.interval as PaydayInterval))) {
        throw apiErrors.badRequest("Payday intervals need an interval: weekly, biweekly or monthly.");
      }
      // SAFETY: when mode === "interval" the gate above already validated this
      // value against PAYDAY_INTERVALS; for other modes the stored value is
      // inert and getPaydays() re-validates on read (unknown → null).
      const interval = input.interval !== undefined ? (input.interval as PaydayInterval | null) : current.interval;
      if (mode === "days_of_month" && (!input.days || input.days.length === 0)) {
        throw apiErrors.badRequest("Pick at least one payday day of the month.");
      }
      const days = input.days !== undefined ? normalizeContributionDays(input.days) : current.days;
      await db.run(
        `INSERT INTO user_settings (user_id, payday_mode, payday_interval, payday_days, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           payday_mode = excluded.payday_mode,
           payday_interval = excluded.payday_interval,
           payday_days = excluded.payday_days,
           updated_at = excluded.updated_at`,
        userId,
        mode,
        interval,
        days.length > 0 ? JSON.stringify(days) : null,
        now()
      );
      return this.getPaydays(userId);
    },

    /** Next payday on/after `refDate` per the manual schedule, or null when auto. */
    async nextPaydayAfter(userId: string, refDate: string): Promise<string | null> {
      const pd = await this.getPaydays(userId);
      if (pd.mode === "auto") return null;
      if (pd.mode === "interval" && pd.interval) {
        switch (pd.interval) {
          case "weekly":
            return addDaysISO(refDate, 7);
          case "biweekly":
            return addDaysISO(refDate, 14);
          case "monthly":
            return addDaysISO(addMonthsISO(refDate, 1), 0);
        }
      }
      if (pd.mode === "days_of_month" && pd.days.length > 0) {
        // Next occurrence of any listed day, clamped to month ends.
        const candidates = pd.days.map((d) => nextOccurrenceOfDay(d, refDate)).sort();
        return candidates[0] ?? null;
      }
      return null;
    },

    // ── DIGEST ─────────────────────────────────────────────────────────────
    /**
     * Upcoming + overdue bills within the horizon (the "upcoming bills
     * digest"). Horizon = `until` (an explicit YYYY-MM-DD end date, e.g. end
     * of month or next paycheck) when given, otherwise `days` from today.
     */
    async digest(userId: string, days = 30, until?: string): Promise<{
      days: number;
      until: string | null;
      upcomingBills: BillWithNames[];
      overdueBills: BillWithNames[];
      totalUpcomingCents: number;
    }> {
      const today = todayISO();
      const horizon = until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : addDaysISO(today, days);
      const bills = await db.all<BillWithNames>(
        `SELECT b.*, c.name AS category_name, a.name AS account_name
           FROM bills b
           LEFT JOIN categories c ON c.id = b.category_id
           LEFT JOIN accounts a ON a.id = b.account_id
          WHERE b.user_id = ? AND b.active = 1 AND b.next_due_date IS NOT NULL`,
        userId
      );
      const upcoming = bills
        .filter((b) => b.next_due_date! >= today && b.next_due_date! <= horizon)
        .sort((a, b) => a.next_due_date!.localeCompare(b.next_due_date!));
      const overdue = bills
        .filter((b) => b.next_due_date! < today)
        .sort((a, b) => a.next_due_date!.localeCompare(b.next_due_date!));
      const totalUpcomingCents = upcoming.reduce((s, b) => s + b.amount_cents, 0);
      return { days, until: horizon, upcomingBills: upcoming, overdueBills: overdue, totalUpcomingCents };
    },
  };
}

export type PlanningService = ReturnType<typeof createPlanningService>;
