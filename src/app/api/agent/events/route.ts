import { NextRequest } from "next/server";
import { bearerToken } from "@/server/authz/agent-auth";
import { createAgentTokenService } from "@/server/authz/tokens";
import { subscribeSse } from "@/server/authz/permission-requests";
import { getSessionFromRequest } from "@/server/auth/sessions";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE event stream. Accepts either a user session (cookie) or an agent token
 * (Bearer). Events: `permission_requested` (agent got a 403 + a request was
 * opened), `permission_resolved`. Agents with no read scopes still get events.
 */
export async function GET(req: NextRequest) {
  const db = getDb();

  // Identify the caller: session cookie or agent bearer token.
  const session = await getSessionFromRequest(req, db);
  const raw = bearerToken(req);
  let userId: string | null = session?.userId ?? null;
  let identity = session ? `session:${session.id}` : null;
  if (!userId && raw) {
    const token = await createAgentTokenService(db).authenticate(raw);
    if (token) {
      userId = token.user_id;
      identity = `token:${token.id}`;
    }
  }
  if (!userId || !identity) {
    return new Response(JSON.stringify({ error: { code: "unauthorized", message: "You must be signed in." } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  // start() runs synchronously during ReadableStream construction, so the
  // cap check inside subscribeSse completes before we decide the response.
  let overCap = false;
  const stream = new ReadableStream({
    start(controller) {
      const unsubscribe = subscribeSse({
        send: (event, data) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            unsubscribe?.();
          }
        },
      });
      if (!unsubscribe) {
        // Concurrent-subscriber cap reached — refuse the stream (429 below).
        overCap = true;
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`event: connected\ndata: {"identity":"${identity}"}\n\n`));
      // Heartbeat every 25s keeps proxies from closing the stream.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 25_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  if (overCap) {
    return new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many concurrent event streams — retry shortly." } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
