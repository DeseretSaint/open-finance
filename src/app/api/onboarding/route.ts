import { NextRequest } from "next/server";
import { ok, route, assertJsonBodySize } from "@/lib/api";
import { requireSession, requireCsrf } from "@/server/auth/service";
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
    requireCsrf(req);
    // Reject oversized bodies BEFORE buffering them into RAM (parity with the
    // parseBody chokepoint cap; this route reads only {action}).
    assertJsonBodySize(req.headers.get("content-length"), null);
    const text = await req.text().catch(() => "");
    assertJsonBodySize(null, text.length);
    let raw: unknown = {};
    try {
      raw = text === "" ? {} : JSON.parse(text);
    } catch {
      raw = {};
    }
    const body = raw as { action?: string };
    const svc = createOnboardingService(getDb());
    if (body.action === "reset") {
      return ok(await svc.reset(session.userId));
    }
    return ok(await svc.complete(session.userId));
  })(req, { params: Promise.resolve({}) });
}
