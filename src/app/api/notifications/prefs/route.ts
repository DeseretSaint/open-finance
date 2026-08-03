import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createNotificationsService } from "@/server/domain/notifications";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const updateSchema = z.object({
  notifEnabled: z.boolean().optional(),
  notifFrequency: z.enum(["daily", "weekly"]).optional(),
  notifTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  emailEnabled: z.boolean().optional(),
  emailAddress: z.string().email().optional().nullable(),
  emailFrequency: z.enum(["daily", "weekly"]).optional(),
  biometricEnabled: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const prefs = await createNotificationsService(getDb()).get(session.userId);
    return ok(prefs);
  })(req, { params: Promise.resolve({}) });
}

export async function PUT(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(updateSchema, req);
    const prefs = await createNotificationsService(getDb()).update(session.userId, body);
    return ok(prefs);
  })(req, { params: Promise.resolve({}) });
}
