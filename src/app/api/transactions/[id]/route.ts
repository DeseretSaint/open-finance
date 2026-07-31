import { NextRequest } from "next/server";
import { z } from "zod";
import { noContent, ok, parseBody, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createTransactionsService } from "@/server/domain/transactions";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const updateSchema = z.object({
  userCategoryId: z.string().nullable().optional(),
  userNote: z.string().max(500).nullable().optional(),
  excludeFromBudgets: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
  amountCents: z.number().int().refine((v) => v !== 0, "Amount cannot be zero.").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.").optional(),
  accountId: z.string().optional(),
});

/** Single transaction — user session, or agent token (read:banking/read:investments). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(async (req, ctx) => {
    const auth = await requireSessionOrAgent(req, ["read:banking", "read:investments"], "get_transaction");
    const id = await parseParam(ctx, "id");
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const transaction = await createTransactionsService(getDb()).get(userId, id);
    return ok({ transaction });
  })(req, ctx);
}

/** Edit category/note/exclude — user session, or agent token (transactions:edit). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(async (req, ctx) => {
    const auth = await requireSessionOrAgent(req, ["transactions:edit"], "set_transaction_category");
    if (auth.kind === "session") requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(updateSchema, req);
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const transaction = await createTransactionsService(getDb()).update(userId, id, body);
    return ok({ transaction });
  })(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    await createTransactionsService(getDb()).removeManual(session.userId, id);
    return noContent();
  })(req, ctx);
}
