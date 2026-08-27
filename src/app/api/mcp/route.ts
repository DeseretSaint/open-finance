import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createOpenFinanceMcpServer, authFromToken, McpUnauthorizedError, type McpAuth } from "@/server/mcp/server";
import { bearerToken } from "@/server/authz/agent-auth";
import { assertJsonBodySize, ApiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP over Streamable HTTP — `<PUBLIC_URL>/mcp`.
 *
 * The bundled SDK (1.30) exposes a Web-Standard transport: give it a Web
 * `Request`, it returns a Web `Response`. Next.js Route Handlers speak the
 * same API, so there is no Node-shim adaptation — we keep one transport per
 * MCP session and forward the request (with the bearer token captured for the
 * server's auth callback) verbatim.
 */

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

/**
 * Hard cap on concurrent MCP sessions. The Map is keyed by session id, and a
 * caller can mint a fresh id on every request (no header → random UUID; a
 * client-supplied header is honored verbatim), so without a bound a stream of
 * requests would grow the Map — each entry holds a transport + MCP server —
 * without limit in the long-running server process. Oldest sessions evict
 * first (Map preserves insertion order); an evicted client simply
 * re-initializes.
 */
const MAX_MCP_SESSIONS = 128;

function evictOldestSessions(): void {
  while (transports.size > MAX_MCP_SESSIONS) {
    const oldest = transports.keys().next().value;
    if (oldest === undefined) break;
    const transport = transports.get(oldest);
    transports.delete(oldest);
    try {
      void transport?.close();
    } catch {
      /* best effort */
    }
  }
}

function getTransport(sid: string, getAuth: () => Promise<McpAuth>): WebStandardStreamableHTTPServerTransport {
  let transport = transports.get(sid);
  if (!transport) {
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => sid,
      enableJsonResponse: true,
      onsessioninitialized: (sessionId: string) => {
        transports.set(sessionId, transport!);
      },
    });
    // Clean the Map entry whenever the transport closes for any reason
    // (client DELETE, SDK-driven close, eviction) so dead sessions can't
    // accumulate.
    const boundSid = sid;
    transport.onclose = () => {
      transports.delete(boundSid);
    };
    const server = createOpenFinanceMcpServer(getAuth);
    // connect() starts the transport's message pump; fire-and-forget is fine
    // here because handleRequest awaits the transport internally.
    void server.connect(transport);
    transports.set(sid, transport);
    evictOldestSessions();
  }
  return transport;
}

/**
 * Map an error thrown by the transport/auth layer to a JSON-RPC error
 * response. Expected conditions get their own status (401 missing token,
 * 404 unknown session, 403 insufficient scope); anything ELSE is an
 * unexpected server error — the full detail is logged server-side, but the
 * caller gets a generic message only. Raw error text (SQL fragments, file
 * paths, driver strings) is an information-disclosure surface on an
 * endpoint deliberately exposed to external agents.
 */
export function mcpErrorResponse(e: unknown, sid: string): NextResponse {
  if (e instanceof McpUnauthorizedError) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32001, message: `insufficient_scope: ${e.missing.join(", ")}` } },
      { status: 403, headers: { "mcp-session-id": sid } }
    );
  }
  // Expected ApiErrors (e.g. the 413 body-size cap) keep their own status +
  // message — both are app-authored constants, not leak surfaces.
  if (e instanceof ApiError) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32000, message: e.message } },
      { status: e.status, headers: { "mcp-session-id": sid } }
    );
  }
  const msg = e instanceof Error ? e.message : "";
  if (msg === "missing bearer token") {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32000, message: msg } },
      { status: 401, headers: { "mcp-session-id": sid } }
    );
  }
  if (msg.includes("Session not found")) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message: msg } },
      { status: 404, headers: { "mcp-session-id": sid } }
    );
  }
  console.error("MCP error:", e);
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32603, message: "Internal error." } },
    { status: 500, headers: { "mcp-session-id": sid } }
  );
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const sid = req.headers.get("mcp-session-id") ?? crypto.randomUUID();
  // Capture the bearer token for the server's auth callback (the Web Request
  // headers carry it; authFromToken re-reads it from the request).
  const raw = bearerToken(req);
  const getAuth = async () => {
    if (!raw) throw new Error("missing bearer token");
    return authFromToken(raw);
  };

  try {
    // Reject oversized bodies BEFORE buffering them into RAM (parity with the
    // parseBody chokepoint cap that covers every other JSON route): declared
    // Content-Length first, then the buffered length (chunked/lying headers).
    assertJsonBodySize(req.headers.get("content-length"), null);
    const text = await req.text().catch(() => undefined);
    if (text !== undefined) assertJsonBodySize(null, text.length);
    let parsedBody: unknown;
    try {
      parsedBody = text === undefined ? undefined : JSON.parse(text);
    } catch {
      parsedBody = undefined;
    }
    const transport = getTransport(sid, getAuth);
    // Build a fresh Web Request carrying the parsed body through (the
    // transport uses parsedBody; the raw stream is already consumed).
    const response: Response = await transport.handleRequest(req as unknown as Request, {
      parsedBody,
    });
    // Wrap the Web Response in a NextResponse, preserving status + headers.
    const res = new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
    if (!res.headers.has("mcp-session-id")) res.headers.set("mcp-session-id", sid);
    return res;
  } catch (e) {
    return mcpErrorResponse(e, sid);
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function DELETE(req: NextRequest) {
  const sid = req.headers.get("mcp-session-id");
  if (sid && transports.has(sid)) {
    try {
      await transports.get(sid)!.close();
    } catch {
      /* best effort */
    }
    transports.delete(sid);
  }
  return NextResponse.json({ ok: true });
}

/** Test-only: current live MCP session count (the Map is module-private). */
export function __mcpTransportCountForTest(): number {
  return transports.size;
}
