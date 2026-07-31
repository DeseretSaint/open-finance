import { NextRequest } from "next/server";
import { noContent, parseParam, route } from "@/lib/api";
import { createAuthService, requireSession } from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  return route(async (req, ctx) => {
    const session = await requireSession(req);
    const id = await parseParam(ctx, "id");
    await createAuthService(getDb()).revokeSession(id, session.userId);
    return noContent();
  })(req, ctx);
}
