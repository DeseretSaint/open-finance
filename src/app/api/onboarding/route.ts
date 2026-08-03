import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createOnboardingService } from "@/server/domain/onboarding";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** First-run onboarding state (P8c). */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const status = await createOnboardingService(getDb()).get(session.userId);
    return ok(status);
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const svc = createOnboardingService(getDb());
    if (body.action === "reset") {
      return ok(await svc.reset(session.userId));
    }
    return ok(await svc.complete(session.userId));
  })(req, { params: Promise.resolve({}) });
}
