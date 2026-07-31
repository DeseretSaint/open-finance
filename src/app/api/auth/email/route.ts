import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import {
  createAuthService,
  requireCsrf,
  requireSession,
  sensitiveLimiter,
} from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const schema = z.object({
  password: z.string().min(1),
  email: z.string().email().nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    if (!sensitiveLimiter.check(session.userId).ok) throw apiErrors.rateLimited(60_000);
    const body = await parseBody(schema, req);
    const result = await createAuthService(getDb()).changeEmail(
      session.userId,
      body.password,
      body.email ?? null
    );
    return ok({ email: result.email });
  })(req, { params: Promise.resolve({}) });
}
