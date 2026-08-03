import { NextRequest } from "next/server";
import { z } from "zod";
import { noContent, ok, parseBody, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createAccountsService } from "@/server/domain/accounts";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().min(1, "Account name is required.").optional(),
  includeInNetWorth: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(patchSchema, req);
    const svc = createAccountsService(getDb());
    const account =
      body.includeInNetWorth !== undefined
        ? await svc.setNetWorthInclusion(session.userId, id, body.includeInNetWorth)
        : await svc.rename(session.userId, id, body.name as string);
    return ok({ account });
  })(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    await createAccountsService(getDb()).remove(session.userId, id);
    return noContent();
  })(req, ctx);
}
