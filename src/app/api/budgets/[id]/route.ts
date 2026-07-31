import { NextRequest } from "next/server";
import { z } from "zod";
import { noContent, ok, parseBody, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createBudgetsService } from "@/server/domain/budgets";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  amountCents: z.number().int().positive().optional(),
  period: z.enum(["weekly", "monthly", "yearly"]).optional(),
  categoryIds: z.array(z.string()).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(updateSchema, req);
    const budget = await createBudgetsService(getDb()).update(session.userId, id, body);
    return ok({ budget });
  })(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    await createBudgetsService(getDb()).remove(session.userId, id);
    return noContent();
  })(req, ctx);
}
