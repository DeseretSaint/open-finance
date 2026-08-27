import { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createReportsService } from "@/server/domain/reports";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** Net-worth trend (from balance_history) — user session or agent token (read:reports), allowlist-aware. */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:reports"], "get_net_worth_trend");
    const allowlist = auth.kind === "agent" ? auth.ctx.allowlist : null;
    const months = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("months") ?? "12", 10) || 12, 1), 60);
    const trend = await createReportsService(getDb()).netWorthTrend(
      auth.kind === "agent" ? auth.ctx.userId : auth.userId,
      months,
      allowlist,
      req.nextUrl.searchParams.get("includeExcluded") === "1"
    );
    return ok({ trend });
  })(req, { params: Promise.resolve({}) });
}
