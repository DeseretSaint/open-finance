import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";

describe("solo bootstrap (P8b)", () => {
  it("bootstraps a device user with a recovery code and no password", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);

    expect(await solo.isBootstrapped()).toBe(false);

    const { user, recoveryCode, hasPin } = await solo.bootstrap({ displayName: "My Phone" });

    expect(user.username).toMatch(/^device-/);
    expect(user.display_name).toBe("My Phone");
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){9}$/);
    expect(hasPin).toBe(false);
    expect(await solo.isBootstrapped()).toBe(true);

    // recovery code is stored only as a hash — never plaintext
    const row = await db.get<{ recovery_code_hash: string | null; password_hash: string | null }>(
      "SELECT recovery_code_hash, password_hash FROM users WHERE id = ?",
      user.id
    );
    expect(row?.recovery_code_hash).toBeTruthy();
    expect(row?.recovery_code_hash).not.toContain(recoveryCode);
    expect(row?.password_hash).toBeNull(); // device user never logs in over HTTP
  });

  it("rejects a second bootstrap on the same device", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    await solo.bootstrap({});
    await expect(solo.bootstrap({})).rejects.toThrow(/already set up/i);
  });

  it("verifies recovery codes case-insensitively and rejects wrong ones", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    const { recoveryCode } = await solo.bootstrap({});

    expect(await solo.verifyRecoveryCode(recoveryCode)).toBe(true);
    expect(await solo.verifyRecoveryCode(recoveryCode.toLowerCase())).toBe(true);
    expect(await solo.verifyRecoveryCode("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA")).toBe(false);
  });

  it("sets a PIN via device_lock and unlocks with it", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    await solo.bootstrap({ pin: "1234" });

    expect(await solo.hasPin()).toBe(true);
    await solo.unlock("1234"); // no throw

    await expect(solo.unlock("0000")).rejects.toThrow(/pin/i);
  });

  it("resets the PIN with a verified recovery code", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    const { recoveryCode } = await solo.bootstrap({ pin: "1111" });

    await solo.resetPin(recoveryCode, "9999");
    await solo.unlock("9999"); // new PIN works
    await expect(solo.unlock("1111")).rejects.toThrow(/pin/i);
  });

  it("has no device user before bootstrap", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    expect(await solo.getDeviceUser()).toBeNull();
    expect(await solo.hasPin()).toBe(false);
  });
});
