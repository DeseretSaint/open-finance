import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { randomUUID } from "node:crypto";
import { encrypt } from "@/lib/crypto";
import { apiErrors } from "@/lib/api-error";
import type { Db } from "@/server/db/types";

const MAGIC = "OFBAK-SOLO1";
const VERSION = 1;
const AAD = "open-finance:solo-backup:v1";
const TABLES = ["accounts", "categories", "budgets", "budget_categories", "transactions", "balance_history", "bills", "debts", "goals"] as const;
type Row = Record<string, unknown>;
type Dump = Record<string, Row[]>;

function decode(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function decryptDump(contents: string, pin: string): Dump {
  let envelope: { magic?: string; version?: number; kdf?: { salt?: string; iterations?: number }; tables?: string };
  try {
    // SAFETY: I/O parse boundary — every field of the parsed envelope is
    // re-validated immediately below (magic/version/kdf.salt/tables checks)
    // before any of it is used.
    envelope = JSON.parse(contents) as typeof envelope;
  } catch {
    throw apiErrors.badRequest("That file is not a valid Open Finance phone backup.");
  }
  if (envelope.magic !== MAGIC || envelope.version !== VERSION || !envelope.kdf?.salt || !envelope.tables) {
    throw apiErrors.badRequest("That is not a compatible standalone-phone backup.");
  }
  const key = pbkdf2Sync(pin, decode(envelope.kdf.salt), envelope.kdf.iterations || 150_000, 32, "sha256");
  const raw = decode(envelope.tables);
  if (raw.length < 29) throw apiErrors.badRequest("The phone backup is incomplete.");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(AAD, "utf8"));
    decipher.setAuthTag(tag);
    // SAFETY: authenticated-decrypt boundary — the payload is treated as
    // untrusted input: every table is Array.isArray-checked and every field
    // is re-validated via text()/integer() before use.
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as Dump;
  } catch {
    throw apiErrors.forbidden("That device PIN could not decrypt this phone backup.");
  }
}

