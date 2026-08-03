import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import {
  clientIp,
  createAuthService,
  sensitiveLimiter,
} from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().min(1),
  recovery_code: z.string().min(1),
  new_password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  return route(async (req) => {
    if (!sensitiveLimiter.check(clientIp(req)).ok) throw apiErrors.rateLimited(60_000);
    const body = await parseBody(schema, req);
    const result = await createAuthService(getDb()).resetPasswordWithRecovery(
      body.username,
      body.recovery_code,
      body.new_password
    );
    return ok(result);
  })(req, { params: Promise.resolve({}) });
}
