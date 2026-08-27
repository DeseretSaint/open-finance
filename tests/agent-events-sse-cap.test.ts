import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb, getSqliteDb } from "@/server/db/adapter";
import { createAuthService } from "@/server/auth/service";
import { createAgentTokenService } from "@/server/authz/tokens";
import { __sseClientCountForTest, MAX_SSE_CLIENTS } from "@/server/authz/permission-requests";
import { GET } from "@/app/api/agent/events/route";

/**
 * /api/agent/events keeps one subscriber per open SSE stream in a
 * module-level Set (permission-requests.ts). Each subscriber holds an open
 * HTTP connection plus a 25s heartbeat interval, so the Set must be bounded
 * or any caller with a valid session/agent token could open unlimited
 * parallel streams and grow the long-running server process without limit
 * (same class as the /mcp session-Map cap, run 49). These tests drive the
 * REAL route handler.
 */

const BASE = "http://localhost:3000";

function migrationFiles(): string[] {
  const dir = path.join(process.cwd(), "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
}

let agentToken = "";
const controllers: AbortController[] = [];

beforeAll(async () => {
  const db = getSqliteDb();
  for (const sql of migrationFiles()) db.exec(sql);
  await createAuthService(getDb()).register({
    username: "sse-cap-user",
    display_name: "SSE Cap",
    password: "sse-cap-strong-pass",
  });
  const user = await getDb().get<{ id: string }>("SELECT id FROM users WHERE username = ?", "sse-cap-user");
  const { token } = await createAgentTokenService(getDb()).create(user!.id, {
    name: "sse-cap-bot",
    preset: "read-only",
  });
  agentToken = token;
});

afterEach(() => {
  // Abort every stream opened so far — clears heartbeat intervals and
  // unsubscribes, so the module-level Set drains between tests.
  while (controllers.length) controllers.pop()!.abort();
});

afterAll(() => {
  getSqliteDb().close();
});

function sseReq(token?: string): NextRequest {
  const controller = new AbortController();
  controllers.push(controller);
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`${BASE}/api/agent/events`, { headers, signal: controller.signal });
}

describe("agent events SSE subscriber cap", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await GET(sseReq());
    expect(res.status).toBe(401);
    expect(__sseClientCountForTest()).toBe(0);
  });

  it("bounds concurrent subscribers at MAX_SSE_CLIENTS and 429s beyond it", async () => {
    expect(__sseClientCountForTest()).toBe(0);
    const streams: Response[] = [];
    for (let i = 0; i < MAX_SSE_CLIENTS; i++) {
      streams.push(await GET(sseReq(agentToken)));
    }
    expect(streams.every((r) => r.status === 200)).toBe(true);
    expect(__sseClientCountForTest()).toBe(MAX_SSE_CLIENTS);

    // The next stream is refused; the Set does not grow.
    const over = await GET(sseReq(agentToken));
    expect(over.status).toBe(429);
    const body = await over.json();
    expect(body.error.code).toBe("rate_limited");
    expect(__sseClientCountForTest()).toBe(MAX_SSE_CLIENTS);
  });

  it("frees a slot when a stream is aborted, allowing a new subscriber", async () => {
    const first = await GET(sseReq(agentToken));
    expect(first.status).toBe(200);
    expect(__sseClientCountForTest()).toBe(1);

    // Abort the open stream — the abort listener unsubscribes.
    controllers[controllers.length - 1]!.abort();
    expect(__sseClientCountForTest()).toBe(0);

    const again = await GET(sseReq(agentToken));
    expect(again.status).toBe(200);
    expect(__sseClientCountForTest()).toBe(1);
  });
});
