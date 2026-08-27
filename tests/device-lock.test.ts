import { describe, expect, it } from "vitest";
import { createDeviceLockService, derivePinHash } from "@/server/domain/device-lock";
import { createTestDb, seedUser } from "./helpers";

describe("device lock (P8a)", () => {
  it("setPin stores a PBKDF2 hash, never the raw PIN", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createDeviceLockService(db);
    await svc.setPin(user.id, "1234");
    const row = (await db.get("SELECT pin_hash, pin_salt FROM device_lock WHERE user_id = ?", user.id)) as { pin_hash: string; pin_salt: string } | null;
    expect(row?.pin_hash).toBeTruthy();
    expect(row?.pin_hash).not.toContain("1234");
    expect(row?.pin_hash?.length).toBe(64); // sha256 hex
    expect((await svc.state(user.id)).configured).toBe(true);
  });

  it("rejects non-digit PINs", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createDeviceLockService(db);
    await expect(svc.setPin(user.id, "12a4")).rejects.toThrow();
  });

  it("unlocks with the right PIN, wrong PIN is a 401", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createDeviceLockService(db);
    await svc.setPin(user.id, "4321");
    await expect(svc.unlock(user.id, "0000")).rejects.toMatchObject({ status: 401, code: "wrong_pin" });
    await svc.unlock(user.id, "4321");
    const state = await svc.state(user.id);
    expect(state.locked).toBe(false);
  });

  it("locks after 5 failed attempts with escalating cooldown", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createDeviceLockService(db);
    await svc.setPin(user.id, "9876");
    for (let i = 0; i < 4; i++) {
      await expect(svc.unlock(user.id, "0000")).rejects.toMatchObject({ status: 401 });
    }
    // 5th failure → locked
    await expect(svc.unlock(user.id, "0000")).rejects.toMatchObject({ status: 423 });
    const state = await svc.state(user.id);
    expect(state.locked).toBe(true);
    expect(state.retryAfterMs).toBeGreaterThan(0);
    // even the right PIN is rejected while locked
    await expect(svc.unlock(user.id, "9876")).rejects.toMatchObject({ status: 423 });
    // base cooldown is 30s (a few ms may have elapsed between lock and read)
    expect(state.retryAfterMs!).toBeGreaterThanOrEqual(29_000);
  });

  it("biometric flag toggles", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createDeviceLockService(db);
    await svc.setBiometric(user.id, true);
    expect((await svc.state(user.id)).biometricEnabled).toBe(true);
    await svc.setBiometric(user.id, false);
    expect((await svc.state(user.id)).biometricEnabled).toBe(false);
  });

  it("setPin while locked is REJECTED and cannot swap the PIN (bypass guard)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createDeviceLockService(db);
    await svc.setPin(user.id, "9876");
    // Drive 5 wrong attempts → device locks (423).
    for (let i = 0; i < 4; i++) {
      await expect(svc.unlock(user.id, "0000")).rejects.toMatchObject({ status: 401 });
    }
    await expect(svc.unlock(user.id, "0000")).rejects.toMatchObject({ status: 423 });
    const before = await svc.state(user.id);
    expect(before.locked).toBe(true);
    // The PIN-change route is device-lock exempt at the API layer, so the
    // service itself must refuse to REPLACE the PIN mid-lockout — otherwise
    // an attacker swaps the PIN, waits out the cooldown, and unlocks with
    // their own PIN.
    await expect(svc.setPin(user.id, "1111")).rejects.toMatchObject({ status: 423 });
    const after = await svc.state(user.id);
    expect(after.locked).toBe(true);
    expect(after.retryAfterMs).toBeGreaterThan(0);
    // PIN was NOT replaced: once the lockout expires, the ORIGINAL PIN still
    // unlocks (attacker's PIN never got installed).
    await db.run("UPDATE device_lock SET locked_until = NULL, failed_attempts = 0 WHERE user_id = ?", user.id);
    await svc.unlock(user.id, "9876");
    await expect(svc.unlock(user.id, "1111")).rejects.toMatchObject({ status: 401 });
  });

  it("recovery (force) can still reset the PIN mid-lockout", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createDeviceLockService(db);
    await svc.setPin(user.id, "9876");
    for (let i = 0; i < 5; i++) {
      await expect(svc.unlock(user.id, "0000")).rejects.toMatchObject({});
    }
    expect((await svc.state(user.id)).locked).toBe(true);
    // force=true is reserved for the verified-recovery path (resetPin).
    await svc.setPin(user.id, "5555", true);
    await db.run("UPDATE device_lock SET locked_until = NULL, failed_attempts = 0 WHERE user_id = ?", user.id);
    await svc.unlock(user.id, "5555");
  });

  it("setBiometric while locked is REJECTED (biometric-unlock bypass guard)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createDeviceLockService(db);
    await svc.setPin(user.id, "9876");
    // Drive 5 wrong attempts → device locks (423).
    for (let i = 0; i < 4; i++) {
      await expect(svc.unlock(user.id, "0000")).rejects.toMatchObject({ status: 401 });
    }
    await expect(svc.unlock(user.id, "0000")).rejects.toMatchObject({ status: 423 });
    expect((await svc.state(user.id)).locked).toBe(true);
    // The biometric enable/disable routes are device-lock exempt at the API
    // layer, so the service itself must refuse to ENABLE biometrics
    // mid-lockout — otherwise an attacker enables biometrics and calls the
    // exempt biometric-unlock endpoint to clear the lockout instantly.
    await expect(svc.setBiometric(user.id, true)).rejects.toMatchObject({ status: 423 });
    const after = await svc.state(user.id);
    expect(after.locked).toBe(true);
    expect(after.biometricEnabled).toBe(false);
    // And the unlock endpoint still refuses (biometrics never got enabled).
    await expect(svc.unlockWithBiometric(user.id)).rejects.toMatchObject({ status: 400 });
    // After the lockout clears, toggling works again.
    await db.run("UPDATE device_lock SET locked_until = NULL, failed_attempts = 0 WHERE user_id = ?", user.id);
    await svc.unlock(user.id, "9876");
    await svc.setBiometric(user.id, true);
    expect((await svc.state(user.id)).biometricEnabled).toBe(true);
  });

  it("derivePinHash is deterministic and differs across salts", async () => {
    const a = await derivePinHash("1234", "salt1");
    const b = await derivePinHash("1234", "salt1");
    const c = await derivePinHash("1234", "salt2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
