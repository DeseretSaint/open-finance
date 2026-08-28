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
  amountCents: z.number().int().positive().refine((v) => v <= MAX_AMOUNT_CENTS, `Money value cannot exceed ${MAX_AMOUNT_CENTS.toLocaleString("en-US")} cents.`).optional(),
  frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly", "one-time"]).optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(updateSchema, req);
    const bill = await createPlanningService(getDb()).updateBill(session.userId, id, body);
    return ok({ bill });
  })(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    await createPlanningService(getDb()).removeBill(session.userId, id);
    return noContent();
  })(req, ctx);
}
