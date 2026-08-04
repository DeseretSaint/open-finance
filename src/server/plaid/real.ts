import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type LinkTokenCreateRequest,
  type TransactionsSyncRequest,
} from "plaid";
import {
  normalizePlaidAccountType,
  type PlaidAccount,
  PlaidClient,
  PlaidCreds,
  PlaidSyncResult,
  PlaidTransaction,
} from "./adapter";

function cents(n: number): number {
  return Math.round(n * 100);
}

function clientFor(creds: PlaidCreds): PlaidApi {
  const config = new Configuration({
    basePath: PlaidEnvironments[creds.environment],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": creds.clientId,
        "PLAID-SECRET": creds.secret,
      },
    },
  });
  return new PlaidApi(config);
}

function mapError(e: unknown): { ok: boolean; message: string } {
  const err = e as { response?: { data?: { error_code?: string; error_message?: string } }; message?: string };
  const code = err.response?.data?.error_code;
  const detail = err.response?.data?.error_message || err.message || "Unknown Plaid error.";
  switch (code) {
    case "INVALID_API_KEYS":
    case "INVALID_CLIENT_ID":
      return { ok: false, message: "Those Plaid keys look invalid — double-check client_id and secret." };
    case "INVALID_INPUT":
      return { ok: false, message: `Plaid rejected the input (${detail}) — check the environment matches your keys.` };
    case "RATE_LIMIT_EXCEEDED":
      return { ok: false, message: "Plaid rate limit hit — try again in a minute." };
    case "NOT_IMPLEMENTED":
      return { ok: false, message: "That feature isn't available in this environment yet." };
    default:
      return { ok: false, message: `Plaid error: ${code ?? "unknown"} — ${detail}` };
  }
}

export const realPlaidClient: PlaidClient = {
  async createLinkToken(creds, clientUserId) {
    const client = clientFor(creds);
    const req: LinkTokenCreateRequest = {
      client_name: "Open Finance",
      language: "en",
      country_codes: [CountryCode.Us],
      user: { client_user_id: clientUserId },
      products: [Products.Transactions],
    };
    const res = await client.linkTokenCreate(req);
    return res.data.link_token;
  },

  async exchangePublicToken(creds, publicToken) {
    const client = clientFor(creds);
    const res = await client.itemPublicTokenExchange({ public_token: publicToken });
    return { accessToken: res.data.access_token, itemId: res.data.item_id };
  },

  async getAccounts(creds, accessToken) {
    const client = clientFor(creds);
    const res = await client.accountsGet({ access_token: accessToken });
    return res.data.accounts.map((a): PlaidAccount => ({
      id: a.account_id,
      name: a.name,
      officialName: a.official_name ?? null,
      type: normalizePlaidAccountType(a.type, a.subtype),
      subtype: a.subtype ?? null,
      mask: a.mask ?? null,
      currentBalanceCents: a.balances.current !== null && a.balances.current !== undefined ? cents(a.balances.current) : null,
      availableBalanceCents: a.balances.available !== null && a.balances.available !== undefined ? cents(a.balances.available) : null,
      currency: a.balances.iso_currency_code ?? "USD",
    }));
  },

  async syncTransactions(creds, accessToken, cursor) {
    const client = clientFor(creds);
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: PlaidSyncResult["removed"] = [];
    let nextCursor = cursor ?? null;
    let hasMore = true;

    while (hasMore) {
      const req: TransactionsSyncRequest = { access_token: accessToken };
      if (nextCursor) req.cursor = nextCursor;
      const res = await client.transactionsSync(req);
      const data = res.data;

      const map = (t: {
        transaction_id: string; account_id: string; amount: number; date: string;
        authorized_date: string | null; name: string; merchant_name: string | null;
        category: string[] | null; personal_finance_category: { detailed: string } | null;
        pending: boolean;
      }): PlaidTransaction => ({
        id: t.transaction_id,
        accountId: t.account_id,
        amountCents: cents(t.amount),
        date: t.date,
        authorizedDate: t.authorized_date,
        name: t.name,
        merchantName: t.merchant_name,
        categoryPath: t.category ? t.category.join("|") : null,
        personalFinanceCategory: t.personal_finance_category?.detailed ?? null,
        pending: t.pending,
      });

      for (const t of data.added) added.push(map(t as never));
      for (const t of data.modified) modified.push(map(t as never));
      for (const t of data.removed) removed.push({ transactionId: t.transaction_id });

      nextCursor = data.next_cursor;
      hasMore = data.has_more;
      if (added.length + modified.length > 100_000) break; // safety
    }

    return { added, modified, removed, nextCursor, hasMore: false };
  },

  async removeItem(creds, accessToken) {
    const client = clientFor(creds);
    await client.itemRemove({ access_token: accessToken });
  },

  async testCredentials(creds) {
    try {
      // Cheapest real call: create a link token in the target environment.
      await this.createLinkToken(creds, "open-finance-key-test");
      return { ok: true };
    } catch (e) {
      return mapError(e);
    }
  },
};
