import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { parseBody, assertJsonBodySize, MAX_JSON_BODY_BYTES } from "@/lib/api";
import { z } from "zod";

describe("json body size cap (chokepoint)", () => {
  it("assertJsonBodySize rejects oversized declared length and parsed length", () => {
    expect(() => assertJsonBodySize(String(MAX_JSON_BODY_BYTES + 1), null)).toThrow(/too large/i);
    expect(() => assertJsonBodySize(null, MAX_JSON_BODY_BYTES + 1)).toThrow(/too large/i);
    // exactly at the cap → allowed
    expect(() => assertJsonBodySize(String(MAX_JSON_BODY_BYTES), MAX_JSON_BODY_BYTES)).not.toThrow();
    // absent / non-numeric header + small body → allowed
    expect(() => assertJsonBodySize(null, 1024)).not.toThrow();
    expect(() => assertJsonBodySize("garbage", 1024)).not.toThrow();
    try {
      assertJsonBodySize(null, MAX_JSON_BODY_BYTES + 1);
      expect.unreachable();
    } catch (e) {
      expect((e as { status: number }).status).toBe(413);
    }
  });

  it("parseBody throws 413 on oversized declared Content-Length BEFORE buffering", async () => {
    const big = JSON.stringify({ username: "x".repeat(MAX_JSON_BODY_BYTES + 10) });
    const req = new NextRequest("http://localhost/api/x", {
      method: "POST",
      headers: { "content-length": String(big.length) },
      body: big,
    });
    await expect(parseBody(z.object({ username: z.string() }), req)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("parseBody re-checks the buffered length (chunked/lying Content-Length)", async () => {
    // Declare a small length but ship a huge body — the post-read check must catch it.
    const big = JSON.stringify({ username: "y".repeat(MAX_JSON_BODY_BYTES + 10) });
    const req = new NextRequest("http://localhost/api/x", {
      method: "POST",
      headers: { "content-length": "10" },
      body: big,
    });
    await expect(parseBody(z.object({ username: z.string() }), req)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("parseBody still parses a normal-sized body", async () => {
    const req = new NextRequest("http://localhost/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice" }),
    });
    const data = await parseBody(z.object({ username: z.string() }), req);
    expect(data).toEqual({ username: "alice" });
  });
});

// Source guard: parseBody must read via req.text() (so it can measure length
// pre-parse) and must call assertJsonBodySize — NOT req.json() which buffers
// the whole body before any size check. Regression-locks the memory-exhaustion
// fix at the shared chokepoint used by all 44 JSON routes.
describe("parseBody source guard", () => {
  it("api.ts buffers via req.text() + assertJsonBodySize, not req.json()", () => {
    const src = readFileSync("src/lib/api.ts", "utf8");
    const parseBodyBlock = src.slice(src.indexOf("export async function parseBody"));
    expect(parseBodyBlock).toContain("assertJsonBodySize");
    expect(parseBodyBlock).toContain("req.text()");
    expect(parseBodyBlock).toContain("JSON.parse(text)");
    // the old unbounded path must be gone
    expect(parseBodyBlock).not.toContain("req.json()");
  });
});
