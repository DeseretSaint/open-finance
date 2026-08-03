import { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createReportsService } from "@/server/domain/reports";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";


/** Net worth — user session or agent token (read:reports), allowlist-aware. */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:reports"], "get_net_worth");
    const allowlist = auth.kind === "agent" ? auth.ctx.allowlist : null;
    const netWorth = await createReportsService(getDb()).netWorth(auth.kind === "agent" ? auth.ctx.userId : auth.userId, allowlist);
    return ok({ netWorth });
  })(req, { params: Promise.resolve({}) });
}
