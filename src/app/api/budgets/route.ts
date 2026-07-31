import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createBudgetsService } from "@/server/domain/budgets";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(60),
  amountCents: z.number().int().positive(),
  period: z.enum(["weekly", "monthly", "yearly"]).optional(),
  categoryIds: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const reference = req.nextUrl.searchParams.get("referenceDate") ?? undefined;
    const budgets = await createBudgetsService(getDb()).list(session.userId, reference);
    return ok({ budgets });
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const budget = await createBudgetsService(getDb()).create(session.userId, body);
    return ok({ budget }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
