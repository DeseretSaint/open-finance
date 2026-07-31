import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createUpdatesService } from "@/server/domain/updates";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** Force a re-check against the release source (github-api or UPDATE_CHECK_URL). */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    await requireSession(req);
    const svc = createUpdatesService(getDb());
    const found = await svc.check();
    const status = await svc.status();
    return ok({ found, status });
  })(req, { params: Promise.resolve({}) });
}

/** Current status without hitting the network (banner polls this). */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    await requireSession(req);
    const status = await createUpdatesService(getDb()).status();
    return ok(status);
  })(req, { params: Promise.resolve({}) });
}
