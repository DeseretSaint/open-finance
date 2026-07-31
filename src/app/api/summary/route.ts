import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createSummaryService } from "@/server/domain/summary";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const summary = await createSummaryService(getDb()).get(session.userId);
    return ok({ summary });
  })(req, { params: Promise.resolve({}) });
}
