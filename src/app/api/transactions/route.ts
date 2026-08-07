import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createTransactionsService } from "@/server/domain/transactions";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const listSchema = z.object({
  accountId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  categoryId: z.string().optional(),
  q: z.string().optional(),
  pending: z.coerce.boolean().optional(),
  review: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createSchema = z.object({
  accountId: z.string().min(1),
  amountCents: z.number().int().refine((v) => v !== 0, "Amount cannot be zero."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD."),
  name: z.string().min(1, "Name is required.").max(200),
  userCategoryId: z.string().nullable().optional(),
  userNote: z.string().max(500).nullable().optional(),
  excludeFromBudgets: z.boolean().optional(),
});

/** Transactions — user session, or agent token (read:banking/read:investments + allowlist). */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:banking", "read:investments"], "list_transactions");
    const raw = Object.fromEntries(
      [...req.nextUrl.searchParams].filter(([, v]) => v !== "")
    );
    const parsed = listSchema.safeParse(raw);
    if (!parsed.success) {
      throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const filters = {
      ...parsed.data,
      review: parsed.data.review === true,
      accountIds: auth.kind === "agent" ? auth.ctx.accountIds : undefined,
      pendingOnly: parsed.data.pending === true,
    };
    const result = await createTransactionsService(getDb()).list(userId, filters);
    return ok(result);
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const transaction = await createTransactionsService(getDb()).createManual(session.userId, body);
    return ok({ transaction }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
