import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok } from "@/lib/api";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createReportsService } from "@/server/domain/reports";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const monthsSchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(6),
});

/** Spending trend — user session or agent token (read:reports), allowlist-aware. */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:reports"], "get_cashflow");
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = monthsSchema.safeParse(raw);
    if (!parsed.success) throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const allowlist = auth.kind === "agent" ? auth.ctx.allowlist : null;
    const rows = await createReportsService(getDb()).spendingTrend(userId, parsed.data.months, allowlist, req.nextUrl.searchParams.get("includePending") !== "0");
    return ok({ rows });
  })(req, { params: Promise.resolve({}) });
}
