import { NextRequest } from "next/server";
import { z } from "zod";
import { noContent, ok, parseBody, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPlanningService } from "@/server/domain/planning";
import { MAX_AMOUNT_CENTS } from "@/server/domain/money";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.string().max(50).optional(),
  principalCents: z.number().int().positive().refine((v) => v <= MAX_AMOUNT_CENTS, `Money value cannot exceed ${MAX_AMOUNT_CENTS.toLocaleString("en-US")} cents.`).optional(),
  aprBps: z.number().int().nonnegative().optional(),
  minPaymentCents: z.number().int().nonnegative().refine((v) => v <= MAX_AMOUNT_CENTS, `Money value cannot exceed ${MAX_AMOUNT_CENTS.toLocaleString("en-US")} cents.`).optional(),
  termMonths: z.number().int().positive().nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  accountId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(updateSchema, req);
    const debt = await createPlanningService(getDb()).updateDebt(session.userId, id, body);
    return ok({ debt });
  })(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    await createPlanningService(getDb()).removeDebt(session.userId, id);
    return noContent();
  })(req, ctx);
}
