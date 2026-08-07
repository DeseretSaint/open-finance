import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPlaidService } from "@/server/plaid/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const schema = z.object({
  publicToken: z.string().min(1),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
  institutionId: z.string().nullable().optional(),
  institutionName: z.string().nullable().optional(),
  updateItemId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(schema, req);
    const result = await createPlaidService(getDb()).exchangePublicToken(
      session.userId,
      body.environment,
      body.publicToken,
      body.institutionId ?? null,
      body.institutionName ?? null,
      body.updateItemId
    );
    return ok(result, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
