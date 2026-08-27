import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getSqliteDb } from "@/server/db/adapter";
import { createSession } from "@/server/auth/sessions";
import { MAX_JSON_BODY_BYTES } from "@/lib/api";
import { POST as mcpPost, __mcpTransportCountForTest } from "@/app/api/mcp/route";
import { POST as onboardingPost } from "@/app/api/onboarding/route";
import { seedUser } from "./helpers";

/**
 * Run-84 capped every JSON route at the parseBody chokepoint, but /api/mcp
 * (agent-token-gated, external BYOA callers) and /api/onboarding POST
 * (session-gated) still called req.json() directly — buffering an unbounded
 * body into RAM. Both now enforce assertJsonBodySize (declared
 * Content-Length BEFORE buffering + buffered length after). These tests drive
 * the REAL route handlers.
 */

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

function mcpInitReq(sid: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sid,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "size-test", version: "1.0" },
      },
    }),
  });
}

describe("MCP route JSON body size cap", () => {
  it("returns 413 on oversized declared Content-Length BEFORE creating a session", async () => {
    const before = __mcpTransportCountForTest();
    const res = await mcpPost(
      mcpInitReq("size-cap-declared", { "content-length": String(MAX_JSON_BODY_BYTES + 1) })
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/too large/i);
    // The cap fired before the transport Map was touched — no session minted.
    expect(__mcpTransportCountForTest()).toBe(before);
  });

  it("re-checks the buffered length (lying Content-Length)", async () => {
    const before = __mcpTransportCountForTest();
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", pad: "z".repeat(MAX_JSON_BODY_BYTES + 10) });
    const res = await mcpPost(
      new NextRequest("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-session-id": "size-cap-lying",
          "content-length": "10",
        },
        body: big,
      })
    );
    expect(res.status).toBe(413);
    expect(__mcpTransportCountForTest()).toBe(before);
  });

  it("still initializes a normal-sized session (parsedBody path intact)", async () => {
    const before = __mcpTransportCountForTest();
    const res = await mcpPost(mcpInitReq("size-cap-normal"));
    expect(res.status).toBe(200);
    expect(__mcpTransportCountForTest()).toBe(before + 1);
    const body = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBeTruthy();
  });
});

describe("onboarding route JSON body size cap", () => {
  it("returns 413 payload_too_large on oversized declared Content-Length", async () => {
    const db = getSqliteDb();
    const user = await seedUser(db, "onboard-size");
    const { token } = await createSession(user.id, "1h", "size-test", db);
    const res = await onboardingPost(
      new NextRequest("http://localhost/api/onboarding", {
        method: "POST",
        headers: {
          cookie: `of_session=${token}`,
          "x-of-request": "1",
          "content-length": String(MAX_JSON_BODY_BYTES + 1),
        },
        body: JSON.stringify({ action: "reset" }),
      })
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payload_too_large");
  });

  it("still completes onboarding for a normal body", async () => {
    const db = getSqliteDb();
    const user = await seedUser(db, "onboard-normal");
    const { token } = await createSession(user.id, "1h", "size-test", db);
    const res = await onboardingPost(
      new NextRequest("http://localhost/api/onboarding", {
        method: "POST",
        headers: { cookie: `of_session=${token}`, "x-of-request": "1" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completed: boolean };
    expect(body.completed).toBe(true);
  });

  it("still rejects unauthenticated callers", async () => {
    const res = await onboardingPost(
      new NextRequest("http://localhost/api/onboarding", {
        method: "POST",
        headers: { "x-of-request": "1", "content-length": String(MAX_JSON_BODY_BYTES + 1) },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(401);
  });
});

// Source guards: both residual req.json() callers must go through
// assertJsonBodySize — regression-locks the run-84 cap coverage.
describe("residual JSON routes source guard", () => {
  it("mcp route enforces assertJsonBodySize and no longer calls req.json()", () => {
    const src = fs.readFileSync("src/app/api/mcp/route.ts", "utf8");
    expect(src).toContain("assertJsonBodySize(req.headers.get(\"content-length\"), null)");
    expect(src).toContain("assertJsonBodySize(null, text.length)");
    expect(src).not.toContain("req.json()");
  });

  it("onboarding route enforces assertJsonBodySize and no longer calls req.json()", () => {
    const src = fs.readFileSync("src/app/api/onboarding/route.ts", "utf8");
    expect(src).toContain("assertJsonBodySize(req.headers.get(\"content-length\"), null)");
    expect(src).toContain("assertJsonBodySize(null, text.length)");
    expect(src).not.toContain("req.json()");
  });
});
