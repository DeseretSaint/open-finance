import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createReportsService } from "@/server/domain/reports";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const monthsSchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(6),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = monthsSchema.safeParse(raw);
    if (!parsed.success) {
      throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const rows = await createReportsService(getDb()).spendingTrend(session.userId, parsed.data.months);
    return ok({ rows });
  })(req, { params: Promise.resolve({}) });
}
