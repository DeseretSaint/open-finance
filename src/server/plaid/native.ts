"use client";

/**
 * nativePlaidClient — P8b solo-mode PlaidClient implementation.
 *
 * Every Plaid REST call goes through the native PlaidProxyPlugin (OkHttp in
 * Kotlin) instead of the server SDK: no CORS in the webview, no secrets in JS,
 * and Plaid Link launches natively via LinkKit (react-plaid-link inside a
 * webview is unsupported per plan §10).
 *
 * The web layer calls these methods with the user's own client_id/secret —
 * passed per call from the webview's in-memory state, never persisted in JS.
 */

import type {
  PlaidAccount,
  PlaidClient,
  PlaidCreds,
  PlaidSyncResult,
  PlaidTransaction,
} from "@/server/plaid/adapter";

/**
 * The only config field the web layer sends across the native bridge; the
 * Kotlin proxy builds the rest of Plaid's link/token/create body itself.
 */
interface PlaidLinkTokenConfig {
  client_user_id: string;
}

interface PlaidProxy {
  testCredentials: (opts: {
    clientId: string;
    secret: string;
    environment: string;
  }) => Promise<{ valid: boolean; error?: string }>;
  createLinkToken: (opts: {
    clientId: string;
    secret: string;
    environment: string;
    config?: PlaidLinkTokenConfig;
    accessToken?: string;
  }) => Promise<{ linkToken: string }>;
  exchangePublicToken: (opts: {
    clientId: string;
    secret: string;
    environment: string;
    publicToken: string;
  }) => Promise<{ accessToken: string; itemId: string }>;
  getAccounts: (opts: {
    clientId: string;
    secret: string;
    environment: string;
    accessToken: string;
  }) => Promise<{ accounts: PlaidAccount[] }>;
  syncTransactions: (opts: {
    clientId: string;
    secret: string;
    environment: string;
    accessToken: string;
    cursor?: string | null;
  }) => Promise<{
    added: PlaidTransaction[];
    modified: PlaidTransaction[];
    removed: { transactionId: string }[];
    nextCursor: string | null;
  }>;
  removeItem: (opts: {
    clientId: string;
    secret: string;
    environment: string;
    accessToken: string;
  }) => Promise<{ removed: boolean }>;
  getTransactions: (opts: {
    clientId: string;
    secret: string;
    environment: string;
    accessToken: string;
    startDate: string;
    endDate: string;
  }) => Promise<{ transactions: PlaidTransaction[] }>;
  launchLink: (opts: { linkToken: string }) => Promise<{
    cancelled: boolean;
    publicToken?: string;
    metadata?: { institutionName?: string | null };
    exit?: { code?: string; message?: string } | null;
  }>;
}

function proxy(): PlaidProxy | null {
  if (typeof globalThis === "undefined") return null;
  // SAFETY: globalThis is the Capacitor webview global at runtime; the
  // PlaidProxy handle on it is only ever assigned by this module (the
  // self-heal bridge below), and the field is read optional-chained only.
  const g = globalThis as unknown as { PlaidProxy?: PlaidProxy };
  if (g.PlaidProxy) return g.PlaidProxy;
  // Self-heal: bridge the native plugin lazily at the moment it's needed.
  // The eager bridge (providers → ensureNativePlugins) runs at mount, but
  // this covers any path that calls Plaid before that (or in a context where
  // window isn't the global). Capacitor exposes native plugins via
  // Capacitor.registerPlugin(name); we assign the proxy to the same handle.
  try {
    // SAFETY: read-only probe of the runtime global for the Capacitor
    // bridge; every field accessed is optional-chained, so any other shape
    // is inert and falls through to the null return.
    const w = globalThis as unknown as {
      window?: { Capacitor?: { registerPlugin?: (name: string) => PlaidProxy } };
      Capacitor?: { registerPlugin?: (name: string) => PlaidProxy };
    };
    const cap = w.window?.Capacitor ?? w.Capacitor;
    if (cap?.registerPlugin) {
      const p = cap.registerPlugin("PlaidProxy");
      g.PlaidProxy = p;
      return p;
    }
  } catch {
    /* fall through to the diagnostic error below */
  }
  return null;
}

