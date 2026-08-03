import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createPlaidService } from "@/server/plaid/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const querySchema = z.object({
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const q = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!q.success) throw apiErrors.badRequest("Invalid environment.");
    const result = await createPlaidService(getDb()).createLinkToken(session.userId, q.data.environment);
    return ok(result);
  })(req, { params: Promise.resolve({}) });
}