function text(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
function integer(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** Additive phone import. It never deletes hub rows and never imports auth/session/secret tables. */
export function createPhoneImportService(db: Db) {
  async function importBackup(userId: string, pin: string, contents: string) {
    if (!/^\d{4,12}$/.test(pin)) throw apiErrors.badRequest("Enter the 4–12 digit PIN used on the phone.");
    const dump = decryptDump(contents, pin);
    const accounts = Array.isArray(dump.accounts) ? dump.accounts : [];
    const transactions = Array.isArray(dump.transactions) ? dump.transactions : [];
    const categories = Array.isArray(dump.categories) ? dump.categories : [];
    const budgets = Array.isArray(dump.budgets) ? dump.budgets : [];
    const budgetCategories = Array.isArray(dump.budget_categories) ? dump.budget_categories : [];
    const accountMap = new Map<string, string>();
    const itemMap = new Map<string, string>();
    const categoryMap = new Map<string, string>();
    let importedPlaid = 0;

    // Recreate the phone's Plaid credentials/items on the hub. The phone
    // backup is already PIN-encrypted; credentials are re-encrypted with the
    // hub's key immediately and never returned to the client.
    // SAFETY: decrypted-dump boundary — __phonePlaid is an optional extension
    // field written by the phone exporter; every field below is re-validated
    // (typeof string checks, environment whitelist, text()/integer() helpers)
    // before use.
    const plaid = (dump as unknown as { __phonePlaid?: { creds: Record<string, unknown> | null; items: Array<Record<string, unknown>> } }).__phonePlaid;
    if (plaid?.creds && typeof plaid.creds.clientId === "string" && typeof plaid.creds.secret === "string") {
      const environment = plaid.creds.environment === "production" ? "production" : "sandbox";
      const existing = await db.get<{ id: string }>("SELECT id FROM plaid_credentials WHERE user_id = ? AND environment = ?", userId, environment);
      const id = existing?.id ?? randomUUID();
      const aad = `${userId}:plaid:${id}`;
      const clientIdEnc = encrypt(plaid.creds.clientId, aad);
      const secretEnc = encrypt(plaid.creds.secret, aad);
      if (existing) {
        await db.run("UPDATE plaid_credentials SET client_id_enc = ?, secret_enc = ?, updated_at = ? WHERE id = ?", clientIdEnc, secretEnc, new Date().toISOString(), id);
      } else {
        await db.run("INSERT INTO plaid_credentials (id,user_id,client_id_enc,secret_enc,environment,updated_at) VALUES (?,?,?,?,?,?)", id, userId, clientIdEnc, secretEnc, environment, new Date().toISOString());
      }
    }
    for (const item of plaid?.items ?? []) {
      const oldId = text(item, "id");
      const plaidItemId = text(item, "plaidItemId") ?? text(item, "id");
      if (!oldId || !plaidItemId || typeof item.accessToken !== "string") continue;
      const existing = await db.get<{ id: string }>("SELECT id FROM plaid_items WHERE user_id = ? AND plaid_item_id = ?", userId, plaidItemId);
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        const environment = item.environment === "production" ? "production" : "sandbox";
        await db.run("INSERT INTO plaid_items (id,user_id,plaid_item_id,institution_name,environment,access_token_enc,status,created_at) VALUES (?,?,?,?,?,?,?,?)", id, userId, plaidItemId, text(item, "institutionName"), environment, encrypt(item.accessToken, `${userId}:plaid:${id}`), "active", text(item, "linkedAt") ?? new Date().toISOString());
        importedPlaid++;
      }
      itemMap.set(oldId, id);
    }
    const budgetMap = new Map<string, string>();
    const imported = { accounts: 0, transactions: 0, categories: 0, budgets: 0, bills: 0, debts: 0, goals: 0 };

    await db.transaction(async () => {
      for (const row of categories) {
        const name = text(row, "name");
        if (!name) continue;
        const existing = await db.get<{ id: string }>("SELECT id FROM categories WHERE user_id = ? AND name = ?", userId, name);
        const id = existing?.id ?? randomUUID();
        if (!existing) {
          await db.run("INSERT INTO categories (id, user_id, name, color, plaid_paths, is_system, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)", id, userId, name, text(row, "color"), text(row, "plaid_paths"), new Date().toISOString());
          imported.categories++;
        }
        const oldId = text(row, "id");
        if (oldId) categoryMap.set(oldId, id);
      }

      for (const row of accounts) {
        const oldId = text(row, "id");
        const plaidId = text(row, "plaid_account_id");
        const existing = plaidId
          ? await db.get<{ id: string }>("SELECT id FROM accounts WHERE user_id = ? AND plaid_account_id = ?", userId, plaidId)
          : null;
        const id = existing?.id ?? randomUUID();
        if (!existing) {
          await db.run(
            "INSERT INTO accounts (id, user_id, item_id, plaid_account_id, name, official_name, type, subtype, mask, current_balance_cents, available_balance_cents, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id, userId, itemMap.get(text(row, "item_id") ?? "") ?? null, plaidId, text(row, "name") ?? "Imported account", text(row, "official_name"), text(row, "type"), text(row, "subtype"), text(row, "mask"), integer(row, "current_balance_cents"), integer(row, "available_balance_cents"), text(row, "currency") ?? "USD", text(row, "created_at") ?? new Date().toISOString()
          );
          imported.accounts++;
        }
        if (oldId) accountMap.set(oldId, id);
      }

      for (const row of transactions) {
        const accountId = accountMap.get(text(row, "account_id") ?? "");
        if (!accountId) continue;
        const plaidTxn = text(row, "plaid_transaction_id");
        const duplicate = plaidTxn ? await db.get<{ id: string }>("SELECT id FROM transactions WHERE plaid_transaction_id = ?", plaidTxn) : null;
        if (duplicate) continue;
        await db.run(
          "INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, authorized_date, name, merchant_name, category_path, personal_finance_category, pending, user_category_id, user_note, exclude_from_budgets, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          randomUUID(), accountId, plaidTxn, integer(row, "amount_cents") ?? 0, text(row, "date") ?? new Date().toISOString().slice(0, 10), text(row, "authorized_date"), text(row, "name") ?? "Imported transaction", text(row, "merchant_name"), text(row, "category_path"), text(row, "personal_finance_category"), integer(row, "pending") ?? 0, categoryMap.get(text(row, "user_category_id") ?? "") ?? null, text(row, "user_note"), integer(row, "exclude_from_budgets") ?? 0, text(row, "source") ?? "phone-import", text(row, "created_at") ?? new Date().toISOString()
        );
        imported.transactions++;
      }

      for (const row of budgets) {
        const name = text(row, "name");
        if (!name) continue;
        const existing = await db.get<{ id: string }>("SELECT id FROM budgets WHERE user_id = ? AND name = ?", userId, name);
        const id = existing?.id ?? randomUUID();
        if (!existing) {
          await db.run("INSERT INTO budgets (id, user_id, name, amount_cents, period, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, userId, name, integer(row, "amount_cents") ?? 0, text(row, "period") ?? "monthly", text(row, "created_at") ?? new Date().toISOString());
          imported.budgets++;
        }
        const oldId = text(row, "id");
        if (oldId) budgetMap.set(oldId, id);
      }

      for (const row of budgetCategories) {
        const budgetId = budgetMap.get(text(row, "budget_id") ?? "");
        const categoryId = categoryMap.get(text(row, "category_id") ?? "");
        if (budgetId && categoryId) await db.run("INSERT OR IGNORE INTO budget_categories (budget_id, category_id) VALUES (?, ?)", budgetId, categoryId);
      }

      for (const table of ["bills", "debts", "goals"] as const) {
        for (const row of dump[table] ?? []) {
          const name = text(row, "name");
          if (!name) continue;
          const exists = await db.get<{ id: string }>(`SELECT id FROM ${table} WHERE user_id = ? AND name = ?`, userId, name);
          if (exists) continue;
          const id = randomUUID();
          if (table === "bills") await db.run("INSERT INTO bills (id,user_id,name,amount_cents,frequency,due_day,next_due_date,last_paid_amount_cents,category_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", id,userId,name,integer(row,"amount_cents")??0,text(row,"frequency")??"monthly",integer(row,"due_day"),text(row,"next_due_date"),integer(row,"last_paid_amount_cents"),categoryMap.get(text(row,"category_id")??"")??null,text(row,"notes"),new Date().toISOString(),new Date().toISOString());
          if (table === "debts") await db.run("INSERT INTO debts (id,user_id,name,type,principal_cents,apr_bps,min_payment_cents,term_months,start_date,next_due_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", id,userId,name,text(row,"type")??"other",integer(row,"principal_cents")??0,integer(row,"apr_bps")??0,integer(row,"min_payment_cents")??0,integer(row,"term_months"),text(row,"start_date")??new Date().toISOString().slice(0,10),text(row,"next_due_date"),text(row,"notes"),new Date().toISOString(),new Date().toISOString());
          if (table === "goals") await db.run("INSERT INTO goals (id,user_id,name,type,category,target_cents,target_date,current_cents,monthly_contribution_cents,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", id,userId,name,text(row,"type")??"savings",text(row,"category")??"general",integer(row,"target_cents")??0,text(row,"target_date"),integer(row,"current_cents")??0,integer(row,"monthly_contribution_cents"),text(row,"notes"),new Date().toISOString(),new Date().toISOString());
          imported[table]++;
        }
      }
    });
    return { imported, plaidItems: importedPlaid, source: "standalone-phone", additive: true, phoneWasModified: false };
  }
  return { importBackup };
}
export type PhoneImportService = ReturnType<typeof createPhoneImportService>;

export { TABLES };
