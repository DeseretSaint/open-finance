import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createPlanningService } from "@/server/domain/planning";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const digest = await createPlanningService(getDb()).digest(session.userId, parsed.data.days);
    return ok(digest);
  })(req, { params: Promise.resolve({}) });
}
