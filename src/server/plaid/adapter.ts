export type PlaidEnvironment = "sandbox" | "production";

export interface PlaidCreds {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
}

export function normalizePlaidAccountType(type: string | null | undefined, subtype: string | null | undefined): string {
  const t = (type ?? "").toLowerCase();
  const s = (subtype ?? "").toLowerCase();
  if (s.includes("credit card") || t === "credit") return "credit";
  if (s.includes("auto loan") || s.includes("mortgage") || t === "loan") return "loan";
  if (t === "investment" || t === "depository") return t;
  return "other";
}

export interface PlaidAccount {
  id: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  currency: string;
}

export interface PlaidTransaction {
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

export interface PlaidSyncResult {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transactionId: string }[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** All Plaid calls go through this interface so tests can inject a fake and
 *  the Android native plugin can implement the same surface in P8b. */
export interface PlaidClient {
  createLinkToken(creds: PlaidCreds, clientUserId: string, accessToken?: string): Promise<string>;
  exchangePublicToken(
    creds: PlaidCreds,
    publicToken: string
  ): Promise<{ accessToken: string; itemId: string }>;
  getAccounts(creds: PlaidCreds, accessToken: string): Promise<PlaidAccount[]>;
  syncTransactions(creds: PlaidCreds, accessToken: string, cursor: string | null): Promise<PlaidSyncResult>;
  /** Pull-based history fetch (transactions/get). Returns transactions in an
   *  explicit date range — used to backfill older history on an EXISTING item
   *  without deleting it (and without burning a Plaid link slot). Unlike
   *  transactions/sync, the link-time 90-day window lock does not apply. */
  getTransactions(
    creds: PlaidCreds,
    accessToken: string,
    start: string,
    end: string
  ): Promise<PlaidTransaction[]>;
  removeItem(creds: PlaidCreds, accessToken: string): Promise<void>;
  testCredentials(creds: PlaidCreds): Promise<{ ok: boolean; message?: string }>;
}
