import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createReportsService } from "@/server/domain/reports";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const netWorth = await createReportsService(getDb()).netWorth(session.userId);
    return ok({ netWorth });
  })(req, { params: Promise.resolve({}) });
}
