import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok } from "@/lib/api";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createPlanningService } from "@/server/domain/planning";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:planning"], "get_planning_items");
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const digest = await createPlanningService(getDb()).digest(
      auth.kind === "agent" ? auth.ctx.userId : auth.userId,
      parsed.data.days,
      parsed.data.until
    );
    return ok(digest);
  })(req, { params: Promise.resolve({}) });
}
