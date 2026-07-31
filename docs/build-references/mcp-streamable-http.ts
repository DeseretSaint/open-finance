// mcp-streamable-http.ts — reference snippet for P7a.
// Next.js 15 Route Handler exposing an MCP server over Streamable HTTP
// (POST for messages, GET for SSE). Copy from here, don't invent.
import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const server = new McpServer({
  name: "open-finance",
  version: "0.0.1",
});

server.registerTool("get_financial_summary", {
  description: "One-call briefing over allowlisted accounts (read:summary).",
  inputSchema: { type: "object", properties: {}, required: [] },
}, async () => {
  // P7a: scope-check + withAllowlist here
  return { content: [{ type: "text", text: JSON.stringify({ summary: "…" }) }] };
});

const transports = new Map<string, StreamableHTTPServerTransport>();

export async function POST(req: NextRequest) {
  const sessionId = req.headers.get("mcp-session-id") ?? crypto.randomUUID();
  let transport = transports.get(sessionId);
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      onsessioninitialized: (t) => transports.set(sessionId, t),
    });
    await server.connect(transport);
  }
  await transport.handleRequest(req);
  const res = transport.response ?? NextResponse.json({});
  res.headers.set("mcp-session-id", sessionId);
  return res;
}

export async function GET(req: NextRequest) {
  const sessionId = req.headers.get("mcp-session-id");
  if (!sessionId || !transports.has(sessionId)) {
    return NextResponse.json({ error: "no session" }, { status: 400 });
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req);
  const res = transport.response ?? NextResponse.json({});
  res.headers.set("mcp-session-id", sessionId);
  return res;
}

export async function DELETE(req: NextRequest) {
  const sessionId = req.headers.get("mcp-session-id");
  if (sessionId) {
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.handleRequest(req);
      transports.delete(sessionId);
    }
  }
  return NextResponse.json({ ok: true });
}
