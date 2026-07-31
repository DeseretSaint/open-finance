import { describe, expect, it } from "vitest";
import {
  createUpdatesService,
  isNewerVersion,
  upcomingThreeAm,
} from "@/server/domain/updates";
import { createTestDb, seedUser } from "./helpers";

describe("updates — semver compare", () => {
  it("compares major/minor/patch correctly", () => {
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.1.0", "1.0.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(false);
    expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
  });

  it("handles v-prefixes and pre-release tails", () => {
    expect(isNewerVersion("v1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("1.2.0-beta.1", "1.2.0-alpha.2")).toBe(true);
  });
});

describe("updates — decision lifecycle", () => {
  it("dismiss stops the banner, remind re-enables it", async () => {
    const db = createTestDb();
    await seedUser(db);
    const svc = createUpdatesService(db);

    // simulate a check that found a newer version
    await db.run(
      "INSERT INTO app_state (key, value, updated_at) VALUES ('update.latest_version', '9.9.9', ?)",
      new Date().toISOString()
    );
    expect((await svc.status()).updateAvailable).toBe(true);

    await svc.dismiss();
    expect((await svc.status()).updateAvailable).toBe(false);
    expect((await svc.status()).dismissed).toBe("9.9.9");

    await svc.remind();
    expect((await svc.status()).updateAvailable).toBe(true);
  });

  it("schedule stores a timestamp; apply rejects without a script", async () => {
    const db = createTestDb();
    await seedUser(db);
    const svc = createUpdatesService(db);
    await db.run(
      "INSERT INTO app_state (key, value, updated_at) VALUES ('update.latest_version', '9.9.9', ?)",
      new Date().toISOString()
    );

    const when = new Date(Date.now() + 3_600_000);
    await svc.schedule(when);
    expect((await svc.status()).scheduledAt).toBe(when.toISOString());

    // Point UPDATE_SCRIPT at a nonexistent path: apply must reject without
    // spawning anything and without leaving running=1 stuck.
    const prev = process.env.UPDATE_SCRIPT;
    process.env.UPDATE_SCRIPT = "/nonexistent/update.sh";
    try {
      await expect(svc.apply()).rejects.toThrow();
    } finally {
      if (prev === undefined) delete process.env.UPDATE_SCRIPT;
      else process.env.UPDATE_SCRIPT = prev;
    }
    expect((await svc.status()).running).toBe(false);
  });

  it("rejects scheduling without a known update", async () => {
    const db = createTestDb();
    await seedUser(db);
    const svc = createUpdatesService(db);
    await expect(svc.schedule(new Date())).rejects.toThrow();
    await expect(svc.dismiss()).rejects.toThrow();
  });
});

describe("updates — upcoming 3am", () => {
  it("returns today 3am when it's still ahead, else tomorrow 3am", () => {
    const morning = new Date("2026-07-31T01:00:00");
    const d1 = upcomingThreeAm(morning);
    expect(d1.getHours()).toBe(3);
    expect(d1.getDate()).toBe(31);

    const evening = new Date("2026-07-31T17:00:00");
    const d2 = upcomingThreeAm(evening);
    expect(d2.getHours()).toBe(3);
    expect(d2.getDate()).toBe(1); // rolls to Aug 1
  });
});
