import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { requireCsrf } from "@/server/auth/service";
import { agentRoute, requireSessionOrAgent } from "@/server/authz/agent-auth";
import { createCustomViewsService, WIDGET_TABS } from "@/server/domain/custom-views";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const createSchema = z.object({
  tab: z.enum(WIDGET_TABS),
  name: z.string().min(1).max(60),
  widget: z.unknown(),
  position: z.number().int().optional(),
});

/**
 * Custom views (dev:ui). The signed-in user manages widgets on their tabs;
 * an agent token with the dev:ui scope does the same over Bearer auth — the
 * registry (route-registry.ts) maps these routes to that scope.
 */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["dev:ui"], "list_custom_views");
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const tab = req.nextUrl.searchParams.get("tab") ?? undefined;
    const svc = createCustomViewsService(getDb());
    const views = await svc.list(
      userId,
      tab && (WIDGET_TABS as readonly string[]).includes(tab) ? (tab as (typeof WIDGET_TABS)[number]) : undefined
    );
    return ok({ views });
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["dev:ui"], "create_custom_view");
    if (auth.kind === "session") requireCsrf(req);
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const tokenId = auth.kind === "agent" ? auth.ctx.token.id : null;
    const body = await parseBody(createSchema, req);
    const view = await createCustomViewsService(getDb()).create(userId, tokenId, body);
    return ok({ view }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
