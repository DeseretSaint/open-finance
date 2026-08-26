import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDb, getSqliteDb } from "@/server/db/adapter";
import {
  bootstrapLimiter,
  createAuthService,
  demoLimiter,
  loginLimiter,
  pairingLimiter,
  registerLimiter,
  sensitiveLimiter,
} from "@/server/auth/service";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as recoveryPost } from "@/app/api/auth/recovery/route";
import { POST as pairingAcceptPost } from "@/app/api/pairing/accept/route";
import { POST as bootstrapPost } from "@/app/api/phone-import/bootstrap/route";
import { PATCH as passwordPatch } from "@/app/api/auth/password/route";
import { GET as detectGet } from "@/app/api/agents/detect/route";

/**
 * Rate-limit coverage on the REAL route handlers (practice-not-theory):
 * every unauthenticated session/account-creation endpoint and the sensitive
 * authenticated mutations must return the standard 429 envelope after their
 * budget is exhausted. Audit 2026-08-26 found pairing/accept,
 * phone-import/bootstrap and auth/demo had NO limiter — those are added and
 * locked down here.
 */

const BASE = "http://localhost:3000";

function jsonReq(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  method: "POST" | "PATCH" | "GET" = "POST"
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
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
  // Point the adapter singleton (what routes use via getDb()) at a fully
  // migrated in-memory DB.
  const db = getSqliteDb();
  for (const sql of migrationFiles()) db.exec(sql);
});

afterAll(() => {
  getSqliteDb().close();
});

beforeEach(() => {
  loginLimiter.reset();
  registerLimiter.reset();
  sensitiveLimiter.reset();
  pairingLimiter.reset();
  bootstrapLimiter.reset();
  demoLimiter.reset();
});

async function registerViaRoute(username: string, password: string, ip: string): Promise<string> {
  const res = await registerPost(
    jsonReq(`${BASE}/api/auth/register`, { username, display_name: username, password }, { "x-forwarded-for": ip })
  );
  expect(res.status).toBe(201);
  const m = (res.headers.get("set-cookie") ?? "").match(/of_session=([^;]+)/);
  expect(m).toBeTruthy();
  return `of_session=${m![1]}`;
}

async function expectRateLimited(res: Response): Promise<void> {
  expect(res.status).toBe(429);
  const body = (await res.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("rate_limited");
  expect(body.error.message).toMatch(/retry in \d+s/);
}

describe("rate limiting on auth routes (429 behavior)", () => {
  it("login: 429 after 5 attempts per ip+username — even correct credentials blocked while limited", async () => {
    await createAuthService(getDb()).register({
      username: "rl-login",
      display_name: "RL Login",
      password: "rl-login-strong-pass",
    });
    const attempt = (ip: string, password: string) =>
      loginPost(jsonReq(`${BASE}/api/auth/login`, { username: "rl-login", password }, { "x-forwarded-for": ip }));

    for (let i = 0; i < 5; i++) {
      const res = await attempt("10.9.0.1", "wrong-pass");
      expect(res.status).toBe(400); // real auth failure, limiter counting
    }
    await expectRateLimited(await attempt("10.9.0.1", "rl-login-strong-pass"));
    // Key isolation: same user from a different IP is unaffected.
    expect((await attempt("10.9.0.2", "wrong-pass")).status).toBe(400);
  }, 15_000);

  it("register: 429 after 5 attempts per IP (malformed requests count too)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await registerPost(jsonReq(`${BASE}/api/auth/register`, {}, { "x-forwarded-for": "10.9.1.1" }));
      expect(res.status).toBe(400); // zod rejection, limiter still counted
    }
    await expectRateLimited(
      await registerPost(
        jsonReq(
          `${BASE}/api/auth/register`,
          { username: "rl-reg", display_name: "x", password: "rl-reg-strong-pass" },
          { "x-forwarded-for": "10.9.1.1" }
        )
      )
    );
  });

  it("recovery: 429 after 5 attempts per IP", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await recoveryPost(jsonReq(`${BASE}/api/auth/recovery`, {}, { "x-forwarded-for": "10.9.2.1" }));
      expect(res.status).toBe(400);
    }
    await expectRateLimited(await recoveryPost(jsonReq(`${BASE}/api/auth/recovery`, {}, { "x-forwarded-for": "10.9.2.1" })));
  });

  it("password change: 401 unauth, 403 without CSRF, then 429 after 5 wrong-password attempts per user", async () => {
    const cookie = await registerViaRoute("rl-pass", "rl-pass-strong-pass", "10.9.3.1");
    const url = `${BASE}/api/auth/password`;
    const body = { current_password: "nope", new_password: "rl-pass-next-strong" };

    expect((await passwordPatch(jsonReq(url, body, {}))).status).toBe(401); // no session
    expect((await passwordPatch(jsonReq(url, body, { cookie }))).status).toBe(403); // no CSRF header

    for (let i = 0; i < 5; i++) {
      const res = await passwordPatch(jsonReq(url, body, { cookie, "x-of-request": "1" }));
      expect(res.status).toBe(400); // wrong current password, limiter counting
    }
    await expectRateLimited(await passwordPatch(jsonReq(url, body, { cookie, "x-of-request": "1" })));
  }, 20_000);
});

