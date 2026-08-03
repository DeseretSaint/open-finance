import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createDeviceLockService } from "@/server/domain/device-lock";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const biometricSchema = z.object({
  enabled: z.boolean(),
});

/** Toggle biometric unlock (the device's system prompt does the actual scan). */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(biometricSchema, req);
    await createDeviceLockService(getDb()).setBiometric(session.userId, body.enabled);
    return ok({ ok: true });
  })(req, { params: Promise.resolve({}) });
}
