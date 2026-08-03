import { apiErrors } from "@/lib/api-error";
import { derivePinHashHex } from "@/lib/pin-crypto";
import type { Db } from "@/server/db/types";
import { aesGcmDecrypt, aesGcmEncrypt, randomBytes } from "@/lib/webcrypto-shim";

/**
 * Phone-solo backup & restore (D1).
 *
 * The hub backup encrypts the raw SQLite FILE with node:crypto — impossible on
 * the phone (cap-sqlite gives no safe file path, and node:crypto is shimmed
 * away in the webview bundle). Solo instead exports a JSON dump of every
 * user-data table, encrypted with AES-256-GCM via WebCrypto.
 *
 * Envelope v1 (`OFBAK-SOLO1`):
 *   { magic, version: 1, createdAt, kdf: { salt, iterations }, tables: <b64> }
 * `tables` is base64(iv || tag || ct) of the JSON dump, encrypted under
 * key = PBKDF2(pin, salt, 150k, SHA-256) — so a backup taken on the phone is
 * useless without that phone's unlock PIN, and a wrong PIN fails the GCM
 * auth tag (clean 400, no partial restore).
 *
 * Restore is non-destructive-by-default in spirit: it validates + decrypts
 * everything BEFORE touching the database, then replaces all user-data rows
 * in ONE transaction (all-or-nothing — a failed restore can never strand a
 * half-wiped database). PRAGMA foreign_keys is disabled for the duration so
 * insertion order doesn't matter; referential integrity is preserved because
 * the dump carries every row of every table.
 *
 * Webview-safe: no node:* imports (works under the mobile bundle's alias).
 */

const MAGIC = "OFBAK-SOLO1";
const VERSION = 1;
const KDF_ITERATIONS = 150_000;
const AAD = "open-finance:solo-backup:v1";

/**
 * Every table carrying user data, in export order. `_migrations` and derived
 * state (notifications log, SSE) are intentionally excluded — schema is
 * rebuilt by migrations, and schedules regenerate on next launch.
 * Keep in sync with migrations/001–010.
 */
const DATA_TABLES = [
  "users",
  "user_settings",
  "accounts",
  "categories",
  "budgets",
  "budget_categories",
  "transactions",
  "balance_history",
  "plaid_items",
  "plaid_credentials",
  "bills",
  "debts",
  "goals",
  "agent_tokens",
  "agent_permission_requests",
  "agent_access_log",
  "custom_views",
  "sessions",
  "device_lock",
] as const;

interface SoloBackupEnvelope {
  magic: string;
  version: number;
  createdAt: string;
  kdf: { salt: string; iterations: number };
  tables: string; // base64(iv || tag || ct) of the JSON dump
}

type Dump = Record<string, Array<Record<string, unknown>>>;

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    material,
    256
  );
  return new Uint8Array(bits);
}

/** Decrypt the AES-GCM layer produced by webcrypto-shim (base64 iv||tag||ct). */
async function decryptTables(payload: string, keyBytes: Uint8Array): Promise<string> {
  return aesGcmDecrypt(payload, keyBytes, AAD);
}

async function encryptTables(json: string, keyBytes: Uint8Array): Promise<string> {
  return aesGcmEncrypt(json, keyBytes, AAD);
}

export function createSoloBackupService(db: Db) {
  /** Validate the device PIN before allowing export/restore (same hash check the lock uses). */
  async function requirePin(userId: string, pin: string): Promise<void> {
    if (!pin || !/^\d{4,12}$/.test(pin)) {
      throw apiErrors.badRequest("Enter your 4–12 digit device PIN.");
    }
    const row = await db.get<{ pin_hash: string | null; pin_salt: string | null }>(
      "SELECT pin_hash, pin_salt FROM device_lock WHERE user_id = ?",
      userId
    );
    if (!row?.pin_hash || !row.pin_salt) {
      throw apiErrors.badRequest("Set a device PIN first (Settings → Notifications & security).");
    }
    const hash = await derivePinHashHex(pin, row.pin_salt);
    if (hash !== row.pin_hash) {
      throw apiErrors.forbidden("That PIN doesn't match this device. Backup aborted.");
    }
  }

  /** Export every user-data table as an encrypted JSON envelope (returned as a string for download/share). */
  async function exportBackup(userId: string, pin: string): Promise<{ filename: string; contents: string }> {
    await requirePin(userId, pin);

    const dump: Dump = {};
    for (const table of DATA_TABLES) {
      try {
        dump[table] = await db.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
      } catch {
        // Table may not exist yet on an older schema — skip rather than fail.
        dump[table] = [];
      }
    }

    const salt = randomBytes(16);
    const key = await deriveKey(pin, salt, KDF_ITERATIONS);
    const envelope: SoloBackupEnvelope = {
      magic: MAGIC,
      version: VERSION,
      createdAt: new Date().toISOString(),
      kdf: { salt: b64encode(salt), iterations: KDF_ITERATIONS },
      tables: await encryptTables(JSON.stringify(dump), key),
    };
    const date = envelope.createdAt.slice(0, 10);
    return {
      filename: `open-finance-phone-${date}.ofbak.json`,
      contents: JSON.stringify(envelope),
    };
  }

  /**
   * Replace all user-data with the decrypted dump. All-or-nothing: everything
   * is validated and decrypted before a single write happens, and the swap
   * runs inside one transaction.
   */
  async function restoreBackup(
    userId: string,
    pin: string,
    contents: string
  ): Promise<{ restored: true; tables: number; rows: number }> {
    await requirePin(userId, pin);

    let envelope: SoloBackupEnvelope;
    try {
      envelope = JSON.parse(contents) as SoloBackupEnvelope;
    } catch {
      throw apiErrors.badRequest("That file isn't an Open Finance phone backup.");
    }
    if (envelope.magic !== MAGIC || envelope.version !== VERSION || !envelope.tables || !envelope.kdf?.salt) {
      throw apiErrors.badRequest("That file isn't an Open Finance phone backup (or it's a newer format).");
    }

    const salt = b64decode(envelope.kdf.salt);
    const key = await deriveKey(pin, salt, envelope.kdf.iterations || KDF_ITERATIONS);
    let dump: Dump;
    try {
      dump = JSON.parse(await decryptTables(envelope.tables, key)) as Dump;
    } catch {
      throw apiErrors.badRequest(
        "Could not decrypt this backup — it was made with a different PIN (or the file is damaged)."
      );
    }
    if (typeof dump !== "object" || dump === null || !Array.isArray(dump.users)) {
      throw apiErrors.badRequest("This backup is missing its data tables.");
    }

    // All validation is done — swap the data in one transaction.
    let rows = 0;
    let tables = 0;
    await db.run("PRAGMA foreign_keys = OFF");
    try {
      await db.transaction(async () => {
        for (const table of DATA_TABLES) {
          const incoming = dump[table];
          if (!Array.isArray(incoming)) continue; // older backup without this table
          await db.run(`DELETE FROM ${table}`);
          tables++;
          for (const row of incoming) {
            const cols = Object.keys(row);
            if (cols.length === 0) continue;
            const placeholders = cols.map(() => "?").join(", ");
            await db.run(
              `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
              ...cols.map((c) => row[c])
            );
            rows++;
          }
        }
      });
    } finally {
      await db.run("PRAGMA foreign_keys = ON");
    }

    return { restored: true, tables, rows };
  }

  return { exportBackup, restoreBackup };
}

export type SoloBackupService = ReturnType<typeof createSoloBackupService>;
