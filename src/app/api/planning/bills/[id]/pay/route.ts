import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPlanningService } from "@/server/domain/planning";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const paySchema = z.object({
  amountCents: z.number().int().positive().optional(),
});

/** Mark a bill paid: remembers the actual amount and advances the next due date. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(paySchema, req);
    const bill = await createPlanningService(getDb()).payBill(session.userId, id, body.amountCents);
    return ok({ bill });
  })(req, ctx);
}
