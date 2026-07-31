import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPlanningService } from "@/server/domain/planning";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().max(50).optional(),
  principalCents: z.number().int().positive(),
  aprBps: z.number().int().nonnegative().optional(),
  minPaymentCents: z.number().int().nonnegative().optional(),
  termMonths: z.number().int().positive().nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  accountId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const debts = await createPlanningService(getDb()).listDebts(session.userId);
    return ok({ debts });
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const debt = await createPlanningService(getDb()).createDebt(session.userId, body);
    return ok({ debt }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
