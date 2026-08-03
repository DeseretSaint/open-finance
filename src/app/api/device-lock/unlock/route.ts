import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createDeviceLockService } from "@/server/domain/device-lock";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const unlockSchema = z.object({
  pin: z.string().min(4).max(12).regex(/^\d+$/, "PIN must be digits only."),
});

/** Unlock the device with the PIN. 423 when locked out, 401 on wrong PIN. */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(unlockSchema, req);
    await createDeviceLockService(getDb()).unlock(session.userId, body.pin);
    return ok({ ok: true });
  })(req, { params: Promise.resolve({}) });
}
