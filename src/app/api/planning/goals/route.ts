import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPlanningService } from "@/server/domain/planning";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().max(30).optional(),
  category: z.string().max(50).optional(),
  targetCents: z.number().int().positive(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  currentCents: z.number().int().nonnegative().optional(),
  monthlyContributionCents: z.number().int().nonnegative().nullable().optional(),
  accountId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const goals = await createPlanningService(getDb()).listGoals(session.userId);
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
