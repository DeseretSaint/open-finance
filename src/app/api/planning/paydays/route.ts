import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createPlanningService } from "@/server/domain/planning";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const putSchema = z
  .object({
    mode: z.enum(["auto", "interval", "days_of_month"]),
    interval: z.enum(["weekly", "biweekly", "monthly"]).nullable().optional(),
    days: z.array(z.number().int().min(1).max(31)).optional(),
  })
  .refine((v) => (v.mode === "interval" ? !!v.interval : true), {
    message: "Payday intervals need an interval.",
  })
  .refine((v) => (v.mode === "days_of_month" ? (v.days?.length ?? 0) > 0 : true), {
    message: "Pick at least one payday day of the month.",
  });

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const paydays = await createPlanningService(getDb()).getPaydays(session.userId);
    return ok({ paydays });
  })(req, { params: Promise.resolve({}) });
}

export async function PUT(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(putSchema, req);
    const paydays = await createPlanningService(getDb()).setPaydays(session.userId, body);
    return ok({ paydays });
  })(req, { params: Promise.resolve({}) });
}
