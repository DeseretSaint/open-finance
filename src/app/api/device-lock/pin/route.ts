import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createDeviceLockService } from "@/server/domain/device-lock";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const setPinSchema = z.object({
  pin: z.string().min(4).max(12).regex(/^\d+$/, "PIN must be digits only."),
});

/** Set or change the device PIN. Requires the current session (already unlocked). */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(setPinSchema, req);
    await createDeviceLockService(getDb()).setPin(session.userId, body.pin);
    return ok({ ok: true });
  })(req, { params: Promise.resolve({}) });
}
