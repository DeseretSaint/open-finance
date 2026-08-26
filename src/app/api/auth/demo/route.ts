import { NextRequest } from "next/server";
import { route, apiErrors } from "@/lib/api";
import { clientIp, demoLimiter, requireCsrf } from "@/server/auth/service";
import { createSession } from "@/server/auth/sessions";
import { createOnboardingService } from "@/server/domain/onboarding";
import { getDb } from "@/server/db/adapter";
import { env } from "@/lib/env";
import { SESSION_COOKIE, sessionCookieMaxAge } from "@/server/auth/sessions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * One-tap demo login (gated by DEMO_MODE=true). Finds the seeded `demo` user
 * (scripts/seed.js) and creates a 30-day session. No password needed — the demo
 * user has no credentials by design (localhost demo only).
 */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    if (!env.DEMO_MODE) throw apiErrors.forbidden("Demo mode is disabled on this install.");
    requireCsrf(req);
    // Passwordless session creation → throttle per IP (5/min).
    if (!demoLimiter.check(clientIp(req)).ok) throw apiErrors.rateLimited(60_000);
    const db = getDb();
    const demo = await db.get<{ id: string }>("SELECT id FROM users WHERE username = ? AND is_demo = 1", "demo");
    if (!demo) {
      throw apiErrors.badRequest("Demo user not found — run `pnpm seed` first.");
    }
    const session = await createSession(demo.id, "30d", "Demo browser", db);
    // Demo users skip the first-run onboarding wizard.
    await createOnboardingService(db).complete(demo.id);
    const res = NextResponse.json({ ok: true, expiresAt: session.expiresAt });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.PUBLIC_URL.startsWith("https://"),
      path: "/",
      maxAge: sessionCookieMaxAge("30d"),
    });
    return res;
  })(req, { params: Promise.resolve({}) });
}
