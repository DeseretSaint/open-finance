import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import {
  clientIp,
  createAuthService,
  registerLimiter,
} from "@/server/auth/service";
import {
  createSession,
  isHttps,
  SESSION_COOKIE,
  sessionCookieMaxAge,
} from "@/server/auth/sessions";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().min(1),
  display_name: z.string().max(50).optional(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  return route(async (req) => {
    if (!registerLimiter.check(clientIp(req)).ok) throw apiErrors.rateLimited(60_000);
    const body = await parseBody(schema, req);
    const auth = createAuthService(getDb());
    const { user } = await auth.register({
      username: body.username,
      display_name: body.display_name ?? body.username,
      password: body.password,
    });
    // Auto-login with the default 30-day session.
    const session = await createSession(user.id, "30d", "New registration", getDb());
    const res = ok({ user, expiresAt: session.expiresAt }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isHttps(),
      maxAge: sessionCookieMaxAge("30d"),
    });
    return res;
  })(req, { params: Promise.resolve({}) });
}
