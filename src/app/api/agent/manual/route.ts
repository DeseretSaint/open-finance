import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { agentRoute, bearerToken } from "@/server/authz/agent-auth";
import { createAgentTokenService } from "@/server/authz/tokens";
import { createAgentManualService } from "@/server/domain/agent-manual";
import { MANUAL_MAX_LEN } from "@/server/domain/agent-manual-meta";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const schema = z.object({
  categorization: z.string().max(MANUAL_MAX_LEN).optional(),
  budgeting: z.string().max(MANUAL_MAX_LEN).optional(),
  general: z.string().max(MANUAL_MAX_LEN).optional(),
});

/**
 * GET /api/agent/manual — the user's live AI steering manual (D11). Always
 * available to the agent (Bearer token); the agent reads this on every poll via
 * the read_agent_manual MCP tool so guidance updates need no agent-config edits.
 */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const raw = bearerToken(req);
    if (!raw) throw apiErrors.unauthorized();
    const token = await createAgentTokenService(getDb()).authenticate(raw);
    if (!token) throw apiErrors.unauthorized();
    const svc = createAgentManualService(getDb());
    const manual = await svc.get(token.user_id);
    // ?since=<version> — cheap change check: unchanged → changed:false, no text.
    const sinceRaw = req.nextUrl.searchParams.get("since");
    const since = sinceRaw !== null && !Number.isNaN(Number(sinceRaw)) ? Number(sinceRaw) : undefined;
    if (since !== undefined && since === manual.version) {
      return ok({ changed: false, version: manual.version });
    }
    return ok({ changed: true, version: manual.version, manual });
  })(req, { params: Promise.resolve({}) });
}

/** PUT /api/agent/manual — user edits their AI steering guidance (user session only). */
export const PUT = route(async (req: NextRequest) => {
  const session = await requireSession(req);
  const body = await parseBody(schema, req);
  const manual = await createAgentManualService(getDb()).update(session.userId, body);
  return ok({ manual });
});
