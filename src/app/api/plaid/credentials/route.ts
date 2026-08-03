import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPlaidService } from "@/server/plaid/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const status = await createPlaidService(getDb()).listCredentialStatus(session.userId);
    return ok(status);
  })(req, { params: Promise.resolve({}) });
}

const putSchema = z.object({
  clientId: z.string().min(1),
  secret: z.string().min(1),
  environment: z.enum(["sandbox", "production"]),
});

export async function PUT(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(putSchema, req);
    const result = await createPlaidService(getDb()).saveCredentials(session.userId, {
      clientId: body.clientId,
      secret: body.secret,
      environment: body.environment,
    });
    return ok(result);
  })(req, { params: Promise.resolve({}) });
}