describe("rate limiting on session-creation endpoints (added 2026-08-26)", () => {
  it("pairing accept: 403 without CSRF header, then 429 after 5 attempts per IP", async () => {
    const url = `${BASE}/api/pairing/accept`;
    const body = { code: "ofp_aaaaaaaaaa" };

    expect((await pairingAcceptPost(jsonReq(url, body, {}))).status).toBe(403);

    for (let i = 0; i < 5; i++) {
      const res = await pairingAcceptPost(jsonReq(url, body, { "x-of-request": "1", "x-forwarded-for": "10.9.4.1" }));
      expect(res.status).toBe(404); // unknown code, limiter counting
    }
    await expectRateLimited(
      await pairingAcceptPost(jsonReq(url, body, { "x-of-request": "1", "x-forwarded-for": "10.9.4.1" }))
    );
  });

  it("phone-import bootstrap: 429 after 5 attempts per IP", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await bootstrapPost(jsonReq(`${BASE}/api/phone-import/bootstrap`, {}, { "x-forwarded-for": "10.9.5.1" }));
      expect(res.status).toBe(400);
    }
    await expectRateLimited(
      await bootstrapPost(jsonReq(`${BASE}/api/phone-import/bootstrap`, {}, { "x-forwarded-for": "10.9.5.1" }))
    );
  });

  it("demo login: 429 after 5 passwordless logins per IP when DEMO_MODE is on", async () => {
    // Fresh module registry so the route's `env` picks up DEMO_MODE=true.
    vi.resetModules();
    process.env.DEMO_MODE = "true";
    try {
      const adapter = await import("@/server/db/adapter");
      const db = adapter.getSqliteDb();
      for (const sql of migrationFiles()) db.exec(sql);
      const now = new Date().toISOString();
      await db.run(
        "INSERT INTO users (id, username, display_name, password_hash, is_demo, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, ?, ?)",
        "demo-user-id",
        "demo",
        "Demo",
        now,
        now
      );
      const { POST } = await import("@/app/api/auth/demo/route");
      const call = () =>
        POST(jsonReq(`${BASE}/api/auth/demo`, {}, { "x-of-request": "1", "x-forwarded-for": "10.9.6.1" }));

      for (let i = 0; i < 5; i++) {
        const res = await call();
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true });
      }
      await expectRateLimited(await call());
    } finally {
      delete process.env.DEMO_MODE;
    }
  }, 15_000);
});

describe("rate limiting on agent detection", () => {
  it("agents/detect: 200 within budget, 429 on the 11th call per user", async () => {
    const cookie = await registerViaRoute("rl-detect", "rl-detect-strong-pass", "10.9.7.1");
    const call = () => detectGet(jsonReq(`${BASE}/api/agents/detect`, undefined, { cookie }, "GET"));

    for (let i = 0; i < 10; i++) {
      const res = await call();
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveProperty("agents");
    }
    await expectRateLimited(await call());
  }, 20_000);
});
