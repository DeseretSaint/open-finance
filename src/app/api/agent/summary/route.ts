import { NextRequest } from "next/server";
import { agentRoute, requireAgentScope } from "@/server/authz/agent-auth";
import { createSummaryService } from "@/server/domain/summary";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/**
 * Agent one-call briefing (read:summary). Allowlist-aware: every figure flows
 * through withAllowlist, so a token scoped to specific accounts only sees those.
 */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const ctx = await requireAgentScope(req, ["read:summary"], "get_financial_summary");
    const summary = await createSummaryService(getDb()).get(ctx.userId, undefined, ctx.allowlist);
    const { ok } = await import("@/lib/api");
    return ok({
      scope: ctx.accountIds === null ? "all allowed accounts" : "allowed accounts",
      summary,
    });
  })(req, { params: Promise.resolve({}) });
}
