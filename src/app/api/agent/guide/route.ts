import { NextRequest } from "next/server";
import { agentRoute, bearerToken } from "@/server/authz/agent-auth";
import { createAgentTokenService } from "@/server/authz/tokens";
import { buildAgentGuide } from "@/server/domain/agent-guide";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/**
 * GET /api/agent/guide — the agent handbook (D10). Bearer token, always
 * available (like /api/agent/capabilities): an agent fetches this at connect
 * time to learn the app map, money conventions, the widget recipe, the
 * guardrails, and when to refuse.
 */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const { ok, apiErrors } = await import("@/lib/api");
    const raw = bearerToken(req);
    if (!raw) throw apiErrors.unauthorized();
    const token = await createAgentTokenService(getDb()).authenticate(raw);
    if (!token) throw apiErrors.unauthorized();
    return ok({ guide: buildAgentGuide() });
  })(req, { params: Promise.resolve({}) });
}
