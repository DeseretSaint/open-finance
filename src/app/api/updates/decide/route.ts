import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createUpdatesService, upcomingThreeAm } from "@/server/domain/updates";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const decideSchema = z.object({
  action: z.enum(["now", "scheduled", "dismiss", "cancel", "remind"]),
  /** ISO timestamp for "scheduled"; omitted → upcoming 3am. */
  scheduledAt: z.string().datetime().optional(),
});

/**
 * User decision on an available update:
 *   now       → apply immediately (runs scripts/update.sh detached)
 *   scheduled → schedule; default is the upcoming 3am
 *   dismiss   → stop notifying about this version (Settings keeps a path back)
 *   cancel    → cancel a previously scheduled update
 */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(decideSchema, req);
    const svc = createUpdatesService(getDb());

    switch (body.action) {
      case "now": {
        const result = await svc.apply();
        return ok(result, { status: 202 });
      }
      case "scheduled": {
        const when = body.scheduledAt ? new Date(body.scheduledAt) : upcomingThreeAm();
        await svc.schedule(when);
        return ok({ scheduledAt: when.toISOString() });
      }
      case "dismiss": {
        await svc.dismiss();
        return ok({ dismissed: true });
      }
      case "cancel": {
        await svc.cancelSchedule();
        return ok({ cancelled: true });
      }
      case "remind": {
        // Re-enable notifications for the dismissed version.
        await svc.remind();
        return ok({ reminded: true });
      }
      default:
        throw apiErrors.badRequest("Unknown action.");
    }
  })(req, { params: Promise.resolve({}) });
}
