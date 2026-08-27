import { describe, expect, it } from "vitest";
import { createTestDb, seedUser, seedManualAccount } from "./helpers";
import { createSoloBackupService } from "@/server/domain/solo-backup";
import { createDeviceLockService } from "@/server/domain/device-lock";
import { randomUUID } from "node:crypto";
import { aesGcmEncrypt, randomBytes } from "@/lib/webcrypto-shim";

// Mirror of solo-backup's private deriveKey so the test can encrypt a tampered dump.
async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" }, material, 256);
  return new Uint8Array(bits);
}

async function seedDeviceUser(db: ReturnType<typeof createTestDb>, pin = "1234") {
  const user = await seedUser(db, "device-tester");
  const lock = createDeviceLockService(db);
  await lock.setPin(user.id, pin);
  return user;
}

describe("solo backup & restore (D1)", () => {
  it("exports an encrypted dump and restores it into a wiped database", async () => {
    const db = createTestDb();
    const user = await seedDeviceUser(db);
    const accountId = await seedManualAccount(db, user.id, "Everyday Checking");
    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO categories (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
      randomUUID(),
      user.id,
      "Groceries",
      now
    );

    const svc = createSoloBackupService(db);
    const backup = await svc.exportBackup(user.id, "1234");
    expect(backup.filename).toMatch(/open-finance-phone-\d{4}-\d{2}-\d{2}\.ofbak\.json/);
    const envelope = JSON.parse(backup.contents);
    expect(envelope.magic).toBe("OFBAK-SOLO1");
    // The PIN never appears in the envelope.
    expect(backup.contents).not.toContain("1234");
    expect(backup.contents).not.toContain("Everyday Checking"); // encrypted

    // Wipe the data (simulate a fresh phone / data loss).
    await db.run("DELETE FROM transactions");
    await db.run("DELETE FROM accounts");
    await db.run("DELETE FROM categories");

    const result = await svc.restoreBackup(user.id, "1234", backup.contents);
    expect(result.restored).toBe(true);
    expect(result.rows).toBeGreaterThan(0);

    const accounts = await db.all<{ name: string }>("SELECT name FROM accounts WHERE user_id = ?", user.id);
    expect(accounts.map((a) => a.name)).toContain("Everyday Checking");
    const cats = await db.all<{ name: string }>("SELECT name FROM categories WHERE user_id = ?", user.id);
    expect(cats.map((c) => c.name)).toContain("Groceries");
    void accountId;
  });

  it("rejects export with a wrong PIN", async () => {
    const db = createTestDb();
    const user = await seedDeviceUser(db);
    const svc = createSoloBackupService(db);
    await expect(svc.exportBackup(user.id, "9999")).rejects.toThrow(/PIN/i);
  });

  it("rejects restore with the wrong PIN (GCM auth failure → clean 400)", async () => {
    const db = createTestDb();
    const user = await seedDeviceUser(db, "1234");
    await seedManualAccount(db, user.id, "Savings");
    const svc = createSoloBackupService(db);
    const backup = await svc.exportBackup(user.id, "1234");

    // Change the device PIN — the old backup must no longer open.
    await createDeviceLockService(db).setPin(user.id, "5678");
    await expect(svc.restoreBackup(user.id, "5678", backup.contents)).rejects.toThrow(/decrypt|PIN/i);
    // …and the original data is untouched (restore never ran).
    const accounts = await db.all("SELECT * FROM accounts WHERE user_id = ?", user.id);
    expect(accounts.length).toBe(1);
  });

  it("rejects a file that isn't a backup", async () => {
    const db = createTestDb();
    const user = await seedDeviceUser(db);
    const svc = createSoloBackupService(db);
    await expect(svc.restoreBackup(user.id, "1234", "{\"hello\":\"world\"}")).rejects.toThrow(/backup/i);
    await expect(svc.restoreBackup(user.id, "1234", "not json at all")).rejects.toThrow(/backup/i);
  });

  it("restore is all-or-nothing — a corrupt dump leaves existing data intact", async () => {
    const db = createTestDb();
    const user = await seedDeviceUser(db);
    await seedManualAccount(db, user.id, "Keep Me");
    const svc = createSoloBackupService(db);
    const backup = await svc.exportBackup(user.id, "1234");

    // Corrupt the ciphertext (flip a char in the middle of the payload).
    const env = JSON.parse(backup.contents);
    const mid = Math.floor(env.tables.length / 2);
    env.tables = env.tables.slice(0, mid) + (env.tables[mid] === "A" ? "B" : "A") + env.tables.slice(mid + 1);
    await expect(svc.restoreBackup(user.id, "1234", JSON.stringify(env))).rejects.toThrow();

    const accounts = await db.all<{ name: string }>("SELECT name FROM accounts WHERE user_id = ?", user.id);
    expect(accounts.map((a) => a.name)).toContain("Keep Me");
  });

  it("rejects a backup whose rows carry a non-identifier column (SQL-injection guard)", async () => {
    const db = createTestDb();
    const user = await seedDeviceUser(db, "1234");
    await seedManualAccount(db, user.id, "Keep Me");
    const svc = createSoloBackupService(db);

    // Build a structurally-valid envelope whose decrypted dump has an injected,
    // non-identifier column name. The restore path must refuse it before any
    // unvalidated identifier reaches the SQL interpolator.
    const salt = randomBytes(16);
    const key = await deriveKey("1234", salt, 150_000);
    const dump = {
      users: [],
      accounts: [
        { id: randomUUID(), user_id: user.id, name: "x", 'evil"; DELETE FROM users; --': 1 },
      ],
    };
    const tables = await aesGcmEncrypt(JSON.stringify(dump), key, "open-finance:solo-backup:v1");
    const envelope = {
      magic: "OFBAK-SOLO1",
      version: 1,
      createdAt: new Date().toISOString(),
      kdf: { salt: Buffer.from(salt).toString("base64"), iterations: 150_000 },
      tables,
    };

    await expect(svc.restoreBackup(user.id, "1234", JSON.stringify(envelope))).rejects.toThrow(/unrecognized column/i);
    // Existing data is untouched (the whole restore transaction rolls back).
    const accounts = await db.all<{ name: string }>("SELECT name FROM accounts WHERE user_id = ?", user.id);
    expect(accounts.map((a) => a.name)).toContain("Keep Me");
  });
});