export function createNativePlaidClient(): PlaidClient {
  const p = proxy();
  if (!p) {
    // SAFETY: diagnostic-only read of the runtime global to build the
    // error message; every field is optional-chained and never invoked.
    const g = globalThis as unknown as {
      Capacitor?: unknown;
      window?: { Capacitor?: unknown };
      PlaidProxy?: unknown;
    };
    // SAFETY: cap is only probed for a truthy registerPlugin in the
    // diagnostic string below; no field is invoked or trusted.
    const cap = (g.window?.Capacitor ?? g.Capacitor) as { registerPlugin?: unknown } | undefined;
    throw new Error(
      "PlaidProxy plugin unavailable (solo mode requires the native APK). " +
        `Diagnostics: Capacitor=${cap ? "yes" : "no"}, registerPlugin=${cap?.registerPlugin ? "yes" : "no"}, ` +
        `PlaidProxy handle=${g.PlaidProxy ? "set" : "missing"}. ` +
        "If Capacitor=yes but PlaidProxy=missing, the native plugin may not be registered in this build."
    );
  }
  return {
    async testCredentials(creds: PlaidCreds) {
      const r = await p.testCredentials({
        clientId: creds.clientId,
        secret: creds.secret,
        environment: creds.environment,
      });
      return r.valid ? { ok: true } : { ok: false, message: r.error };
    },

    async createLinkToken(creds: PlaidCreds, clientUserId: string, accessToken?: string) {
      const opts: Parameters<PlaidProxy["createLinkToken"]>[0] = {
        clientId: creds.clientId,
        secret: creds.secret,
        environment: creds.environment,
        config: { client_user_id: clientUserId },
      };
      if (accessToken) opts.accessToken = accessToken;
      const r = await p.createLinkToken(opts);
      return r.linkToken;
    },

    async exchangePublicToken(creds: PlaidCreds, publicToken: string) {
      const r = await p.exchangePublicToken({
        clientId: creds.clientId,
        secret: creds.secret,
        environment: creds.environment,
        publicToken,
      });
      return { accessToken: r.accessToken, itemId: r.itemId };
    },

    async getAccounts(creds: PlaidCreds, accessToken: string) {
      const r = await p.getAccounts({
        clientId: creds.clientId,
        secret: creds.secret,
        environment: creds.environment,
        accessToken,
      });
      return r.accounts;
    },

    async syncTransactions(creds: PlaidCreds, accessToken: string, cursor: string | null) {
      const r = await p.syncTransactions({
        clientId: creds.clientId,
        secret: creds.secret,
        environment: creds.environment,
        accessToken,
        cursor,
      });
      const result: PlaidSyncResult = {
        added: r.added,
        modified: r.modified,
        removed: r.removed,
        nextCursor: r.nextCursor,
        hasMore: false, // native proxy returns one page per call
      };
      return result;
    },

    async removeItem(creds: PlaidCreds, accessToken: string) {
      await p.removeItem({
        clientId: creds.clientId,
        secret: creds.secret,
        environment: creds.environment,
        accessToken,
      });
    },

    async getTransactions(creds: PlaidCreds, accessToken: string, start: string, end: string) {
      const r = await p.getTransactions({
        clientId: creds.clientId,
        secret: creds.secret,
        environment: creds.environment,
        accessToken,
        startDate: start,
        endDate: end,
      });
      return (r.transactions ?? []).map((t) => ({
        id: t.id,
        accountId: t.accountId,
        amountCents: t.amountCents,
        date: t.date,
        authorizedDate: t.authorizedDate,
        name: t.name,
        merchantName: t.merchantName,
        categoryPath: t.categoryPath,
        personalFinanceCategory: t.personalFinanceCategory,
        pending: t.pending,
      }));
    },
  };
}

/**
 * Solo sync adapter (P23 fix, v0.3.11): syncSoloItem calls
 * `client.syncTransactions({clientId, secret, environment, accessToken,
 * cursor})` with ONE object argument, but the native PlaidClient's
 * syncTransactions takes THREE positional arguments (creds, accessToken,
 * cursor). Passing the raw native client used to be hidden behind `as never`,
 * which made accessToken arrive as `undefined` → the Kotlin proxy rejected
 * with "missing accessToken" → every sync silently imported ZERO
 * transactions. This adapter bridges the two shapes explicitly.
 */
export function createSoloSyncClient(native: PlaidClient = createNativePlaidClient()): SoloNativeClient {
  return {
    async syncTransactions(opts: {
      clientId: string;
      secret: string;
      environment: "sandbox" | "production";
      accessToken: string;
      cursor: string | null;
    }) {
      const res = await native.syncTransactions(
        { clientId: opts.clientId, secret: opts.secret, environment: opts.environment },
        opts.accessToken,
        opts.cursor ?? null
      );
      return {
        added: res.added,
        modified: res.modified,
        removed: res.removed,
        nextCursor: res.nextCursor,
      };
    },
    async getTransactions(opts: {
      clientId: string;
      secret: string;
      environment: "sandbox" | "production";
      accessToken: string;
      startDate: string;
      endDate: string;
    }) {
      return native.getTransactions(
        { clientId: opts.clientId, secret: opts.secret, environment: opts.environment },
        opts.accessToken,
        opts.startDate,
        opts.endDate
      );
    },
  };
}

export type SoloNativeClient = import("@/lib/solo-plaid-sync").SoloNativeClient;

/**
 * Open native Plaid Link (solo mode). Returns the public token on success,
 * or { cancelled: true } when the user exits Link. The web layer then calls
 * exchangePublicToken via the PlaidClient above.
 */
export async function launchNativeLink(linkToken: string): Promise<{
  cancelled: boolean;
  publicToken?: string;
  institutionName?: string | null;
  exit?: { code?: string; message?: string } | null;
}> {
  const p = proxy();
  if (!p) throw new Error("PlaidProxy plugin unavailable (solo mode requires the native APK) — launchLink needs the native bridge.");
  const r = await p.launchLink({ linkToken });
  return {
    cancelled: r.cancelled,
    publicToken: r.publicToken,
    institutionName: r.metadata?.institutionName ?? null,
    exit: r.exit,
  };
}
