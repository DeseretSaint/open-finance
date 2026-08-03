import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { requireCsrf } from "@/server/auth/service";
import { agentRoute, requireSessionOrAgent } from "@/server/authz/agent-auth";
import { createCustomViewsService } from "@/server/domain/custom-views";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  widget: z.unknown().optional(),
  position: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

/** PATCH /api/custom-views/[id] — rename, re-position, enable/disable, or replace the definition. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["dev:ui"], "update_custom_view");
    if (auth.kind === "session") requireCsrf(req);
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const { id } = await ctx.params;
    const body = await parseBody(updateSchema, req);
    const view = await createCustomViewsService(getDb()).update(userId, id, body);
    return ok({ view });
  })(req, ctx);
}

/** DELETE /api/custom-views/[id] — remove a widget (always user-removable). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["dev:ui"], "delete_custom_view");
    if (auth.kind === "session") requireCsrf(req);
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const { id } = await ctx.params;
    await createCustomViewsService(getDb()).remove(userId, id);
    return ok({ ok: true });
  })(req, ctx);
}
