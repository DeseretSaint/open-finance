import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, SqliteDb } from "@/server/db/adapter";
import { decrypt } from "@/lib/crypto";
import { createAuthService } from "@/server/auth/service";
import { createPlaidService } from "@/server/plaid/service";
import type { PlaidClient, PlaidCreds } from "@/server/plaid/adapter";

const require = createRequire(import.meta.url);
const { runMigrations } = require(path.resolve("migrations/up.js"));

let dir: string;
let file: string;
let db: SqliteDb;
let userId: string;

const creds: PlaidCreds = { clientId: "test-client", secret: "test-secret", environment: "sandbox" };

function fakeClient(overrides: Partial<PlaidClient> = {}): PlaidClient {
  const calls = { removed: 0 };
  const client: PlaidClient = {
    async createLinkToken() {
      return "link-test-token";
    },
    async exchangePublicToken() {
      return { accessToken: "access-test-token", itemId: "item-test-1" };
    },
    async getAccounts() {
      return [
        { id: "acct-1", name: "Checking", officialName: null, type: "depository", subtype: "checking", mask: "1234", currentBalanceCents: 100000, availableBalanceCents: 90000, currency: "USD" },
        { id: "acct-2", name: "Credit Card", officialName: null, type: "credit", subtype: "credit card", mask: "5678", currentBalanceCents: -25000, availableBalanceCents: null, currency: "USD" },
      ];
    },
    async syncTransactions() {
      return { added: [], modified: [], removed: [], nextCursor: null, hasMore: false };
    },
    async removeItem() {
      calls.removed += 1;
    },
    async testCredentials() {
      return { ok: true };
    },
    ...overrides,
  };
  return Object.assign(client, { calls });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "of-plaid-"));
  file = path.join(dir, "test.db");
  const raw = new Database(file);
  runMigrations(raw);
  raw.close();
  db = createDb(file);
  const { user } = await createAuthService(db).register({
    username: "plaidtest",
    display_name: "Plaid Test",
    password: "plaid-test-strong-pass",
  });
  userId = user.id;
});

afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("plaid service (fake client)", () => {
  it("stores credentials encrypted and never returns values", async () => {
    const svc = createPlaidService(db, () => fakeClient());
    await svc.saveCredentials(userId, creds);

    const row = await db.get<{ client_id_enc: string; secret_enc: string }>(
      "SELECT client_id_enc, secret_enc FROM plaid_credentials WHERE user_id = ? AND environment = 'sandbox'",
      userId
    );
    expect(row).toBeTruthy();
    expect(row!.client_id_enc).not.toContain("test-client");
    expect(row!.secret_enc).not.toContain("test-secret");

    const status = await svc.listCredentialStatus(userId);
    expect(status.environments).toHaveLength(1);
    expect(status.environments[0].hasKeys).toBe(true);
    expect(JSON.stringify(status)).not.toContain("test-secret");

    // Round-trip decrypt works (access tokens must be recoverable server-side).
    const credsRow = await db.get<{ id: string; client_id_enc: string; secret_enc: string }>(
      "SELECT id, client_id_enc, secret_enc FROM plaid_credentials WHERE user_id = ?",
      userId
    );
    const aad = `${userId}:plaid:${credsRow!.id}`;
    expect(decrypt(credsRow!.client_id_enc, aad)).toBe("test-client");
    expect(decrypt(credsRow!.secret_enc, aad)).toBe("test-secret");
  });

  it("rejects invalid keys with a friendly message", async () => {
    const bad = fakeClient({ testCredentials: async () => ({ ok: false, message: "Those Plaid keys look invalid." }) });
    const svc = createPlaidService(db, () => bad);
    await expect(svc.saveCredentials(userId, creds)).rejects.toMatchObject({ code: "bad_request" });
  });

  it("creates a link token only when credentials exist", async () => {
    const svc = createPlaidService(db, () => fakeClient());
    const { linkToken } = await svc.createLinkToken(userId, "sandbox");
    expect(linkToken).toBe("link-test-token");
    await expect(svc.createLinkToken(userId, "production")).rejects.toMatchObject({ code: "not_found" });
  });

  it("exchanges a public token into an item + accounts (with user_id)", async () => {
    const svc = createPlaidService(db, () => fakeClient());
    const result = await svc.exchangePublicToken(userId, "sandbox", "public-test", "ins_109512", "Houndstooth Bank");
    expect(result.accountCount).toBe(2);

    const items = await svc.listItems(userId);
    expect(items).toHaveLength(1);
    expect(items[0].institution_name).toBe("Houndstooth Bank");
    expect(items[0].environment).toBe("sandbox");
    expect(items[0].accounts).toHaveLength(2);
    expect(items[0].accounts[0].name).toBe("Checking");

    const account = await db.get<{ user_id: string }>("SELECT user_id FROM accounts WHERE id = ?", items[0].accounts[0].id);
    expect(account?.user_id).toBe(userId);
  });

  it("removes an item and cascades its data", async () => {
    const fake = fakeClient() as PlaidClient & { calls: { removed: number } };
    const svc = createPlaidService(db, () => fake);
    const items = await svc.listItems(userId);
    const itemId = items[0].id;
    const accountIds = items[0].accounts.map((a) => a.id);

    await db.run(
      "INSERT INTO transactions (id, account_id, amount_cents, date, name, source, created_at) VALUES (?,?,?,?,?,?,?)",
      "tx-1", accountIds[0], 1234, "2026-01-01", "Test", "plaid", "2026-01-01T00:00:00Z"
    );

    await svc.removeItem(userId, itemId);
    expect(fake.calls.removed).toBe(1);
    const remaining = await svc.listItems(userId);
    expect(remaining).toHaveLength(0);
    expect(await db.get("SELECT id FROM accounts WHERE id = ?", accountIds[0])).toBeUndefined();
    expect(await db.get("SELECT id FROM transactions WHERE id = 'tx-1'")).toBeUndefined();
  });

  it("fails removing another user's item", async () => {
    const svc = createPlaidService(db, () => fakeClient());
    const { user: other } = await createAuthService(db).register({
      username: "otheruser",
      display_name: "Other",
      password: "other-user-strong-pass",
    });
    const fake2 = fakeClient();
    const svc2 = createPlaidService(db, () => fake2);
    await svc2.saveCredentials(other.id, creds);
    const item = await svc2.exchangePublicToken(other.id, "sandbox", "public-other", "ins_1", "Other Bank");
    await expect(svc.removeItem(userId, item.itemId)).rejects.toMatchObject({ code: "not_found" });
  });
});
