/** Shared domain types — pure TS, no platform imports (server + webview). */

export type AccountType = "depository" | "credit" | "investment" | "loan" | "other";

export interface AccountRow {
  id: string;
  itemId: string | null;
  plaidAccountId: string | null;
  name: string;
  officialName: string | null;
  type: AccountType | null;
  subtype: string | null;
  mask: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  currency: string;
}

export interface TransactionRow {
  id: string;
  accountId: string;
  plaidTransactionId: string | null;
  amountCents: number;
  date: string;
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  categoryPath: string | null;
  personalFinanceCategory: string | null;
  pending: boolean;
  userCategoryId: string | null;
  userNote: string | null;
  excludeFromBudgets: boolean;
  source: "plaid" | "manual";
}

export interface CategoryRow {
  id: string;
  userId: string;
  name: string;
  color: string;
  plaidPaths: string | null;
  isSystem: boolean;
}

export interface BillRow {
  id: string;
  userId: string;
  name: string;
  amountCents: number;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "one-time";
  dueDay: number | null;
  nextDueDate: string | null;
  lastPaidAmountCents: number | null;
  categoryId: string | null;
  accountId: string | null;
  active: boolean;
}

export interface DebtRow {
  id: string;
  userId: string;
  name: string;
  type: string;
  principalCents: number;
  aprBps: number;
  minPaymentCents: number;
  termMonths: number | null;
  startDate: string;
  nextDueDate: string | null;
}

export interface GoalRow {
  id: string;
  userId: string;
  name: string;
  type: "savings" | "investment";
  category: string;
  targetCents: number;
  targetDate: string | null;
  currentCents: number;
  monthlyContributionCents: number | null;
}

export interface AgentTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  preset: string;
  scopes: string[];
  accountIds: string[] | null;
  uiTabs: string[] | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}
