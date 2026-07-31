import { NextRequest } from "next/server";
import { z } from "zod";
import { noContent, ok, parseBody, parseParam, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createAccountsService } from "@/server/domain/accounts";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const renameSchema = z.object({
  name: z.string().min(1, "Account name is required."),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const id = await parseParam(ctx, "id");
    const body = await parseBody(renameSchema, req);
    const account = await createAccountsService(getDb()).rename(session.userId, id, body.name);
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
