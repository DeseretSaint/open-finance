import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getSqliteDb } from "@/server/db/adapter";
import { registerLimiter, sensitiveLimiter } from "@/server/auth/service";
import { POST as onboardingPost } from "@/app/api/onboarding/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as updatesPost } from "@/app/api/updates/route";
import { DELETE as sessionDelete } from "@/app/api/auth/sessions/[id]/route";

/**
 * CSRF coverage regression (practice-not-theory): these three session-cookie
 * mutating routes were the last write handlers without `requireCsrf`. A
 * cross-site request from a logged-in user must be rejected with 403 before
 * any state change. The legit client always sends `x-of-request: 1`, so this
 * never affects real traffic.
 */

const BASE = "http://localhost:3000";

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}, method: "POST" | "DELETE" = "POST"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "POST" ? JSON.stringify(body) : undefined,
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
  // getSqliteDb() returns the SAME singleton the route handlers use via getDb().
  const db = getSqliteDb();
  for (const sql of migrationFiles()) db.exec(sql);
});

beforeEach(() => {
  registerLimiter.reset();
  sensitiveLimiter.reset();
});

async function sessionCookie(): Promise<string> {
  const uname = `csrf-r-${Math.random().toString(36).slice(2, 9)}`;
  const r = await registerPost(
    jsonReq(`${BASE}/api/auth/register`, { username: uname, display_name: "x", password: "csrf-r-strong-pass" }, { "x-forwarded-for": "10.9.99.1" })
  );
  expect(r.status).toBe(201);
  const m = (r.headers.get("set-cookie") ?? "").match(/of_session=([^;]+)/);
  return `of_session=${m![1]}`;
}

describe("CSRF guard on session-cookie mutating routes", () => {
  it("onboarding POST: 403 without x-of-request, passes with it", async () => {
    const cookie = await sessionCookie();
    expect((await onboardingPost(jsonReq(`${BASE}/api/onboarding`, { action: "complete" }, { cookie }))).status).toBe(403);
    expect((await onboardingPost(jsonReq(`${BASE}/api/onboarding`, { action: "complete" }, { cookie, "x-of-request": "1" }))).status).toBe(200);
  });

  it("updates POST: 403 without x-of-request", async () => {
    const cookie = await sessionCookie();
    expect((await updatesPost(jsonReq(`${BASE}/api/updates`, {}, { cookie }))).status).toBe(403);
    // positive path is network-dependent (releases fetch) — covered by gate smoke.
  });

  it("auth/sessions DELETE: 403 without x-of-request, not 403 with it", async () => {
    const cookie = await sessionCookie();
    expect(
      (await sessionDelete(jsonReq(`${BASE}/api/auth/sessions/bogus`, {}, { cookie }), { params: Promise.resolve({ id: "bogus" }) } as never)).status
    ).toBe(403);
    const withCsrf = await sessionDelete(
      jsonReq(`${BASE}/api/auth/sessions/bogus`, {}, { cookie, "x-of-request": "1" }),
      { params: Promise.resolve({ id: "bogus" }) } as never
    );
    expect(withCsrf.status).not.toBe(403); // 400/404 — CSRF passed, id resolution runs
  });
});
