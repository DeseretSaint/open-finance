import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPermissionService, emitSse } from "@/server/authz/permission-requests";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const resolveSchema = z.object({
  decision: z.enum(["granted", "denied"]),
});

/** User session: Grant or Deny a pending permission request. Grant appends the scope. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(resolveSchema, req);
    const resolved = await createPermissionService(getDb()).resolve(session.userId, id, body.decision);
    emitSse("permission_resolved", { id, scope: resolved.scope, status: body.decision });
    return ok({ request: resolved });
  })(req, ctx);
}
