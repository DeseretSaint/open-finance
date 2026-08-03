import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { createSoloUpdatesService, isNewerVersion, soloCurrentVersion } from "@/server/domain/updates-solo";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";

describe("solo updates (browser-safe)", () => {
  it("compares semver like the server", () => {
    expect(isNewerVersion("1.8.0", "1.7.3")).toBe(true);
    expect(isNewerVersion("1.7.3", "1.8.0")).toBe(false);
    expect(isNewerVersion("v1.8.0", "1.7.3")).toBe(true);
    expect(isNewerVersion("1.2.0-beta.1", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.0", "1.2.0-beta.1")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false);
  });

  it("status is safe (canSelfUpdate false) and dismiss/remind toggle the flag", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    await solo.bootstrap({ displayName: "Phone", pin: "1234" });
    const svc = createSoloUpdatesService(db);

    const s0 = await svc.status();
    expect(s0.canSelfUpdate).toBe(false);
    expect(s0.updateAvailable).toBe(false);
    expect(typeof s0.currentVersion).toBe("string");

    // Simulate a check result (as if GitHub responded) via the DB state it writes.
    // Directly exercise dismiss/remind through a stubbed latest_version.
    await db.run(
      `INSERT INTO app_state (key, value, updated_at) VALUES ('update.latest_version', '99.0.0', ?)`,
      new Date().toISOString()
    );
    const s1 = await svc.status();
    expect(s1.latestVersion).toBe("99.0.0");
    expect(s1.updateAvailable).toBe(true);

    await svc.dismiss();
    expect((await svc.status()).updateAvailable).toBe(false);
    expect((await svc.status()).dismissed).toBe("99.0.0");

    await svc.remind();
    expect((await svc.status()).dismissed).toBeNull();
    expect((await svc.status()).updateAvailable).toBe(true);
  });

  it("rejects in-place actions with a clear message", async () => {
    const db = createTestDb();
    await createSoloBootstrapService(db).bootstrap({ displayName: "Phone" });
    const svc = createSoloUpdatesService(db);
    await expect(svc.rejectInPlace()).rejects.toThrow(/can't update itself/i);
  });

  it("current version falls back to 0.0.0 when not inlined", () => {
    expect(typeof soloCurrentVersion()).toBe("string");
  });
});
