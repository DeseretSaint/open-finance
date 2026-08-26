import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import type { Db } from "@/server/db/types";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";
import { soloDispatch, setSoloDbForTest } from "@/lib/solo-router";
import { hashSecret } from "@/lib/crypto";

/**
 * Remote access (P8b "share-to-agent"): the phone serves its API over
 * Tailscale (native RemoteServerPlugin → soloDispatch). Requests must present
 * the device's bearer token. The token is hashed at rest (SHA-256) and GET
 * /api/agent/remote must NOT return it. In-app calls (no `headers`) are gated
 * by the device lock at the API layer; remote calls (with `headers`) are
 * authorized by the token alone. These tests verify that contract.
 */

let db: Db;

beforeEach(() => {
  db = createTestDb();
  setSoloDbForTest(db);
});

async function seedUser(db: Db): Promise<string> {
  return createSoloBootstrapService(db).bootstrap({ displayName: "Phone" }).then((r) => r.user.id);
}

async function enableRemote(db: Db, rawToken: string) {
  await db.run(
    "INSERT INTO app_state (key, value, updated_at) VALUES ('remote.agent.token', ?, ?)",
    hashSecret(rawToken),
    new Date().toISOString()
  );
}

describe("solo remote access", () => {
  it("stores the token hashed; GET /api/agent/remote never returns it (C1)", async () => {
    await seedUser(db);
    const raw = "t_" + "abc123".repeat(8);
    await enableRemote(db, raw);

    const stored = await db.get<{ value: string }>("SELECT value FROM app_state WHERE key = 'remote.agent.token'");
    expect(stored?.value).toBe(hashSecret(raw)); // hashed at rest
    expect(stored?.value).not.toBe(raw);

    const res = await soloDispatch({ method: "GET", path: "/api/agent/remote", query: new URLSearchParams(), body: undefined, headers: {} });
    expect(res.status).toBe(200);
    const data = res.data as { enabled: boolean; token?: string };
    expect(data.enabled).toBe(true);
    expect(data.token).toBeUndefined(); // never leaked
  });

  it("remote request without a valid Bearer is rejected", async () => {
    await seedUser(db);
    const raw = "t_" + "abc123".repeat(8);
    await enableRemote(db, raw);

    // No authorization header but a headers object (remote-style call) → 401.
    const noAuth = await soloDispatch({ method: "GET", path: "/api/accounts", query: new URLSearchParams(), body: undefined, headers: {} });
    expect(noAuth.status).toBe(401);

    const badAuth = await soloDispatch({ method: "GET", path: "/api/accounts", query: new URLSearchParams(), body: undefined, headers: { authorization: "Bearer wrong" } });
    expect(badAuth.status).toBe(401);
  });

  it("remote request with valid Bearer reaches data (token-only auth)", async () => {
    const userId = await seedUser(db);
    const accounts = await import("@/server/domain/accounts");
    const accSvc = accounts.createAccountsService(db);
    await accSvc.createManual(userId, { name: "Checking", type: "depository", currentBalanceCents: 500_000 });
    const raw = "t_" + "abc123".repeat(8);
    await enableRemote(db, raw);

    const res = await soloDispatch({
      method: "GET",
      path: "/api/accounts",
      query: new URLSearchParams(),
      body: undefined,
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(res.status).toBe(200);
    const data = res.data as { accounts: unknown[] };
    expect(data.accounts).toHaveLength(1);
  });

  it("legacy plaintext token still authenticates and is migrated to hash", async () => {
    await seedUser(db);
    const raw = "t_" + "abc123".repeat(8);
    // Legacy: raw token stored in plaintext.
    await db.run("INSERT INTO app_state (key, value, updated_at) VALUES ('remote.agent.token', ?, ?)", raw, new Date().toISOString());

    const res = await soloDispatch({
      method: "GET",
      path: "/api/accounts",
      query: new URLSearchParams(),
      body: undefined,
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(res.status).toBe(200);

    const stored = await db.get<{ value: string }>("SELECT value FROM app_state WHERE key = 'remote.agent.token'");
    expect(stored?.value).toBe(hashSecret(raw)); // migrated to hash
  });

  it("remote bearer still works while the device is locked (FGS serves agent when phone locked)", async () => {
    const userId = await seedUser(db);
    const lock = await import("@/server/domain/device-lock");
    await lock.createDeviceLockService(db).setPin(userId, "1234");
    // Lock the device (locked_until far in the future).
    await db.run("UPDATE device_lock SET locked_until = ? WHERE user_id = ?", "2999-01-01T00:00:00.000Z", userId);
    const raw = "t_" + "abc123".repeat(8);
    await enableRemote(db, raw);

    const res = await soloDispatch({
      method: "GET",
      path: "/api/accounts",
      query: new URLSearchParams(),
      body: undefined,
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(res.status).toBe(200); // not 423 — remote token authorizes the agent even when locked
  });

  it("in-app GET /api/agent/remote reads status without a token and never leaks it", async () => {
    await seedUser(db);
    const raw = "t_" + "abc123".repeat(8);
    await enableRemote(db, raw);

    // In-app call (no headers) — should succeed and return no token.
    const res = await soloDispatch({ method: "GET", path: "/api/agent/remote", query: new URLSearchParams(), body: undefined });
    expect(res.status).toBe(200);
    const data = res.data as { enabled: boolean; token?: string; port?: number };
    expect(data.enabled).toBe(true);
    expect(data.token).toBeUndefined();
    expect(data.port).toBe(8787);
  });

  it("disables remote access by deleting the token", async () => {
    await seedUser(db);
    await db.run("INSERT INTO app_state (key, value, updated_at) VALUES ('remote.agent.token', ?, ?)", hashSecret("tok"), new Date().toISOString());
    await db.run("DELETE FROM app_state WHERE key = 'remote.agent.token'");
    const row = await db.get<{ value: string }>("SELECT value FROM app_state WHERE key = 'remote.agent.token'");
    expect(row).toBeUndefined();
  });
});
