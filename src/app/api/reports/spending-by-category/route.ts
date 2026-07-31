import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createReportsService } from "@/server/domain/reports";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const rangeSchema = z.object({
  from: z.string().regex(DATE_RE, "from must be YYYY-MM-DD"),
  to: z.string().regex(DATE_RE, "to must be YYYY-MM-DD"),
});

function parseQuery<T>(schema: z.ZodType<T>, req: NextRequest): T {
  const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }
  return parsed.data;
}

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const { from, to } = parseQuery(rangeSchema, req);
    const rows = await createReportsService(getDb()).spendingByCategory(session.userId, from, to);
    return ok({ rows });
  })(req, { params: Promise.resolve({}) });
}
