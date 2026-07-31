import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import {
  clientIp,
  createAuthService,
  deviceLabel,
  loginLimiter,
} from "@/server/auth/service";
import { DURATIONS, isHttps, SESSION_COOKIE, sessionCookieMaxAge, type Duration } from "@/server/auth/sessions";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  duration: z.enum(Object.keys(DURATIONS) as [Duration, ...Duration[]]).default("30d"),
});

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const body = await parseBody(schema, req);
    const key = `${clientIp(req)}:${body.username.trim().toLowerCase()}`;
    if (!loginLimiter.check(key).ok) throw apiErrors.rateLimited(60_000);

    const auth = createAuthService(getDb());
    const result = await auth.login({
      username: body.username,
      password: body.password,
      duration: body.duration,
      device_label: deviceLabel(req),
    });

    const res = ok({ user: result.user, expiresAt: result.expiresAt });
    res.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isHttps(),
      maxAge: sessionCookieMaxAge(body.duration),
    });
    return res;
  })(req, { params: Promise.resolve({}) });
}
