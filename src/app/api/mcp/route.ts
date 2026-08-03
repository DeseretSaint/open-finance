import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NextRequest, NextResponse } from "next/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createOpenFinanceMcpServer, authFromToken, McpUnauthorizedError } from "@/server/mcp/server";
import { bearerToken } from "@/server/authz/agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP over Streamable HTTP — `<PUBLIC_URL>/mcp`. The SDK's transport speaks
 * Node's http (IncomingMessage/ServerResponse); Next.js Route Handlers use the
 * Web API, so we adapt both directions with the documented mock pattern.
 */

const transports = new Map<string, StreamableHTTPServerTransport>();
const servers = new Map<string, ReturnType<typeof createOpenFinanceMcpServer>>();

/** Minimal ServerResponse shim the SDK transport writes into. */
class MockServerResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string | string[]> = {};
  private chunks: Buffer[] = [];
  /** Resolves when end() is called — the SDK writes responses asynchronously. */
  readonly done: Promise<void>;
  private resolveDone!: () => void;

  constructor() {
    super();
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  setHeader(name: string, value: string | string[]): void {
    this.headers[name.toLowerCase()] = value;
  }
  getHeader(name: string): string | string[] | undefined {
    return this.headers[name.toLowerCase()];
  }
  writeHead(status: number, headers?: Record<string, string | string[]>): this {
    this.statusCode = status;
    if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    return this;
  }
  write(chunk: unknown): boolean {
    if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  }
  end(chunk?: unknown): void {
    if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    this.resolveDone();
    this.emit("finish");
  }
  flushHeaders(): void {
    /* no-op */
  }
  getBody(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Minimal IncomingMessage shim feeding the SDK transport the request body. */
class MockIncomingMessage extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  private body: Buffer;
  private offset = 0;
  socket = { destroy: () => {} };

  constructor(method: string, url: string, headers: Record<string, string | undefined>, body: Buffer) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = body;
  }
  read(): Buffer | null {
    if (this.offset >= this.body.length) return null;
    const chunk = this.body.subarray(this.offset);
    this.offset = this.body.length;
    return chunk;
  }
  on(event: string, listener: (...args: unknown[]) => void): this {
    if (event === "data" && this.body.length > 0) {
      // Push the whole body as one data event (per http semantics).
      queueMicrotask(() => listener(this.body));
      return this;
    }
    if (event === "end") {
      queueMicrotask(() => listener());
      return this;
    }
    return super.on(event, listener);
  }
}

async function getTransport(
  req: NextRequest,
  sid: string
): Promise<{ transport: StreamableHTTPServerTransport; server: ReturnType<typeof createOpenFinanceMcpServer> }> {
  let transport = transports.get(sid);
  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sid,
      enableJsonResponse: true,
      onsessioninitialized: (sessionId: string) => {
        transports.set(sessionId, transport!);
      },
    });
    const server = createOpenFinanceMcpServer(async () => {
      const raw = bearerToken(req);
      if (!raw) throw new Error("missing bearer token");
      return authFromToken(raw);
    });
    await server.connect(transport);
    transports.set(sid, transport);
    servers.set(sid, server);
    return { transport, server };
  }
  return { transport, server: servers.get(sid)! };
}

function toNextResponse(mock: MockServerResponse): NextResponse {
  const body = mock.getBody();
  const headers = new Headers();
  for (const [k, v] of Object.entries(mock.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v as string);
  }
  return new NextResponse(body.length > 0 ? new Uint8Array(body) : null, { status: mock.statusCode, headers });
}

export async function POST(req: NextRequest) {
  const sid = req.headers.get("mcp-session-id") ?? crypto.randomUUID();
  try {
    const body = Buffer.from(await req.arrayBuffer());
    let parsed: unknown;
    try {
      parsed = body.length > 0 ? JSON.parse(body.toString("utf8")) : undefined;
    } catch {
      parsed = undefined;
    }
    const incoming = new MockIncomingMessage("POST", req.nextUrl.pathname, headersOf(req), body);
    const mock = new MockServerResponse();
    const { transport } = await getTransport(req, sid);
    await transport.handleRequest(incoming as unknown as IncomingMessage, mock as unknown as ServerResponse, parsed);
    // The SDK writes JSON responses asynchronously via its message pipeline.
    await Promise.race([mock.done, new Promise((r) => setTimeout(r, 10_000))]);
    const res = toNextResponse(mock);
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
    if (msg === "missing bearer token") {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "missing bearer token" } },
        { status: 401, headers: { "mcp-session-id": sid } }
      );
    }
    console.error("MCP POST error:", e);
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "internal error" } },
      { status: 500, headers: { "mcp-session-id": sid } }
    );
  }
}

export async function GET(req: NextRequest) {
  const sid = req.headers.get("mcp-session-id");
  if (!sid || !transports.has(sid)) {
    return NextResponse.json({ jsonrpc: "2.0", error: { code: -32000, message: "no active session" } }, { status: 400 });
  }
  try {
    const incoming = new MockIncomingMessage("GET", req.nextUrl.pathname, headersOf(req), Buffer.alloc(0));
    const mock = new MockServerResponse();
    const { transport } = await getTransport(req, sid);
    await transport.handleRequest(incoming as unknown as IncomingMessage, mock as unknown as ServerResponse);
    const res = toNextResponse(mock);
    if (!res.headers.has("mcp-session-id")) res.headers.set("mcp-session-id", sid);
    return res;
  } catch (e) {
    console.error("MCP GET error:", e);
    return NextResponse.json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" } }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const sid = req.headers.get("mcp-session-id");
  if (sid && transports.has(sid)) {
    try {
      const incoming = new MockIncomingMessage("DELETE", req.nextUrl.pathname, headersOf(req), Buffer.alloc(0));
      const mock = new MockServerResponse();
      await transports.get(sid)!.handleRequest(incoming as unknown as IncomingMessage, mock as unknown as ServerResponse);
    } catch {
      /* best effort */
    }
    transports.delete(sid);
    servers.delete(sid);
  }
  return NextResponse.json({ ok: true });
}

function headersOf(req: NextRequest): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}
