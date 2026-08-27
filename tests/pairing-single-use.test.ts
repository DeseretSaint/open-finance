import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb, getSqliteDb } from "@/server/db/adapter";
import { createAuthService, pairingLimiter } from "@/server/auth/service";
import { hashSecret } from "@/lib/crypto";
import { POST as pairingAcceptPost } from "@/app/api/pairing/accept/route";

/**
 * Pairing codes are documented single-use (src/lib/pairing.ts). The accept
 * route used to SELECT the row, check used=0, then UPDATE used=1 in separate
 * statements with awaits in between — two concurrent requests with the same
 * code could both pass the check and each mint a session. The fix claims the
 * code with a conditional UPDATE (used=0 AND not-expired) and requires
 * changes===1; this test drives the REAL route handler concurrently to lock
 * the guarantee in.
 */

const BASE = "http://localhost:3000";

function jsonReq(url: string, body: unknown, headers: Record<string, string>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function migrationFiles(): string[] {
  const dir = path.join(process.cwd(), "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
}

beforeAll(() => {
  const db = getSqliteDb();
  for (const sql of migrationFiles()) db.exec(sql);
});

afterAll(() => {
  getSqliteDb().close();
});

beforeEach(() => {
  pairingLimiter.reset();
});

async function seedCode(username: string, code: string): Promise<void> {
  await createAuthService(getDb()).register({
    username,
    display_name: username,
    password: `${username}-strong-pass`,
  });
  const user = await getDb().get<{ id: string }>("SELECT id FROM users WHERE username = ?", username);
  await getDb().run(
    "INSERT INTO pairing_codes (code_hash, user_id, expires_at, used) VALUES (?, ?, ?, 0)",
    hashSecret(code),
    user!.id,
    new Date(Date.now() + 5 * 60_000).toISOString()
  );
}

describe("pairing code single-use (atomic claim)", () => {
  it("concurrent accepts of the same code mint exactly ONE session", async () => {
    await seedCode("pair-race", "ofp_racecode01");
    const url = `${BASE}/api/pairing/accept`;
    const body = { code: "ofp_racecode01", deviceLabel: "race phone" };
    // Distinct IPs so the per-IP limiter never interferes with the race.
    const reqs = Array.from({ length: 8 }, (_, i) =>
      pairingAcceptPost(jsonReq(url, body, { "x-of-request": "1", "x-forwarded-for": `10.20.0.${i + 1}` }))
    );
    const results = await Promise.all(reqs);
    const statuses = results.map((r) => r.status);
    const wins = statuses.filter((s) => s === 200).length;
    expect(wins).toBe(1);
    expect(statuses.filter((s) => s === 400).length).toBe(7);
    const loser = await results.find((r) => r.status === 400)!.json();
    expect((loser as { error: { message: string } }).error.message).toMatch(/already been used/);

    const user = await getDb().get<{ id: string }>("SELECT id FROM users WHERE username = ?", "pair-race");
    const sessions = await getDb().all<{ id: string }>(
      "SELECT id FROM sessions WHERE user_id = ? AND device_label = ?",
      user!.id,
      "race phone"
    );
    expect(sessions.length).toBe(1);
  }, 15_000);

  it("a second sequential accept after a successful one is rejected", async () => {
    await seedCode("pair-seq", "ofp_seqcode001");
    const url = `${BASE}/api/pairing/accept`;
    const body = { code: "ofp_seqcode001" };
    const first = await pairingAcceptPost(jsonReq(url, body, { "x-of-request": "1", "x-forwarded-for": "10.21.0.1" }));
    expect(first.status).toBe(200);
    const second = await pairingAcceptPost(jsonReq(url, body, { "x-of-request": "1", "x-forwarded-for": "10.21.0.2" }));
    expect(second.status).toBe(400);
    expect(((await second.json()) as { error: { message: string } }).error.message).toMatch(/already been used/);
  });
});
