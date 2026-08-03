import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createOpenFinanceMcpServer, authFromToken, McpUnauthorizedError, type McpAuth } from "@/server/mcp/server";
import { bearerToken } from "@/server/authz/agent-auth";

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
    const server = createOpenFinanceMcpServer(getAuth);
    // connect() starts the transport's message pump; fire-and-forget is fine
    // here because handleRequest awaits the transport internally.
    void server.connect(transport);
    transports.set(sid, transport);
  }
  return transport;
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
    const transport = getTransport(sid, getAuth);
    // Build a fresh Web Request carrying the parsed body through (the
    // transport reads req.json() itself; we pass the original request).
    const response: Response = await transport.handleRequest(req as unknown as Request, {
      parsedBody: await req.json().catch(() => undefined),
    });
    // Wrap the Web Response in a NextResponse, preserving status + headers.
    const res = new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
    if (!res.headers.has("mcp-session-id")) res.headers.set("mcp-session-id", sid);
    return res;
  } catch (e) {
    if (e instanceof McpUnauthorizedError) {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32001, message: `insufficient_scope: ${e.missing.join(", ")}` } },
        { status: 403, headers: { "mcp-session-id": sid } }
      );
    }
    const msg = e instanceof Error ? e.message : "internal error";
    const status = msg === "missing bearer token" ? 401 : msg.includes("Session not found") ? 404 : 500;
    if (status === 500) console.error("MCP error:", e);
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: status === 401 ? -32000 : -32603, message: msg } },
      { status, headers: { "mcp-session-id": sid } }
    );
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
