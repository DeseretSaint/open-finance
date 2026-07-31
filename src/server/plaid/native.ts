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
    config?: Record<string, unknown>;
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
  launchLink: (opts: { linkToken: string }) => Promise<{
    cancelled: boolean;
    publicToken?: string;
    metadata?: { institutionName?: string | null };
    exit?: { code?: string; message?: string } | null;
  }>;
}

function proxy(): PlaidProxy | null {
  if (typeof globalThis === "undefined") return null;
  return (globalThis as unknown as { PlaidProxy?: PlaidProxy }).PlaidProxy ?? null;
}

export function createNativePlaidClient(): PlaidClient {
  const p = proxy();
  if (!p) {
    throw new Error("PlaidProxy plugin unavailable — solo mode requires the native APK.");
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

    async createLinkToken(creds: PlaidCreds, clientUserId: string) {
      const r = await p.createLinkToken({
        clientId: creds.clientId,
        secret: creds.secret,
        environment: creds.environment,
        config: { client_user_id: clientUserId },
      });
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
  };
}

/**
 * Open native Plaid Link (solo mode). Returns the public token on success,
 * or { cancelled: true } when the user exits Link. The web layer then calls
 * exchangePublicToken via the PlaidClient above.
 */
export async function launchNativeLink(linkToken: string): Promise<{
  cancelled: boolean;
  publicToken?: string;
  exit?: { code?: string; message?: string } | null;
}> {
  const p = proxy();
  if (!p) throw new Error("PlaidProxy plugin unavailable — solo mode requires the native APK.");
  const r = await p.launchLink({ linkToken });
  return { cancelled: r.cancelled, publicToken: r.publicToken, exit: r.exit };
}
