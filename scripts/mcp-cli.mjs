#!/usr/bin/env node
"use strict";
/**
 * Open Finance MCP stdio bridge (v1 — no npm publish yet, per plan §12).
 *
 * Usage: node /abs/path/dist/mcp-cli.mjs --url <URL> --token <TOKEN>
 *
 * Speaks MCP over stdio (JSON-RPC lines) and forwards every message to the
 * app's Streamable HTTP MCP endpoint with `Authorization: Bearer <token>`.
 * This lets agents (Hermes, Claude Desktop, Cursor, codex…) connect to the
 * app with a plain stdio server config — no HTTP client config needed.
 */
import { createInterface } from "node:readline";

function parseArgs(argv) {
  const out = { url: null, token: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") out.url = argv[i + 1];
    if (argv[i] === "--token") out.token = argv[i + 1];
  }
  return out;
}

const { url, token } = parseArgs(process.argv.slice(2));
if (!url || !token) {
  console.error("Usage: node mcp-cli.mjs --url <URL> --token <TOKEN>");
  process.exit(1);
}

const endpoint = url.replace(/\/$/, "") + "/mcp";

async function callMcp(message) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  // Send mcp-session-id only once initialize returned one — an empty header
  // would collide with the server's stale sessions.
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  const ct = res.headers.get("content-type") ?? "";
  let data;
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    data = parseSse(text);
  } else {
    data = await res.json().catch(() => ({ jsonrpc: "2.0", error: { code: -32603, message: "bad response" }, id: message.id ?? null }));
  }
  if (res.headers.get("mcp-session-id")) sessionId = res.headers.get("mcp-session-id");
  return data;
}

function parseSse(text) {
  const lines = text.split("\n");
  let dataLine = null;
  for (const l of lines) {
    if (l.startsWith("data:")) dataLine = l.slice(5).trim();
  }
  if (dataLine) {
    try {
      return JSON.parse(dataLine);
    } catch {
      /* fall through */
    }
  }
  return { jsonrpc: "2.0", error: { code: -32603, message: "bad SSE payload" }, id: null };
}

let sessionId = "";
let pending = 0;
let stdinClosed = false;
let queue = Promise.resolve();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function maybeExit() {
  if (stdinClosed && pending === 0) process.exit(0);
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "parse error" }, id: null }) + "\n");
    return;
  }
  pending += 1;
  // MCP clients are sequential: each message waits for the previous response
  // (so initialize's session id is captured before tools/list fires).
  queue = queue.then(() => callMcp(msg)).then(
    (result) => {
      process.stdout.write(JSON.stringify(result) + "\n");
    },
    (e) => {
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: e instanceof Error ? e.message : "proxy error" }, id: msg.id ?? null }) + "\n"
      );
    }
  ).finally(() => {
    pending -= 1;
    maybeExit();
  });
});

process.stdin.on("end", () => {
  stdinClosed = true;
  maybeExit();
});

// Keep the process alive waiting for stdin.
