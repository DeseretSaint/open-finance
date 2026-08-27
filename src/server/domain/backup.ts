import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { apiErrors } from "@/lib/api";
import { verifyPassword } from "@/server/auth/password";
import { getDb, type Db } from "@/server/db/adapter";

/**
 * Backup & restore.
 *
 * Backup = the SQLite file, encrypted at rest with AES-256-GCM under the same
 * ENCRYPTION_KEY the install uses (so a backup is useless without the key that
 * produced it — document: restore requires the same ENCRYPTION_KEY).
 *
 * Restore = password-confirmed (agent tokens can never restore), replaces the
 * DB after an explicit confirm; a pre-restore auto-backup is written first so a
 * bad restore is never data loss. Wrong key → GCM auth failure → clean 400.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const AAD = "open-finance:backup:v1";

/**
 * Hard cap on an uploaded .ofbak envelope (512 MB). A personal-finance SQLite
 * DB is at most tens of MB; the cap exists so a hostile or misconfigured
 * upload cannot exhaust server memory — restore buffers the whole file into
 * RAM (arrayBuffer → Buffer) before decrypting.
 */
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

/**
 * Reject oversized backup uploads BEFORE buffering/decrypting. Pass the
 * declared Content-Length header (may be null/absent) and/or the parsed file
 * size; either exceeding MAX_BACKUP_BYTES throws 413. A non-numeric
 * Content-Length is ignored here (the size check after parsing still applies).
 */
export function assertBackupSize(declaredContentLength: string | null, fileSize: number | null): void {
  const declared = declaredContentLength === null ? NaN : Number(declaredContentLength);
  if (
    (Number.isFinite(declared) && declared > MAX_BACKUP_BYTES) ||
    (fileSize !== null && fileSize > MAX_BACKUP_BYTES)
  ) {
    throw apiErrors.payloadTooLarge("Backup file is too large (limit 512 MB).");
  }
}

function key(): Buffer {
  return createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

/** Encrypt the whole SQLite file into a portable .ofbak envelope. */
export function encryptBackup(dbPath: string): Buffer {
  const plaintext = fs.readFileSync(dbPath);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  cipher.setAAD(Buffer.from(AAD, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("OFBAK1", "utf8"), iv, tag, ct]);
}

/** Decrypt a backup envelope; throws (→ 400) on wrong key / tamper. */
export function decryptBackup(envelope: Buffer): Buffer {
  const magic = Buffer.from("OFBAK1", "utf8");
  if (envelope.length < magic.length + IV_LEN + TAG_LEN + 1 || !envelope.subarray(0, magic.length).equals(magic)) {
    throw apiErrors.badRequest("Not a valid Open Finance backup file.");
  }
  const iv = envelope.subarray(magic.length, magic.length + IV_LEN);
  const tag = envelope.subarray(magic.length + IV_LEN, magic.length + IV_LEN + TAG_LEN);
  const ct = envelope.subarray(magic.length + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAAD(Buffer.from(AAD, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw apiErrors.badRequest(
      "This backup cannot be decrypted with this install's ENCRYPTION_KEY. Restore it on the machine that created it (or with the same key)."
    );
  }
}

export interface RestoreResult {
  restored: true;
  preRestoreBackupPath: string | null;
}

export function createBackupService(db: Db = getDb(), dbPathOverride?: string) {
  const dbPath = () => dbPathOverride ?? env.DATABASE_PATH;

  /** Raw backup envelope bytes (download as application/octet-stream). */
  async function exportBackup(): Promise<Buffer> {
    const p = dbPath();
    if (!fs.existsSync(p)) throw apiErrors.notFound("Database file");
    // Flush WAL so the backup file is a consistent snapshot.
    await db.run("PRAGMA wal_checkpoint(FULL)");
    return encryptBackup(p);
  }

  /**
   * Replace the live DB with a decrypted backup. `confirmPassword` is required
   * (recovery-code reset is handled by the auth flow; here we need the password).
   */
  async function restoreBackup(
    userId: string,
    envelope: Buffer,
    confirmPassword: string
  ): Promise<RestoreResult> {
    const user = await db.get<{ id: string; password_hash: string | null }>(
      "SELECT id, password_hash FROM users WHERE id = ?",
      userId
    );
    if (!user?.password_hash || !(await verifyPassword(confirmPassword, user.password_hash))) {
      throw apiErrors.forbidden("Password confirmation failed. Restore aborted.");
    }

    const plaintext = decryptBackup(envelope); // throws 400 on wrong key
    if (!plaintext.subarray(0, 16).equals(Buffer.from("SQLite format 3\u0000"))) {
      throw apiErrors.badRequest("Decrypted backup is not a valid SQLite database.");
    }

    const p = dbPath();
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });

    // Pre-restore auto-backup (raw file copy — same install, same key).
    let preRestoreBackupPath: string | null = null;
    if (fs.existsSync(p)) {
      preRestoreBackupPath = path.join(dir, `pre-restore-${Date.now()}.db`);
      fs.copyFileSync(p, preRestoreBackupPath);
    }

    // Swap the file: close any live handles → write → migrate via a temp connection → reopen.
    const { resetDb } = await import("@/server/db/adapter");
    // Close the passed handle too if it's a real SqliteDb (production: same as singleton).
    const maybeSqlite = db as unknown as { close?: () => void };
    if (typeof maybeSqlite.close === "function") {
      try {
        maybeSqlite.close();
      } catch {
        // already closed
      }
    }
    resetDb();
    fs.writeFileSync(p, plaintext);
    // Bring any older backup schema up to date (idempotent; no-op when current).
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3") as new (p: string) => {
      pragma(s: string): void;
      exec(s: string): void;
      close(): void;
    };
    const { runMigrations } = require("../../../migrations/up.js") as {
      runMigrations: (db: { pragma(s: string): void; exec(s: string): void }, dir?: string) => unknown;
    };
    const temp = new Database(p);
    try {
      runMigrations(temp as Parameters<typeof runMigrations>[0]);
    } finally {
      temp.close();
    }
    getDb(); // reopen singleton

    return { restored: true, preRestoreBackupPath };
  }

  return { exportBackup, restoreBackup };
}

export type BackupService = ReturnType<typeof createBackupService>;
