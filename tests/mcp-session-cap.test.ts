import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getSqliteDb } from "@/server/db/adapter";
import { POST, DELETE, __mcpTransportCountForTest, mcpErrorResponse } from "@/app/api/mcp/route";

/**
 * The /mcp route keeps one transport per MCP session in a module-level Map.
 * A caller can mint a fresh session id on every request (the mcp-session-id
 * header is honored verbatim; a missing header mints a random UUID), so the
 * Map must be bounded and self-cleaning or the long-running server process
 * grows without limit (each entry = transport + MCP server). These tests
 * drive the REAL route handler.
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

function initReq(sid?: string): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sid) headers["mcp-session-id"] = sid;
  return new NextRequest("http://localhost:3000/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cap-test", version: "1.0" },
      },
    }),
  });
}

describe("MCP session transport Map is bounded", () => {
  it("caps live sessions and evicts oldest first", async () => {
    const baseline = __mcpTransportCountForTest();
    const sids: string[] = [];
    // 140 unique client-supplied session ids > the 128 cap.
    for (let i = 0; i < 140; i++) {
      const sid = `cap-test-${i}`;
      sids.push(sid);
      const res = await POST(initReq(sid));
      expect(res.status).toBe(200);
    }
    // Bounded at the cap (not 140).
    expect(__mcpTransportCountForTest()).toBeLessThanOrEqual(128);
    expect(__mcpTransportCountForTest()).toBe(baseline + 128);

    // Oldest-first eviction: the FIRST minted sid was evicted, so DELETEing
    // it is a no-op (count unchanged); the LAST sid is live, so DELETEing it
    // closes + removes the entry (count drops).
    await DELETE(
      new NextRequest("http://localhost:3000/mcp", {
        method: "DELETE",
        headers: { "mcp-session-id": sids[0] },
      })
    );
    expect(__mcpTransportCountForTest()).toBe(baseline + 128);

    const before = __mcpTransportCountForTest();
    await DELETE(
      new NextRequest("http://localhost:3000/mcp", {
        method: "DELETE",
        headers: { "mcp-session-id": sids[sids.length - 1] },
      })
    );
    expect(__mcpTransportCountForTest()).toBe(before - 1);
  });

  it("reusing a session id does not grow the Map", async () => {
    const before = __mcpTransportCountForTest();
    const sid = "cap-test-reuse";
    await POST(initReq(sid));
    await POST(initReq(sid));
    await POST(initReq(sid));
    expect(__mcpTransportCountForTest()).toBe(before + 1);
    // Clean up.
    await DELETE(
      new NextRequest("http://localhost:3000/mcp", {
        method: "DELETE",
        headers: { "mcp-session-id": sid },
      })
    );
    expect(__mcpTransportCountForTest()).toBe(before);
  });
});

describe("MCP error responses do not leak internals", () => {
  it("unexpected errors return a generic message, not the raw error text", async () => {
    const res = mcpErrorResponse(new Error("SQLITE_BUSY: database is locked at /data/of.db"), "sid-leak");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.message).toBe("Internal error.");
    expect(body.error.message).not.toContain("SQLITE");
    expect(body.error.code).toBe(-32603);
  });

  it("expected conditions keep their specific status + message", async () => {
    const missing = mcpErrorResponse(new Error("missing bearer token"), "sid-1");
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: { message: string } }).error.message).toBe("missing bearer token");

    const notFound = mcpErrorResponse(new Error("Session not found"), "sid-2");
    expect(notFound.status).toBe(404);
    expect(((await notFound.json()) as { error: { message: string } }).error.message).toBe("Session not found");
  });
});
