import { NextRequest } from "next/server";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import { createAuthService } from "@/server/auth/service";
import { createSession, isHttps, SESSION_COOKIE, sessionCookieMaxAge } from "@/server/auth/sessions";
import { getDb } from "@/server/db/adapter";
import { createPhoneImportService } from "@/server/domain/phone-import";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().min(1).max(32),
  displayName: z.string().min(1).max(80),
  password: z.string().min(1),
  pin: z.string().regex(/^\d{4,12}$/),
  contents: z.string().min(100).max(50_000_000),
});

/** First-launch hub setup: create the hub login and add the phone backup atomically at the product level. */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const body = await parseBody(schema, req);
    const db = getDb();
    const auth = createAuthService(db);
    const { user } = await auth.register({ username: body.username, display_name: body.displayName, password: body.password });
    const result = await createPhoneImportService(db).importBackup(user.id, body.pin, body.contents);
    const session = await createSession(user.id, "30d", "Phone import", db);
    const response = ok({ ...result, user: { id: user.id, display_name: user.display_name } }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isHttps(),
      maxAge: sessionCookieMaxAge("30d"),
    });
    return response;
  })(req, { params: Promise.resolve({}) });
}
