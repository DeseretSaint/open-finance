import { NextRequest } from "next/server";
import { agentRoute, bearerToken } from "@/server/authz/agent-auth";
import { createAgentTokenService, ALL_SCOPES } from "@/server/authz/tokens";
import { MCP_TOOLS, AGENT_ROUTES } from "@/server/authz/route-registry";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/**
 * Capabilities — exactly what a token can do, and what's missing. Always
 * available (no scope required). Agents should call this before acting.
 */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const { ok, apiErrors } = await import("@/lib/api");
    const raw = bearerToken(req);
    if (!raw) throw apiErrors.unauthorized();
    const svc = createAgentTokenService(getDb());
    const token = await svc.authenticate(raw);
    if (!token) throw apiErrors.unauthorized();

    const scopes = JSON.parse(token.scopes ?? "[]") as string[];
    const accountIds = token.account_ids ? (JSON.parse(token.account_ids) as string[]) : null;

    const tools = MCP_TOOLS.filter((t) => t.scopes.length === 0 || t.scopes.some((s) => scopes.includes(s))).map(
      (t) => t.tool
    );
    const missing = ALL_SCOPES.filter((s) => !scopes.includes(s));
    const endpoints = AGENT_ROUTES.filter(
      (r) => r.scopes.length === 0 || r.scopes.some((s) => scopes.includes(s))
    ).map((r) => `${r.method} ${r.path}`);

    return ok({
      preset: token.preset,
      scopes,
      accountCount: accountIds === null ? "all" : accountIds.length,
      accountIds,
      uiTabs: token.ui_tabs ? (JSON.parse(token.ui_tabs) as string[]) : null,
      expiresAt: token.expires_at,
      tools,
      endpoints,
      missing,
      tokenName: token.name,
    });
  })(req, { params: Promise.resolve({}) });
}
