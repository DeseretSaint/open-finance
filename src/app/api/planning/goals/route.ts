import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createPlanningService } from "@/server/domain/planning";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["savings", "expense"]).optional(),
  category: z.string().max(50).optional(),
  targetCents: z.number().int().positive(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  currentCents: z.number().int().nonnegative().optional(),
  monthlyContributionCents: z.number().int().nonnegative().nullable().optional(),
  contributionMode: z.enum(["none", "interval", "days_of_month", "agent"]).optional(),
  contributionInterval: z.enum(["weekly", "biweekly", "monthly"]).nullable().optional(),
  contributionDays: z.array(z.number().int().min(1).max(31)).optional(),
  accountId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:planning"], "get_planning_items");
    const goals = await createPlanningService(getDb()).listGoals(auth.kind === "agent" ? auth.ctx.userId : auth.userId);
    return ok({ goals });
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const goal = await createPlanningService(getDb()).createGoal(session.userId, body);
    return ok({ goal }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
