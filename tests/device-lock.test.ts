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

  it("setPin while locked does NOT clear the lockout (bypass guard)", async () => {
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
    // A locked device must NOT be silently unlocked by changing the PIN —
    // that path is device-lock exempt at the API layer, so setPin must not
    // clear locked_until / failed_attempts.
    await svc.setPin(user.id, "1111");
    const after = await svc.state(user.id);
    expect(after.locked).toBe(true);
    expect(after.retryAfterMs).toBeGreaterThan(0);
    // The lockout still blocks the (old) PIN.
    await expect(svc.unlock(user.id, "9876")).rejects.toMatchObject({ status: 423 });
  });

  it("derivePinHash is deterministic and differs across salts", async () => {
    const a = await derivePinHash("1234", "salt1");
    const b = await derivePinHash("1234", "salt1");
    const c = await derivePinHash("1234", "salt2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
