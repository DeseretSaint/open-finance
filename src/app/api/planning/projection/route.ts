import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok } from "@/lib/api";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createProjectionService } from "@/server/domain/projection";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const querySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).default(12),
  includeGoals: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
});

export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:planning"], "get_planning_items");
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const projection = await createProjectionService(getDb()).project(
      auth.kind === "agent" ? auth.ctx.userId : auth.userId,
      parsed.data.months,
      parsed.data.includeGoals,
      req.nextUrl.searchParams.get("includePending") !== "0"
    );
    return ok(projection);
  })(req, { params: Promise.resolve({}) });
}
