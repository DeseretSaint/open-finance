import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createSyncService } from "@/server/plaid/sync";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const results = await createSyncService(getDb()).syncAll(session.userId);
    return ok({ results });
  })(req, { params: Promise.resolve({}) });
}
