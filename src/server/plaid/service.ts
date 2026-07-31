import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";
import { apiErrors } from "@/lib/api";
import { getDb, type Db } from "@/server/db/adapter";
import type { PlaidClient, PlaidCreds, PlaidEnvironment } from "./adapter";
import { realPlaidClient } from "./real";

export interface PlaidCredentialRow {
  id: string;
  user_id: string;
  client_id_enc: string;
  secret_enc: string;
  environment: string;
  updated_at: string;
}

function now(): string {
  return new Date().toISOString();
}

export function createPlaidService(db: Db = getDb(), clientFactory: (creds: PlaidCreds) => PlaidClient = () => realPlaidClient) {
  function aad(userId: string, recordId: string): string {
    return `${userId}:plaid:${recordId}`;
  }

  async function getCreds(userId: string, environment: PlaidEnvironment): Promise<{ creds: PlaidCreds; row: PlaidCredentialRow }> {
    const row = await db.get<PlaidCredentialRow>(
      "SELECT * FROM plaid_credentials WHERE user_id = ? AND environment = ?",
      userId,
      environment
    );
    if (!row) throw apiErrors.notFound("Plaid credentials");
    return {
      creds: {
        clientId: decrypt(row.client_id_enc, aad(userId, row.id)),
        secret: decrypt(row.secret_enc, aad(userId, row.id)),
        environment,
      },
      row,
    };
  }

  return {
    /** Returns which environments have keys (never the values). */
    async listCredentialStatus(userId: string) {
      const rows = await db.all<{ environment: string; updated_at: string }>(
        "SELECT environment, updated_at FROM plaid_credentials WHERE user_id = ?",
        userId
      );
      return { environments: rows.map((r) => ({ environment: r.environment, hasKeys: true, updatedAt: r.updated_at })) };
    },

    /** Validates keys live against Plaid, then stores them encrypted. */
    async saveCredentials(userId: string, input: { clientId: string; secret: string; environment: PlaidEnvironment }) {
      if (!input.clientId.trim() || !input.secret.trim()) {
        throw apiErrors.badRequest("Client ID and secret are required.");
      }
      const creds: PlaidCreds = {
        clientId: input.clientId.trim(),
        secret: input.secret.trim(),
        environment: input.environment,
      };
      const client = clientFactory(creds);
      const test = await client.testCredentials(creds);
      if (!test.ok) throw apiErrors.badRequest(test.message ?? "Could not validate those keys.");

      const existing = await db.get<{ id: string }>(
        "SELECT id FROM plaid_credentials WHERE user_id = ? AND environment = ?",
        userId,
        input.environment
      );
      const id = existing?.id ?? randomUUID();
      const clientIdEnc = encrypt(creds.clientId, aad(userId, id));
      const secretEnc = encrypt(creds.secret, aad(userId, id));
      if (existing) {
        await db.run(
          "UPDATE plaid_credentials SET client_id_enc = ?, secret_enc = ?, updated_at = ? WHERE id = ?",
          clientIdEnc,
          secretEnc,
          now(),
          id
        );
      } else {
        await db.run(
          "INSERT INTO plaid_credentials (id, user_id, client_id_enc, secret_enc, environment, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          id,
          userId,
          clientIdEnc,
          secretEnc,
          input.environment,
          now()
        );
      }
      return { environment: input.environment, updatedAt: now() };
    },

    async createLinkToken(userId: string, environment: PlaidEnvironment) {
      const { creds } = await getCreds(userId, environment);
      const token = await clientFactory(creds).createLinkToken(creds, userId);
      return { linkToken: token };
    },

    async exchangePublicToken(
      userId: string,
      environment: PlaidEnvironment,
      publicToken: string,
      institutionId: string | null,
      institutionName: string | null
    ) {
      const { creds } = await getCreds(userId, environment);
      const client = clientFactory(creds);
      const { accessToken, itemId } = await client.exchangePublicToken(creds, publicToken);

      const itemRowId = randomUUID();
      await db.run(
        `INSERT INTO plaid_items (id, user_id, plaid_item_id, institution_id, institution_name, environment, access_token_enc, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        itemRowId,
        userId,
        itemId,
        institutionId,
        institutionName,
        environment,
        encrypt(accessToken, aad(userId, itemRowId)),
        now()
      );

      const accounts = await client.getAccounts(creds, accessToken);
      for (const a of accounts) {
        await db.run(
          `INSERT INTO accounts (id, user_id, item_id, plaid_account_id, name, official_name, type, subtype, mask,
                                 current_balance_cents, available_balance_cents, currency, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(),
          userId,
          itemRowId,
          a.id,
          a.name,
          a.officialName,
          a.type,
          a.subtype,
          a.mask,
          a.currentBalanceCents,
          a.availableBalanceCents,
          a.currency,
          now()
        );
      }

      return { itemId: itemRowId, accountCount: accounts.length };
    },

    async listItems(userId: string) {
      const items = await db.all<{
        id: string; plaid_item_id: string | null; institution_id: string | null;
        institution_name: string | null; environment: string; status: string;
        last_sync_at: string | null; created_at: string;
      }>(
        "SELECT id, plaid_item_id, institution_id, institution_name, environment, status, last_sync_at, created_at FROM plaid_items WHERE user_id = ? ORDER BY created_at DESC",
        userId
      );
      const result = [];
      for (const item of items) {
        const accounts = await db.all<{
          id: string; name: string; type: string | null; subtype: string | null; mask: string | null;
          current_balance_cents: number | null; available_balance_cents: number | null; currency: string;
        }>("SELECT id, name, type, subtype, mask, current_balance_cents, available_balance_cents, currency FROM accounts WHERE item_id = ? ORDER BY name", item.id);
        result.push({ ...item, accounts });
      }
      return result;
    },

    async removeItem(userId: string, itemRowId: string) {
      const item = await db.get<{ id: string; access_token_enc: string; environment: PlaidEnvironment }>(
        "SELECT id, access_token_enc, environment FROM plaid_items WHERE id = ? AND user_id = ?",
        itemRowId,
        userId
      );
      if (!item) throw apiErrors.notFound("Item");

      // Best-effort revoke at Plaid; always clean up locally.
      try {
        const { creds } = await getCreds(userId, item.environment);
        const accessToken = decrypt(item.access_token_enc, aad(userId, item.id));
        await clientFactory(creds).removeItem(creds, accessToken);
      } catch {
        // ignore Plaid-side errors on removal
      }

      await db.transaction(async () => {
        await db.run("DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE item_id = ?)", itemRowId);
        await db.run("DELETE FROM balance_history WHERE account_id IN (SELECT id FROM accounts WHERE item_id = ?)", itemRowId);
        await db.run("DELETE FROM accounts WHERE item_id = ?", itemRowId);
        await db.run("DELETE FROM plaid_items WHERE id = ?", itemRowId);
      });
    },
  };
}

export type PlaidService = ReturnType<typeof createPlaidService>;
