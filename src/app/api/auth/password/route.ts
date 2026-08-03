import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, noContent, parseBody, route } from "@/lib/api";
import {
  createAuthService,
  requireCsrf,
  requireSession,
  sensitiveLimiter,
} from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const schema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});

export async function PATCH(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    if (!sensitiveLimiter.check(session.userId).ok) throw apiErrors.rateLimited(60_000);
    const body = await parseBody(schema, req);
    const auth = createAuthService(getDb());
    await auth.changePassword(session.userId, body.current_password, body.new_password);
    // Revoke all OTHER sessions; keep the current one.
    await auth.revokeAllSessions(session.userId, session.id);
    return noContent();
  })(req, { params: Promise.resolve({}) });
}
