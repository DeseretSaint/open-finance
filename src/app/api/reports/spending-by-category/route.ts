import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok } from "@/lib/api";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createReportsService } from "@/server/domain/reports";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Spending by category — user session or agent token (read:reports), allowlist-aware. */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:reports"], "get_spending_by_category");
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const allowlist = auth.kind === "agent" ? auth.ctx.allowlist : null;
    const rows = await createReportsService(getDb()).spendingByCategory(userId, parsed.data.from, parsed.data.to, allowlist, false, req.nextUrl.searchParams.get("includePending") !== "0");
    return ok({ rows });
  })(req, { params: Promise.resolve({}) });
}
