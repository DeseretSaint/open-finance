import { NextRequest } from "next/server";
import { z } from "zod";
import { noContent, ok, parseBody, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPlanningService } from "@/server/domain/planning";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["savings", "expense"]).optional(),
  category: z.string().max(50).optional(),
  targetCents: z.number().int().positive().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  currentCents: z.number().int().nonnegative().optional(),
  monthlyContributionCents: z.number().int().nonnegative().nullable().optional(),
  contributionMode: z.enum(["none", "interval", "days_of_month", "agent"]).optional(),
  contributionInterval: z.enum(["weekly", "biweekly", "monthly"]).nullable().optional(),
  contributionDays: z.array(z.number().int().min(1).max(31)).optional(),
  accountId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(updateSchema, req);
    const goal = await createPlanningService(getDb()).updateGoal(session.userId, id, body);
    return ok({ goal });
  })(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    await createPlanningService(getDb()).removeGoal(session.userId, id);
    return noContent();
  })(req, ctx);
}
