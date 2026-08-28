import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createPlanningService } from "@/server/domain/planning";
import { MAX_AMOUNT_CENTS } from "@/server/domain/money";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  amountCents: z.number().int().positive().refine((v) => v <= MAX_AMOUNT_CENTS, `Money value cannot exceed ${MAX_AMOUNT_CENTS.toLocaleString("en-US")} cents.`),
  frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly", "one-time"]).optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lastPaidAmountCents: z.number().int().positive().nullable().refine((v) => v === null || v <= MAX_AMOUNT_CENTS, `Money value cannot exceed ${MAX_AMOUNT_CENTS.toLocaleString("en-US")} cents.`).optional(),
  categoryId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
  transactionId: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:planning"], "get_planning_items");
    const bills = await createPlanningService(getDb()).listBills(auth.kind === "agent" ? auth.ctx.userId : auth.userId);
    return ok({ bills });
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const bill = await createPlanningService(getDb()).createBill(session.userId, body);
    return ok({ bill }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
